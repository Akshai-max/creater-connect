import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import * as schema from "./schema"

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example → .env.local and add a Neon Postgres connection string. See README for setup steps."
  )
}

const client = neon(process.env.DATABASE_URL)
export const db = drizzle(client, { schema })
export { schema }
