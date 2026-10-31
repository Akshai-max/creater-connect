// Human entity reviews (/leads/review): a person looks at the channel and says who runs it.
// The AI entity check only passes a channel when the creator's own words say a person runs it, and
// most descriptions never say so; a reviewer looking at the channel can. Decisions are stored in
// entity_reviews (one per channel) and applied to the lead-file rows before every engine run, so the
// cycle never undoes them; they also win over an AI verdict.
import { EXCLUDED_ENTITY_TYPES } from "./types"

export const REVIEW_DECISIONS = ["individual", ...EXCLUDED_ENTITY_TYPES] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]
export type Review = { decision: string; evidenceUrl: string | null; note: string | null; reviewedAt: string }

export const isDecision = (d: string): d is ReviewDecision => (REVIEW_DECISIONS as readonly string[]).includes(d)

/** The evidence a reviewer looks at: the channel's own About page. */
export const aboutUrl = (profileUrl: string) => `${profileUrl.replace(/\/+$/, "").replace(/\/about$/, "")}/about`

/** What the lead's entity evidence says about a review. */
export const reviewQuote = (r: Pick<Review, "decision" | "note">) =>
  r.note?.trim() || (r.decision === "individual" ? "Checked by a person: one creator runs this channel" : `Checked by a person: ${r.decision.replace("_", " ")}`)

/** Puts a review into a lead-file row (engine CSV columns). Returns false if the row already says the same. */
export function applyEntityReview(row: Record<string, unknown>, r: Review): boolean {
  const source = `human:${r.reviewedAt.slice(0, 10)}`
  if (row.entity_type === r.decision && row.entity_source === source) return false
  row.entity_type = r.decision
  row.entity_evidence_url = r.evidenceUrl || (row.profile_url ? aboutUrl(String(row.profile_url)) : "")
  row.entity_quote = reviewQuote(r)
  row.entity_source = source
  row.entity_note = ""
  const notes = String(row.review_notes ?? "")
    .replace(/CONFIRM: individual creator \(not company\/network\)/, "")
    .replace(/CHECK: entity "[^"]*" read by [^;]*/, "")
    .replace(/^[;\s]+|[;\s]+$/g, "").replace(/;\s*;/g, ";")
  row.review_notes = [notes, `CHECKED: entity "${r.decision}" by a person on ${r.reviewedAt.slice(0, 10)}`].filter(Boolean).join("; ")
  return true
}

/** All reviews, by channel id (read by the engine and the entity check). */
export async function loadEntityReviews(): Promise<Map<string, Review>> {
  const { db } = await import("../db")
  const { entityReviews } = await import("../db/schema")
  const rows = await db.select().from(entityReviews)
  return new Map(rows.map((r) => [r.stableCreatorId, { decision: r.decision, evidenceUrl: r.evidenceUrl, note: r.note, reviewedAt: r.reviewedAt }]))
}
