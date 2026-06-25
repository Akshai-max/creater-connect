import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { creators, candidates } from "@/lib/db/schema"
import { sql } from "drizzle-orm"
import {
  scrapeHashtag,
  scrapeProfiles,
  findEmail,
  detectIsUS,
  looksLikeBrandHandle,
  hashtagsForToday,
  type HashtagPost,
  type IGProfile,
} from "@/lib/apify-client"
import { scoreCandidate } from "@/lib/ai-scoring"
import { judgeCandidate } from "@/lib/candidate-quality"

// Keep this within Vercel function timeout. Default plan: 300s.
export const maxDuration = 300

// Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`. Manual hits also work with this.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return true // No secret set → allow (dev mode)
  const auth = req.headers.get("authorization") || ""
  if (auth === `Bearer ${expected}`) return true
  // Vercel cron sends with x-vercel-cron header — also allow if from cron context
  if (req.headers.get("x-vercel-cron")) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const customTags = url.searchParams.get("hashtags")?.split(",").filter(Boolean)
  const limit = Number(url.searchParams.get("perTag") ?? 60)
  const enrichLimit = Number(url.searchParams.get("enrich") ?? 30)

  const tags = customTags ?? hashtagsForToday()
  const summary: any = { ranAt: new Date().toISOString(), hashtags: tags, perTagLimit: limit, enrichLimit }

  try {
    if (!process.env.APIFY_TOKEN) {
      return NextResponse.json({ error: "APIFY_TOKEN not set" }, { status: 503 })
    }

    // Step 1: Hashtag scrapes in parallel
    const scrapeResults = await Promise.all(
      tags.map((t) => scrapeHashtag(t, limit).then((posts) => ({ tag: t, posts })).catch((e) => ({ tag: t, posts: [] as HashtagPost[], error: String(e) })))
    )
    const totalPosts = scrapeResults.reduce((s, r) => s + r.posts.length, 0)
    summary.scrape = scrapeResults.map((r) => ({ tag: r.tag, posts: r.posts.length, ...((r as any).error && { error: (r as any).error }) }))

    // Step 2: Aggregate unique candidate handles, dedup against existing creators + existing candidates
    const existingCreatorHandles = new Set(
      (await db.select({ handle: creators.handle }).from(creators))
        .map((r) => (r.handle ?? "").toLowerCase().replace("@", ""))
    )
    const existingCandidateHandles = new Set(
      (await db.select({ handle: candidates.handle }).from(candidates))
        .map((r) => (r.handle ?? "").toLowerCase().replace("@", ""))
    )
    const seen = new Set([...existingCreatorHandles, ...existingCandidateHandles])

    type Aggregated = { handle: string; tagsHit: Set<string>; bestEng: number; samplePost?: HashtagPost; fullName?: string }
    const aggregated = new Map<string, Aggregated>()
    for (const { tag, posts } of scrapeResults) {
      for (const p of posts) {
        const u = (p.ownerUsername || "").toLowerCase().trim()
        if (!u) continue
        if (seen.has(u)) continue
        if (looksLikeBrandHandle(u)) continue
        const eng = (p.likesCount ?? 0) + (p.commentsCount ?? 0) * 3
        let agg = aggregated.get(u)
        if (!agg) {
          agg = { handle: u, tagsHit: new Set(), bestEng: 0 }
          aggregated.set(u, agg)
        }
        agg.tagsHit.add(tag)
        if (p.ownerFullName) agg.fullName = p.ownerFullName
        if (eng > agg.bestEng) {
          agg.bestEng = eng
          agg.samplePost = p
        }
      }
    }

    // Step 3: Rank by hashtag-overlap then engagement; take top N for enrichment
    const ranked = Array.from(aggregated.values()).sort(
      (a, b) => b.tagsHit.size - a.tagsHit.size || b.bestEng - a.bestEng
    )
    const toEnrich = ranked.slice(0, enrichLimit)
    summary.uniqueCandidates = aggregated.size
    summary.toEnrich = toEnrich.length

    // Step 4: Profile-scrape in one batch
    const profiles = await scrapeProfiles(toEnrich.map((c) => c.handle))
    const profileByHandle = new Map(profiles.map((p) => [(p.username ?? "").toLowerCase(), p]))

    // Step 5: Score + insert each
    let inserted = 0
    let skipped = 0
    const inserts: any[] = []

    for (const cand of toEnrich) {
      const p = profileByHandle.get(cand.handle)
      if (!p) { skipped++; continue }
      const fc = p.followersCount ?? 0
      // skip outright spam (huge or tiny accounts that fell through brand filter)
      if (fc > 500_000) { skipped++; continue }

      const captions = (p.latestPosts || []).map((x) => x.caption || "").filter(Boolean).slice(0, 8)
      const er = (() => {
        if (!fc || !p.latestPosts?.length) return null
        const avg = p.latestPosts.reduce((s, x) => s + (x.likesCount ?? 0) + (x.commentsCount ?? 0) * 2, 0) / p.latestPosts.length
        return Math.min((avg / fc) * 100, 100)
      })()
      const email = await findEmail(p)
      const isUS = detectIsUS(`${p.biography ?? ""} ${p.fullName ?? ""}`)

      // AI score
      const score = await scoreCandidate({
        handle: `@${cand.handle}`,
        fullName: p.fullName ?? cand.fullName ?? null,
        followers: fc,
        engagementRate: er,
        bio: p.biography,
        location: null,
        recentCaptions: captions,
        externalUrl: p.externalUrl,
        sourceDetail: Array.from(cand.tagsHit).map((t) => `#${t}`).join(", "),
      })

      // Quality gate — reject junk before insert (brands, storefronts, tiny accounts, etc.)
      const verdict = judgeCandidate({
        handle: `@${cand.handle}`,
        bio: p.biography,
        followers: fc,
        engagementRate: er,
        personaMatch: score.personaMatch,
        fitScore: score.fitScore,
        nicheRelevant: score.nicheRelevant,
        externalUrl: p.externalUrl,
      })
      if (!verdict.keep) { skipped++; continue }

      const id = `cand_${cand.handle.replace(/[^a-z0-9]/g, "_")}_${Date.now().toString(36).slice(-4)}`
      inserts.push({
        id,
        handle: `@${cand.handle}`,
        platform: "IG",
        fullName: p.fullName ?? cand.fullName ?? null,
        followers: fc,
        engagementRate: er,
        email,
        location: isUS ? "US" : null,
        bio: (p.biography ?? "").slice(0, 500),
        externalUrl: p.externalUrl ?? null,
        avatarUrl: (p as any).profilePicUrlHD ?? (p as any).profilePicUrl ?? null,
        source: "auto-discovery",
        sourceDetail: Array.from(cand.tagsHit).map((t) => `#${t}`).join(", "),
        nicheRelevant: score.nicheRelevant,
        isUS,
        rateBand: score.suggestedRateBand,
        fitScore: score.fitScore,
        fitReasoning: score.fitReasoning,
        personaMatch: score.personaMatch,
        nicheGuess: score.nicheGuess,
        redFlags: score.redFlags.join("\n") || null,
        outreachAngle: score.outreachAngle,
        aiScored: score.aiScored,
        status: "pending",
      })
    }

    // Bulk insert (idempotent via id uniqueness)
    for (const row of inserts) {
      try {
        await db.insert(candidates).values(row).onConflictDoNothing()
        inserted++
      } catch (e) {
        skipped++
      }
    }

    summary.inserted = inserted
    summary.skipped = skipped
    summary.totalPosts = totalPosts
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    console.error("discover failed:", e)
    return NextResponse.json({ ok: false, error: String(e?.message ?? e), ...summary }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
