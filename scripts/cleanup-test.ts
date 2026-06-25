import { db } from "../lib/db"
import { candidates } from "../lib/db/schema"
import { eq } from "drizzle-orm"

async function main() {
  const before = (await db.select().from(candidates)).length
  await db.delete(candidates).where(eq(candidates.handle, "@testcreator1"))
  const after = (await db.select().from(candidates)).length
  console.log(`candidates: ${before} → ${after} (cleaned test)`)
}
main()
