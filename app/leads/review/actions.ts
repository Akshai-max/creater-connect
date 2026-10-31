"use server"
import { db } from "@/lib/db"
import { entityReviews, leads } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { processBatch } from "@/lib/leads/process"
import { loadIndex, persistLead, rerankAndDraft } from "@/lib/leads/repo"
import { aboutUrl, isDecision, reviewQuote } from "@/lib/leads/entity-reviews"
import type { LeadInput } from "@/lib/leads/types"

/**
 * Saves a person's decision on who runs a lead's channel and re-scores that lead straight away.
 * The decision is kept in entity_reviews, so the next engine cycle applies it again instead of undoing it.
 */
export async function reviewEntity(leadId: string, decision: string): Promise<{ status: string; priority: string | null }> {
  if (!isDecision(decision)) throw new Error(`unknown decision: ${decision}`)
  const l = (await db.select({ inputJson: leads.inputJson, isFixture: leads.isFixture }).from(leads).where(eq(leads.id, leadId)))[0]
  if (!l?.inputJson) throw new Error("lead not found")
  const input = JSON.parse(l.inputJson) as LeadInput
  const now = new Date()
  const at = now.toISOString()
  const review = { stableCreatorId: input.stableCreatorId, decision, evidenceUrl: aboutUrl(input.profileUrl), note: null, reviewedAt: at }
  await db.insert(entityReviews).values(review).onConflictDoUpdate({ target: entityReviews.stableCreatorId, set: { decision, evidenceUrl: review.evidenceUrl, reviewedAt: at } })

  // Same pipeline as the engine, for this one lead.
  const patched: LeadInput = { ...input, entityType: decision, entityEvidenceUrl: review.evidenceUrl, entityQuote: reviewQuote(review), entitySource: `human:${at.slice(0, 10)}` }
  const batch = processBatch([{ row: patched as unknown as Record<string, unknown>, ref: leadId }], await loadIndex(), { now, source: "review" })
  const p = batch.processed[0]
  if (!p) throw new Error(batch.failures[0]?.error ?? batch.duplicates[0]?.reason ?? "could not re-score the lead")
  await persistLead(p, "review", at, !!l.isFixture)
  // Priority A is ranked across all qualified leads, so a newly qualified lead needs a re-rank.
  if (p.qualification.status === "qualified") await rerankAndDraft(at, { includeFixtures: false })
  const after = (await db.select({ status: leads.candidateStatus, priority: leads.priority }).from(leads).where(eq(leads.id, p.id)))[0]
  revalidatePath("/leads/review")
  revalidatePath("/leads")
  return { status: after?.status ?? p.qualification.status, priority: after?.priority ?? null }
}
