import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { eq } from "drizzle-orm"

async function main() {
  const all = await db.select().from(candidates).where(eq(candidates.status, "pending"))
  const aiScored = all.filter((c) => c.aiScored).sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
  console.log(`Total pending: ${all.length}`)
  console.log(`AI-scored:     ${aiScored.length}`)
  console.log(`Heuristic:     ${all.length - aiScored.length}\n`)

  for (const c of aiScored.slice(0, 8)) {
    console.log(`@${c.handle?.replace("@", "")} — fit ${c.fitScore?.toFixed(1)}/10 — ${c.personaMatch} — ${c.rateBand ?? "?"}`)
    console.log(`  ${c.fullName} · ${(c.followers ?? 0).toLocaleString()} fol · ${c.engagementRate?.toFixed(1) ?? "?"}% ER`)
    console.log(`  → ${c.outreachAngle}`)
    if (c.redFlags) console.log(`  ⚠ ${c.redFlags.split("\n").join(" · ")}`)
    if (c.nicheGuess) console.log(`  niche: ${c.nicheGuess}`)
    console.log()
  }
}
main()
