// Engine orchestrator: Discover/import → Normalize → Validate → Deduplicate →
// Verify → Qualify → Score → Select channels → Draft → Export → Record metrics.
// Every run is recorded in engine_runs (including failed ones) and is safe to
// re-run: writes are idempotent upserts keyed on the creator's stable identity.
import fs from "node:fs"
import path from "node:path"
import { buildExport, type ExportableLead, type ExportReport } from "./export"
import { emptyIndex, processBatch, type BatchResult, type ProcessedLead } from "./process"
import { fetchYouTubeActivity, mergeYouTube, readInputFile, type ProviderRow } from "./providers"
import { assignPriorities } from "./scoring"
import { generateSequences, segmentTemplatesMarkdown } from "./messages"
import { senderFromEnv } from "./config"
import type { GeneratedMessage } from "./types"

export type EngineOptions = {
  provider: "file" | "candidates"
  input?: string // file provider
  youtubeIdsFile?: string // optional: refresh activity from the YouTube Data API
  dryRun?: boolean // no DB reads/writes; export from this batch only
  fixture?: boolean // mark rows as fixtures (excluded from official export)
  includeFixtures?: boolean
  includeNonQualified?: boolean // leads-all.csv is always written; this affects leads.csv
  simulateFailureAfter?: number // demo: throw after N leads are persisted
  outDir?: string
  now?: Date
  log?: (msg: string) => void
  // Recorded with the run: what the scheduled cycle did before it (scripts/engine-cycle.ts), so the
  // Engine page can show discovery results and count its YouTube units in the run's cost.
  extraMetrics?: Record<string, unknown>
  extraApiUnits?: number
}

export type EngineSummary = {
  runId: string
  status: "succeeded" | "failed"
  durationMs: number
  totalInput: number
  inserted: number
  updated: number
  unchanged: number
  qualified: number
  unverified: number
  rejected: number
  duplicates: number
  failed: number
  apiUnits: number
  costUsd: number
  priorityA: number
  exportReport: ExportReport | null
  outDir: string
  errors: { ref: string; message: string }[]
}

const runIdFor = (d: Date) => `run_${d.toISOString().replace(/[-:T]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`

// Strip anything that looks like an email/token before it hits logs or the DB.
export const redact = (s: string) => s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]").replace(/key=[^&\s]+/gi, "key=[redacted]")

