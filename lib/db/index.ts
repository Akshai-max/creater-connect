import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http"
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres"
import type { SQL } from "drizzle-orm"
import { neon } from "@neondatabase/serverless"
import { Pool } from "pg"
import * as schema from "./schema"

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example → .env.local and add a Postgres connection string (the local Docker one, or Neon). See README for setup steps."
  )
}
const url = process.env.DATABASE_URL

// A database on this machine (the Docker one in docker-compose.yml) is reached with the standard pg
// driver; anything else is Neon over HTTP. Neon's HTTP API refuses responses over 64 MB, which the
// leads table outgrew; a local database has no such limit.
export const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url)

type Db = NeonHttpDatabase<typeof schema>

function localDb(): Db {
  // One pool per process: Next's dev server re-evaluates modules on every edit.
  const g = globalThis as unknown as { __crmPgPool?: Pool }
  // allowExitOnIdle: scripts exit when their work is done instead of waiting on idle connections.
  g.__crmPgPool ??= new Pool({ connectionString: url, max: 10, allowExitOnIdle: true })
  const pg: NodePgDatabase<typeof schema> = drizzlePg(g.__crmPgPool, { schema })
  // db.batch is a neon-http feature (one round trip, one transaction). Same here: a transaction
  // that runs each statement in order, so callers don't change.
  const batch = async (stmts: { getSQL(): SQL }[]) => {
    const out: unknown[] = []
    await pg.transaction(async (tx) => {
      for (const s of stmts) out.push(await tx.execute(s.getSQL()))
    })
    return out
  }
  // Both drivers share drizzle's query builder; typed as the Neon one so existing code compiles unchanged.
  return Object.assign(pg, { batch }) as unknown as Db
}

export const db: Db = isLocalDb ? localDb() : drizzleNeon(neon(url), { schema })
export { schema }
