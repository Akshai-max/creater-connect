// DB layer for the lead engine. Idempotent: leads upsert on identity_key, each
// lead's writes go in one db.batch (a single transaction on neon-http), and
// human-edited messages are never overwritten by a rerun.
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "../db"
import { candidates, engineRuns, leadEvidence, leads, outreachMessages, type Lead } from "../db/schema"
import { contactKey, type ExistingIndex, type ProcessedLead } from "./process"
import { assignPriorities } from "./scoring"
import { generateSequences } from "./messages"
import { recommendChannels } from "./channels"
import { senderFromEnv } from "./config"
import type { LeadInput } from "./types"

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export async function loadIndex(): Promise<ExistingIndex> {
  const rows = await db.select({ id: leads.id, identityKey: leads.identityKey, inputHash: leads.inputHash, url: leads.canonicalProfileUrl }).from(leads)
  const contacts = await db.select({ leadId: leadEvidence.leadId, value: leadEvidence.value }).from(leadEvidence).where(eq(leadEvidence.kind, "contact"))
  const idx: ExistingIndex = { byIdentity: new Map(), byCanonicalUrl: new Map(), byContact: new Map() }
  for (const r of rows) {
    idx.byIdentity.set(r.identityKey, { id: r.id, inputHash: r.inputHash })
    idx.byCanonicalUrl.set(r.url, r.id)
  }
  for (const c of contacts.sort((a, b) => a.leadId.localeCompare(b.leadId))) {
    if (c.value && !idx.byContact.has(contactKey(c.value))) idx.byContact.set(contactKey(c.value), c.leadId)
  }
  return idx
}

function leadValues(p: ProcessedLead, runId: string, nowIso: string, isFixture: boolean) {
  const i = p.input
  return {
    id: p.id,
    identityKey: p.identityKey,
    canonicalProfileUrl: p.canonicalProfileUrl,
    creatorName: i.creatorName,
    segment: i.segment || null,
    entityType: i.entityType,
    countryIso2: i.countryIso2,
    countryEvidenceUrl: i.countryEvidenceUrl,
    primaryLanguage: i.primaryLanguage,
    primaryPlatform: i.primaryPlatform,
    profileUrl: i.profileUrl,
    stableCreatorId: i.stableCreatorId,
    followers: i.followers,
    lastContentDate: p.qualification.activity.lastContentDate,
    recentContentUrl: p.recentContent?.url ?? null,
    recentContentTitle: p.recentContent?.title ?? null,
    contentCount30d: p.qualification.activity.contentCount30d,
    longformCount60d: p.qualification.activity.longformCount60d,
    monetizationSignal: i.monetizationSignal,
    monetizationEvidenceUrl: i.monetizationEvidenceUrl,
    need: i.need,
    needEvidenceUrl: i.needEvidenceUrl,
    bestChannel: p.channels.best,
    channelHandleOrUrl: p.channels.bestValue,
    channelEvidenceUrl: p.channels.bestEvidenceUrl,
    backupChannel: p.channels.backup,
    channelRecommendation: JSON.stringify(p.channels),
    personalizationHook: p.hook,
    firstMessage: p.firstMessage,
    checkedDate: i.checkedDate,
    leadScore: p.score,
    scoreFactors: JSON.stringify(p.factors),
    candidateStatus: p.qualification.status,
    rejectionReason: p.qualification.rejectionReason,
    qualificationChecks: JSON.stringify(p.qualification.checks),
    inputHash: p.inputHash,
    inputJson: JSON.stringify(i),
    source: i.source,
    sourceRef: i.sourceRef,
    isFixture,
    lastRunId: runId,
    updatedAt: nowIso,
  }
}

function evidenceRows(p: ProcessedLead, nowIso: string) {
  const i = p.input
  const rows: (typeof leadEvidence.$inferInsert)[] = []
  let n = 0
  const add = (r: Omit<typeof leadEvidence.$inferInsert, "id" | "leadId" | "checkedAt">) =>
    rows.push({ id: `${p.id}-ev${++n}`, leadId: p.id, checkedAt: i.checkedDate ?? nowIso, ...r })
  add({ kind: "profile", url: i.profileUrl, value: i.stableCreatorId, label: `${i.primaryPlatform} profile` })
  if (i.countryEvidenceUrl) add({ kind: "country", url: i.countryEvidenceUrl, value: i.countryIso2 })
  if (i.entityEvidenceUrl) add({ kind: "entity", url: i.entityEvidenceUrl, value: i.entityType, label: i.entityQuote ?? null, source: i.entitySource ?? null })
  for (const c of i.contentItems) add({ kind: "content", url: c.url, label: c.title, publishedAt: c.publishedAt, isLongform: c.isLongform })
  if (i.monetizationEvidenceUrl || i.monetizationSignal) add({ kind: "monetization", url: i.monetizationEvidenceUrl, value: i.monetizationSignal })
  if (i.needEvidenceUrl || i.need) add({ kind: "need", url: i.needEvidenceUrl, value: i.need, label: i.needSignalText, source: i.needSource ?? null })
  for (const c of i.contacts) add({ kind: "contact", channel: c.channel, value: c.value, url: c.evidenceUrl, lastActiveAt: c.lastActiveAt, source: c.source, label: c.businessUse ? "business use" : null })
  return rows
}

