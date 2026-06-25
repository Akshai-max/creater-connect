"use server"
import { db } from "@/lib/db"
import { candidates } from "@/lib/db/schema"
import { eq, and, sql, asc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { judgeCandidate } from "@/lib/candidate-quality"

export type CleanupResult = {
  totalBefore: number
  rejected: number
  duplicates: number
  remaining: number
  rejectionReasons: { reason: string; count: number }[]
  duplicateHandles: string[]
}

export async function cleanupCandidates(): Promise<CleanupResult> {
  // Pull all pending candidates
  const pending = await db.select().from(candidates).where(eq(candidates.status, "pending"))
  const totalBefore = pending.length

  // 1) Dedup: group by normalized handle, keep the one with highest fit_score
  const byHandle = new Map<string, typeof pending>()
  for (const c of pending) {
    const key = (c.handle ?? "").toLowerCase().replace("@", "").trim()
    if (!key) continue
    if (!byHandle.has(key)) byHandle.set(key, [])
    byHandle.get(key)!.push(c)
  }

  const dupesToReject: string[] = []
  const duplicateHandles: string[] = []
  for (const [handle, group] of byHandle) {
    if (group.length > 1) {
      duplicateHandles.push("@" + handle)
      // Sort by fit score desc, then by discoveredAt asc (keep oldest if tied)
      group.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0) || (a.discoveredAt ?? "").localeCompare(b.discoveredAt ?? ""))
      const [keep, ...rest] = group
      dupesToReject.push(...rest.map((c) => c.id))
    }
  }

  // 2) Quality filter: judge each remaining candidate (the deduped survivor) and reject junk
  const survivors = Array.from(byHandle.values()).map((g) => g[0]) // dedup-survivor per handle
  const reasonCounts: Record<string, number> = {}
  const qualityRejects: string[] = []
  for (const c of survivors) {
    const verdict = judgeCandidate({
      handle: c.handle,
      bio: c.bio,
      followers: c.followers,
      engagementRate: c.engagementRate,
      personaMatch: c.personaMatch,
      fitScore: c.fitScore,
      nicheRelevant: c.nicheRelevant,
      externalUrl: c.externalUrl,
    })
    if (!verdict.keep) {
      qualityRejects.push(c.id)
      reasonCounts[verdict.reason] = (reasonCounts[verdict.reason] ?? 0) + 1
    }
  }

  // Bulk update: mark rejected
  const reviewedAt = new Date().toISOString()
  for (const id of [...dupesToReject, ...qualityRejects]) {
    await db.update(candidates)
      .set({ status: "rejected", reviewedAt })
      .where(eq(candidates.id, id))
  }

  const remaining = survivors.length - qualityRejects.length

  try {
    revalidatePath("/candidates")
    revalidatePath("/")
  } catch {}

  return {
    totalBefore,
    rejected: qualityRejects.length,
    duplicates: dupesToReject.length,
    remaining,
    rejectionReasons: Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    duplicateHandles: duplicateHandles.slice(0, 30),
  }
}
