// Backfill avatar/email/bio for existing candidates by re-pulling their IG profiles
import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { eq, and, isNull, isNotNull } from "drizzle-orm"
import { scrapeProfiles, findEmail } from "../lib/apify-client"

async function main() {
  const all = await db.select().from(candidates)
  const pending = all.filter((c) => c.status === "pending")
  const missingAvatar = pending.filter((c) => !c.avatarUrl && (c.handle ?? "").trim().length > 2)

  console.log(`Pending candidates: ${pending.length}`)
  console.log(`Missing avatar:     ${missingAvatar.length}`)
  if (missingAvatar.length === 0) return

  const usernames = missingAvatar.map((c) => (c.handle ?? "").replace("@", "").trim().toLowerCase())
  console.log(`Scraping ${usernames.length} profiles via Apify...`)

  // Batch in 50s
  let enriched = 0
  let skipped = 0
  for (let i = 0; i < usernames.length; i += 50) {
    const batch = usernames.slice(i, i + 50)
    const profiles = await scrapeProfiles(batch)
    const byUsername = new Map(profiles.map((p) => [(p.username ?? "").toLowerCase(), p]))

    for (let j = 0; j < batch.length; j++) {
      const c = missingAvatar[i + j]
      const p = byUsername.get(batch[j])
      if (!p) { skipped++; continue }
      const pic = (p as any).profilePicUrlHD ?? (p as any).profilePicUrl
      const updates: Record<string, any> = {}
      if (pic) updates.avatarUrl = pic
      if (!c.bio && p.biography) updates.bio = p.biography.slice(0, 500)
      if (!c.followers && p.followersCount) updates.followers = p.followersCount
      if (!c.externalUrl && p.externalUrl) updates.externalUrl = p.externalUrl
      if (!c.email) {
        const found = await findEmail(p)
        if (found) updates.email = found
      }
      if (Object.keys(updates).length === 0) { skipped++; continue }
      await db.update(candidates).set(updates).where(eq(candidates.id, c.id))
      enriched++
      console.log(`  ${c.handle?.padEnd(28)} ${pic ? "📸" : "  "} ${updates.followers ?? "—"} fol`)
    }
  }
  console.log(`\n✅ ${enriched} candidates enriched, ${skipped} skipped`)
}
main()
