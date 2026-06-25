// Reset enrichedAt for IG creators with no avatar so the next batch re-pulls them.
import { db } from "../lib/db"
import { creators } from "../lib/db/schema"
import { sql, isNull } from "drizzle-orm"

async function main() {
  const result: any = await db.execute(sql`
    UPDATE creators
    SET enriched_at = NULL
    WHERE avatar_url IS NULL
      AND lower(coalesce(platform, '')) IN ('ig', 'instagram')
      AND handle IS NOT NULL
      AND length(replace(handle, '@', '')) >= 3
      AND lower(replace(handle, '@', '')) NOT IN ('ps', 'reel', 'gmail.com', 'hotmail.com', 'yahoo.com')
      AND handle NOT LIKE '%@%@%'
      AND handle NOT LIKE '%.com'
  `)
  console.log("Reset enrichedAt for IG creators missing avatar (excluding junk handles)")
}
main()
