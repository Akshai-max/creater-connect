// Why some creators have avatars and some don't — break down the reasons
import { db } from "../lib/db"
import { creators } from "../lib/db/schema"

async function main() {
  const all = await db.select().from(creators)

  let hasAvatar = 0
  let noHandle = 0
  let junkHandle = 0
  let nonIgPlatform = 0
  let igButNotEnriched = 0
  let enrichedButNoMatch = 0

  const examples: Record<string, string[]> = {
    junkHandle: [],
    nonIgPlatform: [],
    enrichedButNoMatch: [],
  }

  for (const c of all) {
    if (c.avatarUrl) { hasAvatar++; continue }

    const platform = (c.platform ?? "").toLowerCase()
    const h = (c.handle ?? "").replace("@", "").trim().toLowerCase()

    if (!h) {
      noHandle++
      continue
    }
    if (h.length < 3 || ["ps", "reel", "gmail.com"].includes(h) || h.includes(".com") || h.includes("@")) {
      junkHandle++
      if (examples.junkHandle.length < 5) examples.junkHandle.push(`${c.id} ${c.handle}`)
      continue
    }
    if (platform !== "ig" && platform !== "instagram") {
      nonIgPlatform++
      if (examples.nonIgPlatform.length < 5) examples.nonIgPlatform.push(`${c.id} ${c.handle} (${c.platform})`)
      continue
    }
    // IG handle, no avatar, but enrichedAt is set → Apify found nothing
    if (c.enrichedAt) {
      enrichedButNoMatch++
      if (examples.enrichedButNoMatch.length < 5) examples.enrichedButNoMatch.push(`${c.id} ${c.handle}`)
    } else {
      igButNotEnriched++
    }
  }

  console.log(`Avatar coverage breakdown across ${all.length} creators:\n`)
  console.log(`  ✅ Have avatar:                 ${hasAvatar}`)
  console.log(`  ❌ No handle at all:            ${noHandle}`)
  console.log(`  ❌ Junk/placeholder handle:     ${junkHandle}`)
  console.log(`  ❌ Non-IG platform (TikTok/YT): ${nonIgPlatform}`)
  console.log(`  ❌ IG handle, Apify couldn't match: ${enrichedButNoMatch}`)
  console.log(`  ❌ IG handle, never enriched:   ${igButNotEnriched}`)

  console.log("\nExamples:")
  for (const [bucket, list] of Object.entries(examples)) {
    if (list.length === 0) continue
    console.log(`\n  ${bucket}:`)
    for (const s of list) console.log(`    - ${s}`)
  }
}
main()
