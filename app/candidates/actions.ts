"use server"
import { db } from "@/lib/db"
import { candidates, creators } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logActivity } from "@/lib/activity"

export async function approveCandidate(candidateId: string) {
  const cand = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0]
  if (!cand) throw new Error("Candidate not found")

  // Generate next CR id
  const existing = await db.select({ id: creators.id }).from(creators)
  const maxNum = existing
    .map((c) => parseInt(c.id.replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n))
    .reduce((max, n) => Math.max(max, n), 0)
  const newId = `CR${String(maxNum + 1).padStart(3, "0")}`

  await db.insert(creators).values({
    id: newId,
    name: cand.fullName ?? cand.handle,
    handle: cand.handle,
    platform: cand.platform,
    profileUrl: cand.handle ? `https://instagram.com/${cand.handle.replace("@","")}` : null,
    followers: cand.followers,
    engagementRate: cand.engagementRate,
    email: cand.email,
    location: cand.location,
    bio: cand.bio,
    externalUrl: cand.externalUrl,
    source: `apify-${cand.sourceDetail ?? cand.source}`,
    persona: "New",
    flagNotes: cand.fitReasoning ?? null,
    lifecycleStatus: "Lead",
    stage: "Lead",
    stageChangedAt: new Date().toISOString(),
    rateCeiling: cand.rateBand?.match(/\$(\d+)-\$(\d+)/)?.[2] ? Number(cand.rateBand.match(/\$(\d+)-\$(\d+)/)![2]) : null,
    owner: "You",
  } as any)

  await db.update(candidates).set({
    status: "approved",
    reviewedAt: sql`(CURRENT_TIMESTAMP)`,
  }).where(eq(candidates.id, candidateId))

  // Log the candidate approval as the creator's first activity
  await logActivity({
    creatorId: newId,
    type: "candidate_approved",
    title: `Approved from candidate queue`,
    body: cand.fitReasoning ?? null,
    metadata: { candidateId, source: cand.sourceDetail ?? cand.source, fitScore: cand.fitScore },
  })

  revalidatePath("/candidates")
  revalidatePath("/creators")
  revalidatePath("/")
}

export async function rejectCandidate(candidateId: string) {
  await db.update(candidates).set({
    status: "rejected",
    reviewedAt: sql`(CURRENT_TIMESTAMP)`,
  }).where(eq(candidates.id, candidateId))

  revalidatePath("/candidates")
  revalidatePath("/")
}

export async function restoreCandidate(candidateId: string) {
  await db.update(candidates).set({
    status: "pending",
    reviewedAt: null,
  }).where(eq(candidates.id, candidateId))

  revalidatePath("/candidates")
  revalidatePath("/")
}
