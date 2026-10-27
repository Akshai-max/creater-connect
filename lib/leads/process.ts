// Pure batch pipeline: normalize → dedupe → verify → qualify → score →
// select channels → draft. The DB layer (repo.ts) persists the result.
import { senderFromEnv } from "./config"
import { recommendChannels } from "./channels"
import { generateSequences, personalizationHook, sortedContent, validateMessage } from "./messages"
import { canonicalUrl, hashInput, identityKey, leadIdFor, parseLeadRow, withinDays } from "./normalize"
import { qualify, type QualificationResult } from "./qualify"
import { scoreLead } from "./scoring"
import { RULES } from "./config"
import type { ChannelRecommendation, GeneratedMessage, LeadInput, ScoreFactor, Sender } from "./types"

export type ExistingIndex = {
  byIdentity: Map<string, { id: string; inputHash: string | null }>
  byCanonicalUrl: Map<string, string> // canonical url → lead id
  byContact: Map<string, string> // normalized contact value → lead id
}

export const emptyIndex = (): ExistingIndex => ({ byIdentity: new Map(), byCanonicalUrl: new Map(), byContact: new Map() })

export type ProcessedLead = {
  id: string
  identityKey: string
  canonicalProfileUrl: string
  input: LeadInput
  inputHash: string
  isNew: boolean
  changed: boolean
  qualification: QualificationResult
  score: number
  factors: ScoreFactor[]
  channels: ChannelRecommendation
  messages: GeneratedMessage[]
  firstMessage: string | null
  hook: string | null
  recentContent: { url: string; title: string } | null
}

export type BatchResult = {
  processed: ProcessedLead[]
  duplicates: { ref: string; of: string; reason: string }[]
  failures: { ref: string; error: string }[]
}

export const contactKey = (v: string) => v.trim().toLowerCase().replace(/^@/, "").replace(/\/+$/, "")

export function formatFirstMessage(m: GeneratedMessage | undefined): string | null {
  if (!m || m.status !== "draft") return null
  return m.subject ? `Subject: ${m.subject}\n\n${m.body}` : m.body
}

export function processBatch(
  rows: { row: Record<string, unknown>; ref: string }[],
  existing: ExistingIndex,
  opts: { now: Date; source: string; sender?: Sender | null },
): BatchResult {
  const sender = opts.sender === undefined ? senderFromEnv() : opts.sender
  const out: BatchResult = { processed: [], duplicates: [], failures: [] }
  // Working copy so in-batch records dedupe against each other too.
  const byIdentity = new Map(existing.byIdentity)
  const byUrl = new Map(existing.byCanonicalUrl)
  const byContact = new Map(existing.byContact)
  const seenInBatch = new Set<string>()

  for (const { row, ref } of rows) {
    const parsed = parseLeadRow(row, opts.source)
    if (!parsed.ok) { out.failures.push({ ref, error: parsed.error }); continue }
    const input = parsed.input
    const key = identityKey(input.primaryPlatform, input.stableCreatorId)
    const id = leadIdFor(key)
    const canon = canonicalUrl(input.profileUrl)!

    if (seenInBatch.has(key)) { out.duplicates.push({ ref, of: id, reason: "same stable id earlier in this input" }); continue }
    const urlOwner = byUrl.get(canon)
    if (urlOwner && urlOwner !== id) { out.duplicates.push({ ref, of: urlOwner, reason: "same canonical profile URL under a different id" }); continue }
    seenInBatch.add(key)

    // Same published contact under a different identity = same creator on another platform.
    const contactOwner = input.contacts.map((c) => byContact.get(contactKey(c.value))).find((o) => o && o !== id) ?? null

    const channels = recommendChannels(input.contacts, opts.now)
    const messages = generateSequences(input, channels, sender ?? null)
    const items = sortedContent(input.contentItems)
    const recent = items.find((i) => withinDays(i.publishedAt, RULES.personalizationMaxAgeDays, opts.now))
    const first = channels.best ? messages.find((m) => m.channel === channels.best && m.sequence === 1) : undefined
    const firstProblems = first && first.status === "draft" && sender
      ? validateMessage(first, sender, recent ? { title: recent.title, url: recent.url } : null).problems
      : null

    const qualification = qualify(input, { now: opts.now, channels, duplicateOf: contactOwner, firstMessageProblems: firstProblems })
    const { score, factors } = scoreLead(input, qualification.activity, channels, opts.now)
    const inputHash = hashInput(input)
    const prev = byIdentity.get(key)

    out.processed.push({
      id,
      identityKey: key,
      canonicalProfileUrl: canon,
      input,
      inputHash,
      isNew: !prev,
      changed: !prev || prev.inputHash !== inputHash,
      qualification,
      score,
      factors,
      channels,
      messages,
      firstMessage: formatFirstMessage(first),
      hook: personalizationHook(recent),
      recentContent: items[0] ? { url: items[0].url, title: items[0].title } : null,
    })
    byIdentity.set(key, { id, inputHash })
    byUrl.set(canon, id)
    for (const c of input.contacts) if (!byContact.has(contactKey(c.value))) byContact.set(contactKey(c.value), id)
  }
  return out
}
