// Reset enrichedAt for creators missing avatarUrl so the next batch re-pulls them
import { db } from "../lib/db"
import { creators } from "../lib/db/schema"
import { isNull, sql, and } from "drizzle-orm"

async function main() {
  const before = await db.select().from(creators)
  const needAvatar = before.filter((c) => !c.avatarUrl && (c.platform ?? "").toLowerCase() === "ig" && c.handle && !c.handle.includes("@") === false).length
  console.log(`Creators missing avatarUrl with IG handle: ${needAvatar}`)

  // Clear enrichedAt where avatarUrl is null
  const result = await db.execute(sql`UPDATE creators SET enriched_at = NULL WHERE avatar_url IS NULL`)
  console.log("Reset enrichedAt for all creators missing avatar")
}
main()
