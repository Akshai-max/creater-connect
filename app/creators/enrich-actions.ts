"use server"
import { db } from "@/lib/db"
import { creators } from "@/lib/db/schema"
import { eq, and, or, isNull, sql, asc, desc } from "drizzle-orm"
import { scrapeProfiles, findEmail } from "@/lib/apify-client"
import { logActivity } from "@/lib/activity"
import { revalidatePath } from "next/cache"

const PER_BATCH = 50 // Apify profile-scraper sweet spot
const SKIP_IF_ENRICHED_WITHIN_DAYS = 14

export async function enrichRosterBatch(limit = PER_BATCH): Promise<{
  scanned: number
  enriched: number
  skipped: number
  errors: number
  remaining: number
  details: { handle: string; status: string; reason?: string }[]
}> {
  if (!process.env.APIFY_TOKEN) {
    throw new Error("APIFY_TOKEN not set in environment")
  }

  // Find IG creators missing data + with a usable handle
  // Skip if enriched within last 14 days OR if they have full data already.
  const cutoff = new Date(Date.now() - SKIP_IF_ENRICHED_WITHIN_DAYS * 86400000).toISOString()
  const all = await db.select().from(creators)

  const candidates = all
    .filter((c) => {
      const platform = (c.platform ?? "").toLowerCase()
      if (platform !== "ig" && platform !== "instagram") return false
      const h = (c.handle ?? "").replace("@", "").trim()
      // Filter out malformed handles (we noticed some literal "gmail.com", "ps", "reel" placeholders)
      if (!h) return false
      if (h.length < 2) return false
      if (h.includes(".com") || h.includes("@")) return false
      if (["ps", "reel", "gmail.com"].includes(h.toLowerCase())) return false
      // Only re-enrich if it's been >14 days OR we have no data
      if (c.enrichedAt && c.enrichedAt > cutoff) return false
      // Skip if they already have everything (followers + bio + email + avatar)
      if (c.followers && c.bio && c.email && c.avatarUrl) return false
      return true
    })
    .sort((a, b) => {
      // Prioritize: never enriched first, then oldest enrichment
      if (!a.enrichedAt && b.enrichedAt) return -1
      if (a.enrichedAt && !b.enrichedAt) return 1
      return (a.enrichedAt ?? "").localeCompare(b.enrichedAt ?? "")
    })

  const batch = candidates.slice(0, limit)
  const remaining = Math.max(0, candidates.length - batch.length)

  if (batch.length === 0) {
    return { scanned: candidates.length, enriched: 0, skipped: 0, errors: 0, remaining: 0, details: [] }
  }

  const usernames = batch.map((c) => (c.handle ?? "").replace("@", "").trim().toLowerCase())
  const profiles = await scrapeProfiles(usernames)
  const profileByUsername = new Map(profiles.map((p) => [(p.username ?? "").toLowerCase(), p]))

  const details: { handle: string; status: string; reason?: string }[] = []
  let enriched = 0
  let skipped = 0
  let errors = 0

  for (const c of batch) {
    const u = (c.handle ?? "").replace("@", "").trim().toLowerCase()
    const p = profileByUsername.get(u)
    if (!p) {
      skipped++
      details.push({ handle: c.handle ?? c.id, status: "not_found", reason: "Apify returned no profile" })
      // Still mark enrichedAt to avoid re-trying immediately
      await db.update(creators).set({ enrichedAt: new Date().toISOString() }).where(eq(creators.id, c.id))
      continue
    }
    const fc = p.followersCount ?? null
    const posts = p.latestPosts || []
    const er = (() => {
      if (!fc || !posts.length) return null
      const avg = posts.reduce((s, x) => s + (x.likesCount ?? 0) + (x.commentsCount ?? 0) * 2, 0) / posts.length
      return Math.min((avg / fc) * 100, 100)
    })()

    // Only fill empty fields — never clobber what's already there
    const updates: Record<string, any> = { enrichedAt: new Date().toISOString() }
    if (!c.followers && fc) updates.followers = fc
    if (!c.bio && p.biography) updates.bio = p.biography.slice(0, 500)
    if (!c.externalUrl && p.externalUrl) updates.externalUrl = p.externalUrl
    const pic = (p as any).profilePicUrlHD ?? (p as any).profilePicUrl
    if (!c.avatarUrl && pic) updates.avatarUrl = pic
    if (c.engagementRate == null && er != null) updates.engagementRate = er
    if (!c.email) {
      const found = await findEmail(p)
      if (found) updates.email = found
    }

    try {
      await db.update(creators).set(updates).where(eq(creators.id, c.id))
      // Log it on the timeline (only meaningful fields, not the noise)
      const filledFields = Object.keys(updates).filter((k) => k !== "enrichedAt")
      if (filledFields.length > 0) {
        await logActivity({
          creatorId: c.id,
          type: "note",
          title: "Profile enriched from Apify",
          body: `Filled: ${filledFields.join(", ")}`,
          metadata: { source: "apify-enrich" },
        })
        enriched++
        details.push({ handle: c.handle ?? c.id, status: "enriched", reason: filledFields.join(", ") })
      } else {
        skipped++
        details.push({ handle: c.handle ?? c.id, status: "no_new_data" })
      }
    } catch (e) {
      errors++
      details.push({ handle: c.handle ?? c.id, status: "error", reason: String((e as Error).message) })
    }
  }

  try { revalidatePath("/creators"); revalidatePath("/") } catch { /* not in request context (CLI) */ }
  return {
    scanned: candidates.length,
    enriched,
    skipped,
    errors,
    remaining,
    details,
  }
}
