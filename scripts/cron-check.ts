import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { gte, eq, and } from "drizzle-orm"

async function main() {
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
  const all = await db.select().from(candidates).where(eq(candidates.status, "pending"))
  const cronRuns = all.filter((c) => (c.discoveredAt ?? "") > cutoff && c.source === "auto-discovery")
  console.log(`Pending total:        ${all.length}`)
  console.log(`From cron (last 36h): ${cronRuns.length}`)
  if (cronRuns.length) {
    console.log("\nTop 5 newest:")
    for (const c of cronRuns.slice(0, 5)) {
      console.log(`  fit=${(c.fitScore ?? 0).toFixed(1)}  ${c.handle?.padEnd(28)} ${(c.followers ?? 0).toLocaleString().padStart(8)} fol  ${c.sourceDetail}`)
    }
  }
}
main()