export async function persistLead(p: ProcessedLead, runId: string, nowIso: string, isFixture: boolean) {
  const values = leadValues(p, runId, nowIso, isFixture)
  const { id: _id, ...updatable } = values
  const upsert = db.insert(leads).values(values).onConflictDoUpdate({ target: leads.identityKey, set: updatable })
  if (!p.changed) {
    await upsert // evidence unchanged; only re-evaluated status/scores move
    return
  }
  await db.batch([
    upsert,
    db.delete(leadEvidence).where(eq(leadEvidence.leadId, p.id)),
    ...chunk(evidenceRows(p, nowIso), 200).map((c) => db.insert(leadEvidence).values(c)),
  ] as any)
}

// Global re-rank across all stored leads (Priority A is a dataset-level choice),
// then make sure every Priority A lead has its full 3×3 sequence stored.
export async function rerankAndDraft(nowIso: string, opts: { includeFixtures: boolean }) {
  const rows = await db.select({ id: leads.id, status: leads.candidateStatus, score: leads.leadScore, priority: leads.priority, isFixture: leads.isFixture }).from(leads)
  const pool = rows.filter((r) => opts.includeFixtures || !r.isFixture)
  const pr = assignPriorities(pool.map((r) => ({ id: r.id, status: r.status as any, score: r.score ?? 0 })))
  const changes = pool.filter((r) => pr.get(r.id) !== r.priority)
  for (const group of chunk(changes, 100)) {
    await db.batch(group.map((r) => db.update(leads).set({ priority: pr.get(r.id)! }).where(eq(leads.id, r.id))) as any)
  }
  const aIds = pool.filter((r) => pr.get(r.id) === "A").map((r) => r.id)
  let drafted = 0
  for (const ids of chunk(aIds, 25)) {
    const aLeads = await db.select().from(leads).where(inArray(leads.id, ids))
    for (const l of aLeads) drafted += await upsertSequences(l, nowIso)
  }
  const counts = { A: 0, B: 0, C: 0, "N/A": 0 } as Record<string, number>
  for (const r of pool) counts[pr.get(r.id)!]++
  return { priorityCounts: counts, priorityA: aIds.length, messagesUpserted: drafted }
}

export async function upsertSequences(l: Lead, nowIso: string): Promise<number> {
  const input = JSON.parse(l.inputJson ?? "null") as LeadInput | null
  if (!input) return 0
  const rec = recommendChannels(input.contacts, new Date(nowIso))
  const msgs = generateSequences(input, rec, senderFromEnv())
  const stmts = msgs.map((m) => {
    const v = {
      id: `${l.id}-${m.channel}-${m.sequence}`,
      leadId: l.id,
      channel: m.channel,
      sequence: m.sequence,
      subject: m.subject,
      body: m.body,
      status: m.status,
      unavailableReason: m.unavailableReason,
      evidenceRefs: JSON.stringify(m.evidenceRefs),
      updatedAt: nowIso,
    }
    const { id: _id, leadId: _l, channel: _c, sequence: _s, ...set } = v
    // Never clobber a human edit or an approval.
    return db.insert(outreachMessages).values(v).onConflictDoUpdate({
      target: [outreachMessages.leadId, outreachMessages.channel, outreachMessages.sequence],
      set,
      setWhere: and(eq(outreachMessages.edited, false), sql`${outreachMessages.status} <> 'approved'`),
    })
  })
  await db.batch(stmts as any)
  return stmts.length
}

export async function loadAllLeads(opts: { includeFixtures: boolean }): Promise<Lead[]> {
  const rows = await db.select().from(leads)
  return rows.filter((r) => opts.includeFixtures || !r.isFixture)
}

export async function loadMessagesFor(leadIds: string[]) {
  const out = []
  for (const ids of chunk(leadIds, 200)) out.push(...(await db.select().from(outreachMessages).where(inArray(outreachMessages.leadId, ids))))
  return out
}

// Existing CRM candidates as engine input. They lack most evidence, so they
// will honestly land as unverified — the queue then shows exactly what's missing.
export async function candidatesAsRows() {
  const rows = await db.select().from(candidates)
  return rows.map((c) => ({
    ref: `candidate:${c.id}`,
    candidateId: c.id,
    row: {
      creator_name: c.fullName || c.handle,
      creator_segment: "",
      entity_type: "",
      primary_platform: (c.platform || "instagram").toLowerCase() === "ig" ? "instagram" : (c.platform || "instagram"),
      profile_url: c.platform === "YT" ? c.externalUrl ?? "" : `https://www.instagram.com/${c.handle.replace(/^@/, "")}`,
      stable_creator_id: c.handle.replace(/^@/, ""), // a handle, not a stable id → flagged by the profile check
      followers_or_subscribers: c.followers ?? "",
      email: c.email ?? "",
      email_source: "published",
      source: `candidate:${c.source ?? "unknown"}`,
      source_ref: c.id,
    } as Record<string, unknown>,
  }))
}

export async function linkCandidate(leadId: string, candidateId: string) {
  await db.update(leads).set({ candidateId }).where(eq(leads.id, leadId))
}

export async function createRun(id: string, provider: string, inputRef: string, startedAt: string) {
  await db.insert(engineRuns).values({ id, provider, inputRef, startedAt, status: "running" })
}

export async function finishRun(id: string, patch: Partial<typeof engineRuns.$inferInsert>) {
  await db.update(engineRuns).set(patch).where(eq(engineRuns.id, id))
}

export async function listRuns(limit = 100) {
  return db.select().from(engineRuns).orderBy(sql`${engineRuns.startedAt} desc`).limit(limit)
}

export async function purgeFixtures(): Promise<number> {
  const rows = await db.delete(leads).where(eq(leads.isFixture, true)).returning({ id: leads.id })
  return rows.length
}
