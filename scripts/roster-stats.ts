import { db } from "../lib/db"
import { creators } from "../lib/db/schema"

async function main() {
  const all = await db.select().from(creators)
  const total = all.length
  const withFollowers = all.filter((c) => c.followers && c.followers > 0).length
  const withEmail = all.filter((c) => c.email).length
  const withBio = all.filter((c) => c.bio).length
  const withER = all.filter((c) => c.engagementRate != null).length
  const withExtUrl = all.filter((c) => c.externalUrl).length
  const enriched = all.filter((c) => c.enrichedAt).length

  console.log(`Roster: ${total} creators\n`)
  console.log("Field coverage:")
  console.log(`  followers:       ${withFollowers.toString().padStart(3)} / ${total} (${((withFollowers / total) * 100).toFixed(0)}%)`)
  console.log(`  email:           ${withEmail.toString().padStart(3)} / ${total} (${((withEmail / total) * 100).toFixed(0)}%)`)
  console.log(`  bio:             ${withBio.toString().padStart(3)} / ${total} (${((withBio / total) * 100).toFixed(0)}%)`)
  console.log(`  engagement rate: ${withER.toString().padStart(3)} / ${total} (${((withER / total) * 100).toFixed(0)}%)`)
  console.log(`  external URL:    ${withExtUrl.toString().padStart(3)} / ${total} (${((withExtUrl / total) * 100).toFixed(0)}%)`)
  console.log(`  enrichedAt set:  ${enriched.toString().padStart(3)} / ${total}`)

  // Follower distribution
  const tiers = { "<1k": 0, "1-5k": 0, "5-10k": 0, "10-30k": 0, "30-100k": 0, "100k-500k": 0, ">500k": 0, "?": 0 }
  for (const c of all) {
    const f = c.followers ?? 0
    if (!c.followers) tiers["?"]++
    else if (f < 1000) tiers["<1k"]++
    else if (f < 5000) tiers["1-5k"]++
    else if (f < 10000) tiers["5-10k"]++
    else if (f < 30000) tiers["10-30k"]++
    else if (f < 100000) tiers["30-100k"]++
    else if (f < 500000) tiers["100k-500k"]++
    else tiers[">500k"]++
  }
  console.log("\nFollower tier distribution:")
  for (const [tier, n] of Object.entries(tiers)) {
    if (n > 0) console.log(`  ${tier.padEnd(11)} ${n}`)
  }
}
main()