export async function runEngine(opts: EngineOptions): Promise<EngineSummary> {
  const log = opts.log ?? (() => {})
  const startedAt = new Date()
  const now = opts.now ?? startedAt
  const runId = runIdFor(startedAt)
  const outDir = path.resolve(opts.outDir ?? (opts.dryRun ? "exports/dry-run" : "exports"))
  const errors: EngineSummary["errors"] = []
  const s: EngineSummary = {
    runId, status: "failed", durationMs: 0, totalInput: 0, inserted: 0, updated: 0, unchanged: 0, qualified: 0, unverified: 0,
    rejected: 0, duplicates: 0, failed: 0, apiUnits: opts.extraApiUnits ?? 0, costUsd: 0, priorityA: 0, exportReport: null, outDir, errors,
  }
  const inputRef = opts.provider === "file" ? path.basename(opts.input ?? "") : "candidates-table"
  const repo = opts.dryRun ? null : await import("./repo")
  if (repo) await repo.createRun(runId, opts.provider, inputRef, startedAt.toISOString())
  log(`run ${runId} started (${opts.provider}${opts.dryRun ? ", dry-run" : ""})`)

  try {
    // 1. Discover / import
    let rows: (ProviderRow & { candidateId?: string })[]
    if (opts.provider === "file") {
      if (!opts.input) throw new Error("--input is required for the file provider")
      rows = readInputFile(opts.input).rows
    } else {
      if (!repo) throw new Error("the candidates provider needs the database (no --dry-run)")
      rows = await repo.candidatesAsRows()
    }
    if (opts.youtubeIdsFile) {
      const ids = fs.readFileSync(opts.youtubeIdsFile, "utf8").split(/\s+/).filter(Boolean)
      const yt = await fetchYouTubeActivity(ids, { apiKey: process.env.YOUTUBE_API_KEY })
      s.apiUnits += yt.apiUnits
      errors.push(...yt.errors.map((e) => ({ ref: e.ref, message: e.error })))
      rows = mergeYouTube(rows, yt.byChannel)
      log(`youtube: refreshed ${yt.byChannel.size}/${ids.length} channels (${yt.apiUnits} quota units)`)
    }
    s.totalInput = rows.length
    log(`loaded ${rows.length} input rows`)

    // 2-8. Normalize → … → draft (pure)
    const index = repo ? await repo.loadIndex() : emptyIndex()
    const batch: BatchResult = processBatch(rows, index, { now, source: opts.provider })
    s.duplicates = batch.duplicates.length
    s.failed = batch.failures.length
    errors.push(...batch.failures.map((f) => ({ ref: f.ref, message: f.error })))
    for (const p of batch.processed) s[p.qualification.status]++

    // Persist (idempotent)
    if (repo) {
      const nowIso = now.toISOString()
      const candidateIds = new Map(rows.filter((r) => r.candidateId).map((r) => [r.ref, r.candidateId!]))
      let n = 0
      for (const p of batch.processed) {
        if (opts.simulateFailureAfter != null && n >= opts.simulateFailureAfter) {
          throw new Error(`simulated failure after ${n} leads (--simulate-failure-after)`)
        }
        try {
          await repo.persistLead(p, runId, nowIso, !!opts.fixture)
          const cid = p.input.sourceRef && candidateIds.get(`candidate:${p.input.sourceRef}`)
          if (cid) await repo.linkCandidate(p.id, cid)
          if (p.isNew) s.inserted++
          else if (p.changed) s.updated++
          else s.unchanged++
        } catch (e) {
          s.failed++
          errors.push({ ref: p.id, message: redact((e as Error).message) })
        }
        if (++n % 100 === 0) log(`persisted ${n}/${batch.processed.length}`)
      }
      const rr = await repo.rerankAndDraft(nowIso, { includeFixtures: !!opts.includeFixtures || !!opts.fixture })
      s.priorityA = rr.priorityA
      log(`ranked: ${JSON.stringify(rr.priorityCounts)}; ${rr.messagesUpserted} sequence messages upserted`)
    } else {
      s.inserted = batch.processed.length
    }

    // 9. Export
    const { allLeads, messages } = repo ? await loadForExport(repo, !!opts.includeFixtures || !!opts.fixture) : fromBatch(batch.processed)
    if (!repo) s.priorityA = allLeads.filter((l) => l.priority === "A").length
    s.exportReport = writeExports(allLeads, messages, outDir, { now, includeNonQualified: !!opts.includeNonQualified })
    log(`exported ${s.exportReport.rows} rows to ${path.join(outDir, "leads.csv")}`)
    s.status = "succeeded"
  } catch (e) {
    errors.push({ ref: "run", message: redact((e as Error).message) })
    log(`run failed: ${redact((e as Error).message)}`)
  } finally {
    s.durationMs = Date.now() - startedAt.getTime()
    if (repo) {
      await repo.finishRun(runId, {
        status: s.status, finishedAt: new Date().toISOString(), durationMs: s.durationMs, totalInput: s.totalInput,
        inserted: s.inserted, updated: s.updated, unchanged: s.unchanged, qualified: s.qualified, unverified: s.unverified,
        rejected: s.rejected, duplicates: s.duplicates, failed: s.failed, costUsd: s.costUsd, apiUnits: s.apiUnits,
        errors: JSON.stringify(errors.slice(0, 200)),
        metrics: JSON.stringify({ ...(opts.extraMetrics ?? {}), priorityA: s.priorityA, export: s.exportReport && { rows: s.exportReport.rows, problems: s.exportReport.problems, distribution: s.exportReport.distribution } }),
      }).catch((e) => log(`could not record run result: ${redact((e as Error).message)}`))
    }
  }
  return s
}

type MessageRow = { leadId: string; channel: string; sequence: number; subject: string | null; body: string | null; status: string; unavailableReason: string | null }

async function loadForExport(repo: typeof import("./repo"), includeFixtures: boolean) {
  const allLeads = await repo.loadAllLeads({ includeFixtures })
  const aIds = allLeads.filter((l) => l.priority === "A").map((l) => l.id)
  const messages = (await repo.loadMessagesFor(aIds)) as MessageRow[]
  return { allLeads: allLeads as ExportableLead[], messages }
}

