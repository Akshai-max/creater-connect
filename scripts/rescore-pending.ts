// Re-score all pending heuristic-scored candidates with Claude.
// Re-pulls profile + captions from Apify so the AI has real content to reference in outreach angles.
import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { eq, and } from "drizzle-orm"
import { scrapeProfiles } from "../lib/apify-client"
import { scoreCandidate } from "../lib/ai-scoring"
import { judgeCandidate } from "../lib/candidate-quality"

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set")
    process.exit(1)
  }
  if (!process.env.APIFY_TOKEN) {
    console.error("APIFY_TOKEN not set")
    process.exit(1)
  }

  const pending = await db.select().from(candidates).where(eq(candidates.status, "pending"))
  const toRescore = pending.filter((c) => !c.aiScored && c.handle)
  console.log(`Pending: ${pending.length}, need re-scoring: ${toRescore.length}\n`)
  if (toRescore.length === 0) return

  // Batch profile-scrapes (50 at a time, but we have <50 so one batch)
  const usernames = toRescore.map((c) => (c.handle ?? "").replace("@", "").trim().toLowerCase())
  console.log(`Fetching ${usernames.length} fresh profiles from Apify…`)
  const profiles = await scrapeProfiles(usernames)
  const byUsername = new Map(profiles.map((p) => [(p.username ?? "").toLowerCase(), p]))
  console.log(`Got ${profiles.length} profiles\n`)

  let scored = 0
  let autoRejected = 0
  let errored = 0
  for (const c of toRescore) {
    const u = (c.handle ?? "").replace("@", "").trim().toLowerCase()
    const p = byUsername.get(u)
    const captions = (p?.latestPosts || []).map((x) => x.caption || "").filter(Boolean).slice(0, 8)
    const bio = p?.biography ?? c.bio ?? null

    try {
      const score = await scoreCandidate({
        handle: c.handle ?? `@${u}`,
        fullName: c.fullName,
        followers: c.followers,
        engagementRate: c.engagementRate,
        bio,
        location: c.location,
        recentCaptions: captions,
        externalUrl: c.externalUrl,
        sourceDetail: c.sourceDetail,
      })

      // Quality re-check with new AI signals
      const verdict = judgeCandidate({
        handle: c.handle,
        bio,
        followers: c.followers,
        engagementRate: c.engagementRate,
        personaMatch: score.personaMatch,
        fitScore: score.fitScore,
        nicheRelevant: score.nicheRelevant,
        externalUrl: c.externalUrl,
      })

      const updates: any = {
        fitScore: score.fitScore,
        fitReasoning: score.fitReasoning,
        personaMatch: score.personaMatch,
        nicheGuess: score.nicheGuess,
        nicheRelevant: score.nicheRelevant,
        rateBand: score.suggestedRateBand ?? c.rateBand,
        outreachAngle: score.outreachAngle,
        redFlags: score.redFlags.join("\n") || null,
        aiScored: score.aiScored,
      }

      // If quality verdict says no, auto-reject
      if (!verdict.keep) {
        updates.status = "rejected"
        updates.reviewedAt = new Date().toISOString()
        autoRejected++
        console.log(`  ✗ ${c.handle?.padEnd(28)} fit=${score.fitScore.toFixed(1)} → REJECTED: ${verdict.reason}`)
      } else {
        console.log(`  ✓ ${c.handle?.padEnd(28)} fit=${score.fitScore.toFixed(1)} ${score.personaMatch} → ${score.outreachAngle.slice(0, 80)}…`)
      }

      await db.update(candidates).set(updates).where(eq(candidates.id, c.id))
      scored++
    } catch (e) {
      errored++
      console.log(`  ! ${c.handle}: ${(e as Error).message}`)
    }
  }

  console.log(`\n═══ Done ═══`)
  console.log(`Re-scored:     ${scored}`)
  console.log(`Auto-rejected: ${autoRejected} (failed quality gate after AI re-look)`)
  console.log(`Errored:       ${errored}`)
}
main()
