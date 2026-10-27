// Official leads.csv exporter: exactly 30 columns in the workbook's order,
// RFC 4180 quoting, UTF-8, deterministic row order. duplicate_check and
// completeness_check are recomputed here from the exported rows themselves.
import { countryDistribution, type DistributionReport } from "./distribution"

export const LEAD_COLUMNS = [
  "lead_id",
  "creator_name",
  "creator_segment",
  "country_iso2",
  "primary_language",
  "primary_platform",
  "profile_url",
  "stable_creator_id",
  "followers_or_subscribers",
  "last_content_date",
  "recent_content_url",
  "content_count_30d",
  "longform_count_60d",
  "monetization_signal",
  "monetization_evidence_url",
  "incubrix_need",
  "need_evidence_url",
  "best_channel",
  "channel_handle_or_url",
  "channel_evidence_url",
  "backup_channel",
  "personalization_hook",
  "first_message",
  "checked_date",
  "priority",
  "lead_score",
  "candidate_status",
  "rejection_reason",
  "duplicate_check",
  "completeness_check",
] as const
export type LeadColumn = (typeof LEAD_COLUMNS)[number]
export type LeadCsvRecord = Record<LeadColumn, string>

// Columns allowed to be empty on a qualified row.
const OPTIONAL_COLUMNS = new Set<LeadColumn>(["backup_channel", "rejection_reason", "followers_or_subscribers", "duplicate_check", "completeness_check"])

// Minimal lead shape the exporter needs (matches the `leads` table row).
export type ExportableLead = {
  id: string
  creatorName: string
  segment: string | null
  countryIso2: string | null
  primaryLanguage: string | null
  primaryPlatform: string | null
  profileUrl: string | null
  canonicalProfileUrl: string
  stableCreatorId: string | null
  identityKey: string
  followers: number | null
  lastContentDate: string | null
  recentContentUrl: string | null
  contentCount30d: number | null
  longformCount60d: number | null
  monetizationSignal: string | null
  monetizationEvidenceUrl: string | null
  need: string | null
  needEvidenceUrl: string | null
  bestChannel: string | null
  channelHandleOrUrl: string | null
  channelEvidenceUrl: string | null
  backupChannel: string | null
  personalizationHook: string | null
  firstMessage: string | null
  checkedDate: string | null
  priority: string | null
  leadScore: number | null
  candidateStatus: string
  rejectionReason: string | null
}

const s = (v: unknown) => (v == null ? "" : String(v))
const PRIORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 }

export function sortForExport<T extends ExportableLead>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority ?? ""] ?? 9) - (PRIORITY_ORDER[b.priority ?? ""] ?? 9) ||
      (b.leadScore ?? -1) - (a.leadScore ?? -1) ||
      a.id.localeCompare(b.id),
  )
}

export function toRecord(l: ExportableLead): LeadCsvRecord {
  return {
    lead_id: l.id,
    creator_name: l.creatorName,
    creator_segment: s(l.segment),
    country_iso2: s(l.countryIso2),
    primary_language: s(l.primaryLanguage),
    primary_platform: s(l.primaryPlatform),
    profile_url: s(l.profileUrl),
    stable_creator_id: s(l.stableCreatorId),
    followers_or_subscribers: s(l.followers),
    last_content_date: s(l.lastContentDate),
    recent_content_url: s(l.recentContentUrl),
    content_count_30d: s(l.contentCount30d),
    longform_count_60d: s(l.longformCount60d),
    monetization_signal: s(l.monetizationSignal),
    monetization_evidence_url: s(l.monetizationEvidenceUrl),
    incubrix_need: s(l.need),
    need_evidence_url: s(l.needEvidenceUrl),
    best_channel: s(l.bestChannel),
    channel_handle_or_url: s(l.channelHandleOrUrl),
    channel_evidence_url: s(l.channelEvidenceUrl),
    backup_channel: s(l.backupChannel),
    personalization_hook: s(l.personalizationHook),
    first_message: s(l.firstMessage),
    checked_date: s(l.checkedDate),
    priority: s(l.priority),
    lead_score: l.leadScore == null ? "" : l.leadScore.toFixed(1),
    candidate_status: l.candidateStatus,
    rejection_reason: s(l.rejectionReason),
    duplicate_check: "",
    completeness_check: "",
  }
}

