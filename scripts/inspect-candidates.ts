import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { eq, desc } from "drizzle-orm"

async function main() {
  const all = await db.select().from(candidates).where(eq(candidates.status, "pending")).orderBy(desc(candidates.fitScore))
  console.log(`Total pending candidates: ${all.length}\n`)

  console.log("Top 15 by fit score:")
  console.log("─".repeat(100))
  for (const c of all.slice(0, 15)) {
    const flags = c.redFlags ? ` ⚠ ${c.redFlags.split("\n").length} flags` : ""
    const ai = c.aiScored ? "🤖" : "—"
    const us = c.isUS === true ? "🇺🇸" : c.isUS === false ? "🌍" : "?"
    console.log(`${ai} ${us} fit=${(c.fitScore ?? 0).toFixed(1)}  ${c.handle.padEnd(32)} ${c.followers?.toLocaleString().padStart(8)} fol  ${c.personaMatch ?? "?"}${flags}`)
    if (c.outreachAngle) console.log(`     → ${c.outreachAngle}`)
  }
  console.log()

  console.log("Discovery sources (this batch):")
  const bySource: Record<string, number> = {}
  for (const c of all) {
    const s = c.source ?? "unknown"
    bySource[s] = (bySource[s] ?? 0) + 1
  }
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} ${n}`)
  }
}
main()
