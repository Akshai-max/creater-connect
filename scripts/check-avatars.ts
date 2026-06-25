import { db } from "../lib/db"
import { creators } from "../lib/db/schema"
import { isNotNull } from "drizzle-orm"

async function main() {
  const all = await db.select().from(creators).where(isNotNull(creators.avatarUrl))
  console.log(`${all.length} creators have avatarUrl stored\n`)

  console.log("Sample of stored URLs:")
  for (const c of all.slice(0, 3)) {
    console.log(`\n@${c.handle?.replace("@", "")} (${c.name}):`)
    console.log(`  url: ${c.avatarUrl}`)
  }

  // Try fetching one to see if it's accessible
  const sample = all[0]
  if (sample?.avatarUrl) {
    console.log(`\n=== Test fetch of ${sample.handle} avatar ===`)
    try {
      const r = await fetch(sample.avatarUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      })
      console.log(`  status: ${r.status}`)
      console.log(`  content-type: ${r.headers.get("content-type")}`)
      console.log(`  content-length: ${r.headers.get("content-length")}`)
    } catch (e: any) {
      console.log(`  error: ${e.message}`)
    }
  }
}
main()