// Dry-run: rank and draft within the batch only.
function fromBatch(processed: ProcessedLead[]) {
  const pr = assignPriorities(processed.map((p) => ({ id: p.id, status: p.qualification.status, score: p.score })))
  const sender = senderFromEnv()
  const messages: MessageRow[] = []
  const allLeads: ExportableLead[] = processed.map((p) => {
    if (pr.get(p.id) === "A") {
      for (const m of generateSequences(p.input, p.channels, sender) as GeneratedMessage[]) messages.push({ leadId: p.id, ...m })
    }
    return {
      id: p.id, identityKey: p.identityKey, canonicalProfileUrl: p.canonicalProfileUrl, creatorName: p.input.creatorName,
      segment: p.input.segment, countryIso2: p.input.countryIso2, primaryLanguage: p.input.primaryLanguage, primaryPlatform: p.input.primaryPlatform,
      profileUrl: p.input.profileUrl, stableCreatorId: p.input.stableCreatorId, followers: p.input.followers,
      lastContentDate: p.qualification.activity.lastContentDate, recentContentUrl: p.recentContent?.url ?? null,
      contentCount30d: p.qualification.activity.contentCount30d, longformCount60d: p.qualification.activity.longformCount60d,
      monetizationSignal: p.input.monetizationSignal, monetizationEvidenceUrl: p.input.monetizationEvidenceUrl, need: p.input.need,
      needEvidenceUrl: p.input.needEvidenceUrl, bestChannel: p.channels.best, channelHandleOrUrl: p.channels.bestValue,
      channelEvidenceUrl: p.channels.bestEvidenceUrl, backupChannel: p.channels.backup, personalizationHook: p.hook,
      firstMessage: p.firstMessage, checkedDate: p.input.checkedDate, priority: pr.get(p.id) ?? null, leadScore: p.score,
      candidateStatus: p.qualification.status, rejectionReason: p.qualification.rejectionReason,
    }
  })
  return { allLeads, messages }
}

export function writeExports(allLeads: ExportableLead[], messages: MessageRow[], outDir: string, opts: { now: Date; includeNonQualified: boolean }): ExportReport {
  fs.mkdirSync(outDir, { recursive: true })
  const official = buildExport(allLeads, { includeNonQualified: opts.includeNonQualified, now: opts.now })
  const audit = buildExport(allLeads, { includeNonQualified: true, now: opts.now })
  fs.writeFileSync(path.join(outDir, "leads.csv"), official.csv, "utf8")
  fs.writeFileSync(path.join(outDir, "leads-all.csv"), audit.csv, "utf8")
  fs.writeFileSync(path.join(outDir, "validation-report.json"), JSON.stringify({ official: official.report, all: audit.report }, null, 2), "utf8")

  // outreach/<lead_id>.md — every Priority A sequence, per channel.
  const odir = path.join(outDir, "outreach")
  fs.rmSync(odir, { recursive: true, force: true })
  fs.mkdirSync(odir, { recursive: true })
  const byLead = new Map<string, MessageRow[]>()
  for (const m of messages) byLead.set(m.leadId, [...(byLead.get(m.leadId) ?? []), m])
  const names = new Map(allLeads.map((l) => [l.id, l.creatorName]))
  for (const [leadId, ms] of [...byLead.entries()].sort()) {
    const parts = [`# ${names.get(leadId) ?? leadId} (${leadId})\n`]
    for (const ch of ["email", "linkedin", "instagram"]) {
      parts.push(`## ${ch}\n`)
      for (const m of ms.filter((x) => x.channel === ch).sort((a, b) => a.sequence - b.sequence)) {
        const label = m.sequence === 1 ? "Initial" : `Follow-up ${m.sequence - 1}`
        parts.push(m.status === "unavailable" ? `### ${label}\n_Unavailable: ${m.unavailableReason}_\n` : `### ${label}\n${m.subject ? `**Subject:** ${m.subject}\n\n` : ""}${m.body}\n`)
      }
    }
    fs.writeFileSync(path.join(odir, `${leadId}.md`), parts.join("\n"), "utf8")
  }
  fs.writeFileSync(path.join(odir, "_SEQUENCES_BY_SEGMENT.md"), segmentTemplatesMarkdown(senderFromEnv()), "utf8")
  return official.report
}