// Duplicates across the exported set: same identity, same canonical profile, or
// same contact value (one creator listed under two platforms).
export function computeDuplicateChecks(rows: ExportableLead[]): Map<string, string> {
  const seen = new Map<string, string>()
  const result = new Map<string, string>()
  for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const keys = [`id:${r.identityKey}`, `url:${r.canonicalProfileUrl}`]
    if (r.channelHandleOrUrl) keys.push(`contact:${r.channelHandleOrUrl.trim().toLowerCase().replace(/^@/, "")}`)
    const hit = keys.map((k) => seen.get(k)).find((v) => v && v !== r.id)
    result.set(r.id, hit ? `DUPLICATE:${hit}` : "UNIQUE")
    for (const k of keys) if (!seen.has(k)) seen.set(k, r.id)
  }
  return result
}

export function completenessOf(rec: LeadCsvRecord): string {
  if (rec.candidate_status !== "qualified") {
    return rec.rejection_reason ? "NOT_QUALIFIED" : "INCOMPLETE: rejection_reason"
  }
  const missing = LEAD_COLUMNS.filter((c) => !OPTIONAL_COLUMNS.has(c) && rec[c].trim() === "")
  return missing.length ? `INCOMPLETE: ${missing.join(",")}` : "COMPLETE"
}

export function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function buildCsv(records: LeadCsvRecord[], opts: { bom?: boolean } = {}): string {
  const lines = [LEAD_COLUMNS.join(","), ...records.map((r) => LEAD_COLUMNS.map((c) => csvEscape(r[c] ?? "")).join(","))]
  return (opts.bom ? "﻿" : "") + lines.join("\r\n") + "\r\n"
}

export type ExportReport = {
  generatedAt: string
  rows: number
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  duplicates: number
  incomplete: number
  qualifiedComplete: number
  distribution: DistributionReport
  problems: string[]
}

export function buildExport(leads: ExportableLead[], opts: { includeNonQualified?: boolean; now?: Date; bom?: boolean } = {}): { csv: string; records: LeadCsvRecord[]; report: ExportReport } {
  const subset = opts.includeNonQualified ? leads : leads.filter((l) => l.candidateStatus === "qualified")
  const dups = computeDuplicateChecks(subset)
  const records = sortForExport(subset).map((l) => {
    const rec = toRecord(l)
    rec.duplicate_check = dups.get(l.id) ?? "UNIQUE"
    rec.completeness_check = completenessOf(rec)
    return rec
  })
  const tally = (k: LeadColumn) => records.reduce<Record<string, number>>((m, r) => ((m[r[k] || "—"] = (m[r[k] || "—"] ?? 0) + 1), m), {})
  const problems: string[] = []
  const dupCount = records.filter((r) => r.duplicate_check !== "UNIQUE").length
  const incomplete = records.filter((r) => r.completeness_check.startsWith("INCOMPLETE")).length
  if (dupCount) problems.push(`${dupCount} duplicate rows`)
  if (incomplete) problems.push(`${incomplete} incomplete rows`)
  const qualified = records.filter((r) => r.candidate_status === "qualified")
  const distribution = countryDistribution(qualified.map((r) => r.country_iso2 || null))
  for (const c of distribution.checks) if (!c.pass) problems.push(`distribution ${c.id}: ${c.detail}`)
  return {
    csv: buildCsv(records, { bom: opts.bom }),
    records,
    report: {
      generatedAt: (opts.now ?? new Date()).toISOString(),
      rows: records.length,
      byStatus: tally("candidate_status"),
      byPriority: tally("priority"),
      duplicates: dupCount,
      incomplete,
      qualifiedComplete: qualified.filter((r) => r.completeness_check === "COMPLETE" && r.duplicate_check === "UNIQUE").length,
      distribution,
      problems,
    },
  }
}
