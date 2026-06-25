// Extract follower counts mentioned in flagNotes ("89.4K Following", "44.5K following")
// and backfill them into the dedicated followers column.
import { db } from "../lib/db"
import { creators } from "../lib/db/schema"
import { eq, isNull, or, sql } from "drizzle-orm"

function parseFollowerMention(notes: string): number | null {
  // Patterns: "89.4K Following", "44.5K following", "84500 followers", "13.2K following"
  const m = notes.match(/(\d+(?:\.\d+)?)\s*([Kk])?\s+(?:following|followers)/i)
  if (!m) return null
  const num = parseFloat(m[1])
  const isThousands = !!m[2]
  return Math.round(isThousands ? num * 1000 : num)
}

async function main() {
  const all = await db.select().from(creators)
  let updated = 0
  let scanned = 0
  for (const c of all) {
    if (c.followers && c.followers > 0) continue // already has followers
    const notes = c.flagNotes ?? ""
    const f = parseFollowerMention(notes)
    if (f && f > 100) {
      await db.update(creators).set({ followers: f }).where(eq(creators.id, c.id))
      console.log(`  ${c.id} ${c.name.padEnd(30)} → ${f.toLocaleString()} (from notes)`)
      updated++
    }
    scanned++
  }
  console.log(`\n✅ Scanned ${scanned}, backfilled ${updated} creators with followers from notes`)
}
main()
