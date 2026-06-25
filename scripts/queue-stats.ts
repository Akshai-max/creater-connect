import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { eq, desc } from "drizzle-orm"

async function main() {
  const all = await db.select().from(candidates)
  const by = { pending: 0, approved: 0, rejected: 0 }
  for (const c of all) by[c.status as keyof typeof by] = (by[c.status as keyof typeof by] ?? 0) + 1

  console.log(`Candidate queue:`)
  console.log(`  pending:  ${by.pending}`)
  console.log(`  approved: ${by.approved}`)
  console.log(`  rejected: ${by.rejected}`)
  console.log(`  total:    ${all.length}`)

  console.log(`\nTop 15 pending by fit score:`)
  const pending = all.filter((c) => c.status === "pending").sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
  for (const c of pending.slice(0, 15)) {
    const us = c.isUS ? "🇺🇸" : "  "
    const ai = c.aiScored ? "🤖" : "h"
    console.log(`  ${us} ${ai} fit=${(c.fitScore ?? 0).toFixed(1)}  ${c.handle?.padEnd(28)} ${(c.followers ?? 0).toLocaleString().padStart(8)} fol  ${c.personaMatch ?? "?"}`)
  }
}
main()
