// Explainable 0-100 lead score + Priority A selection. Missing data earns zero
// points for its factor; nothing is awarded for confident-sounding AI output.
import { RULES } from "./config"
import { ageDays, isValidEvidenceUrl, parseDate } from "./normalize"
import { sortedContent } from "./messages"
import type { ActivityMetrics } from "./qualify"
import type { CandidateStatus, ChannelRecommendation, LeadInput, ScoreFactor } from "./types"

const SEGMENT_FIT: Record<string, number> = { video_podcaster: 1, podcaster: 0.9, youtuber: 0.8, expert_creator: 0.8 }
const STRONG_MONETIZATION = new Set(["course", "membership", "sponsorship", "subscription"])
const CORE_NEEDS = new Set(["repurposing", "editing", "captions", "content_backlog"])

function followerFit(n: number | null): { mult: number; why: string } {
  if (n == null) return { mult: 0.3, why: "audience size unknown" }
  if (n < 1_000) return { mult: 0.4, why: "<1K audience" }
  if (n < 10_000) return { mult: 0.7, why: "1K–10K audience" }
  if (n <= 500_000) return { mult: 1, why: "10K–500K audience (core range)" }
  return { mult: 0.8, why: ">500K audience (likely has a team)" }
}

export function scoreLead(input: LeadInput, activity: ActivityMetrics, channels: ChannelRecommendation, now: Date): { score: number; factors: ScoreFactor[] } {
  const f: ScoreFactor[] = []
  const r1 = (n: number) => Math.round(n * 10) / 10

  const seg = SEGMENT_FIT[input.segment] ?? 0
  const ff = followerFit(input.followers)
  f.push({ key: "fit", label: "Fit with product", max: 20, points: r1(20 * seg * ff.mult), reason: `${input.segment || "unknown segment"} (×${seg}); ${ff.why} (×${ff.mult})` })

  const urls = [input.countryEvidenceUrl, input.monetizationEvidenceUrl, input.needEvidenceUrl, channels.bestEvidenceUrl, sortedContent(input.contentItems)[0]?.url]
  const valid = urls.filter((u) => isValidEvidenceUrl(u)).length
  const checked = parseDate(input.checkedDate)
  const freshPts = checked && ageDays(checked, now) >= 0 && ageDays(checked, now) <= 7 ? 5 : checked && ageDays(checked, now) <= RULES.evidenceFreshnessDays ? 3 : 0
  f.push({ key: "evidence", label: "Evidence quality", max: 15, points: r1((valid / urls.length) * 10 + freshPts), reason: `${valid}/${urls.length} evidence URLs valid; checked ${checked ? `${Math.max(0, Math.floor(ageDays(checked, now)))}d ago` : "never"}` })

  const actPts = Math.min(1, activity.contentCount30d / 12) * 8 + Math.min(1, activity.longformCount60d / 6) * 7
  f.push({ key: "activity", label: "Creator activity", max: 15, points: r1(actPts), reason: `${activity.contentCount30d} items/30d, ${activity.longformCount60d} long-form/60d` })

  const monEv = isValidEvidenceUrl(input.monetizationEvidenceUrl) && !!input.monetizationSignal
  f.push({ key: "commercial", label: "Commercial signals", max: 15, points: monEv ? (STRONG_MONETIZATION.has(input.monetizationSignal!) ? 15 : 10) : 0, reason: monEv ? `${input.monetizationSignal} with evidence` : "no evidenced monetization" })

  const needEv = isValidEvidenceUrl(input.needEvidenceUrl) && !!input.need
  f.push({ key: "need", label: "Demonstrated need", max: 15, points: needEv ? (CORE_NEEDS.has(input.need!) ? 15 : 10) : 0, reason: needEv ? `${input.need} with evidence${CORE_NEEDS.has(input.need!) ? " (core use case)" : ""}` : "no evidenced need" })

  const best = channels.options.find((o) => o.channel === channels.best)
  const reachPts = best ? Math.min(8, best.score / 2.5) + (channels.backup ? 2 : 0) : 0
  f.push({ key: "reach", label: "Channel reachability", max: 10, points: r1(Math.min(10, reachPts)), reason: best ? `best ${best.channel} (route score ${best.score})${channels.backup ? `, backup ${channels.backup}` : ", no backup"}` : "no verified route" })

  const recent = sortedContent(input.contentItems)[0]
  const age = recent ? ageDays(parseDate(recent.publishedAt)!, now) : Infinity
  const persPts = age < 0 ? 0 : age <= 14 ? 10 : age <= 30 ? 7 : age <= 60 ? 4 : 0
  f.push({ key: "personalization", label: "Personalization potential", max: 10, points: persPts, reason: recent && age >= 0 ? `latest titled item ${Math.floor(age)}d old` : "no usable recent item" })

  const score = r1(f.reduce((s, x) => s + x.points, 0))
  return { score, factors: f }
}

export type Rankable = { id: string; status: CandidateStatus; score: number }

// Priority A = top N qualified by score (ties broken by lead_id for determinism).
// Non-qualified leads can never be A regardless of score.
export function assignPriorities<T extends Rankable>(rows: T[], aCount: number = RULES.priorityACount): Map<string, "A" | "B" | "C" | "N/A"> {
  const out = new Map<string, "A" | "B" | "C" | "N/A">()
  const qualified = rows.filter((r) => r.status === "qualified").sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  qualified.forEach((r, i) => out.set(r.id, i < aCount ? "A" : r.score >= 60 ? "B" : "C"))
  for (const r of rows) if (r.status !== "qualified") out.set(r.id, "N/A")
  return out
}
