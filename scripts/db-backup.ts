// Backup of the local Docker database (docker-compose.yml "postgres") to data/backups/.
//   npm run db:backup
// The data lives only on this machine now, so run this now and then (and before big changes).
// Restore into the container:
//   docker exec -i creator-crm-postgres pg_restore -U crm -d creator_crm --clean --if-exists --no-owner < data/backups/<file>.dump
// Keeps the newest --keep backups (default 14) and deletes older local-*.dump files.
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: { keep: { type: "string", default: "14" }, dir: { type: "string", default: "data/backups" } } })

async function main() {
  fs.mkdirSync(values.dir!, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13)
  const file = path.join(values.dir!, `local-${stamp}Z.dump`) // UTC time, so names sort correctly
  const code = await new Promise<number>((resolve) => {
    const p = spawn("docker", ["exec", "creator-crm-postgres", "pg_dump", "-U", "crm", "-d", "creator_crm", "--format=custom", "--no-owner"], { stdio: ["ignore", "pipe", "inherit"] })
    p.stdout.pipe(fs.createWriteStream(file))
    p.on("exit", (c) => resolve(c ?? 1))
    p.on("error", () => resolve(1))
  })
  if (code !== 0) {
    fs.rmSync(file, { force: true })
    throw new Error("pg_dump failed: is Docker Desktop running and the creator-crm-postgres container up? (docker compose --env-file .env.local up -d postgres)")
  }
  console.log(`[backup] ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`)
  const old = fs.readdirSync(values.dir!).filter((f) => /^local-.*\.dump$/.test(f)).sort().reverse().slice(Number(values.keep))
  for (const f of old) fs.rmSync(path.join(values.dir!, f))
  if (old.length) console.log(`[backup] removed ${old.length} older backups (keeping ${values.keep})`)
}

main().catch((e) => {
  console.error(`[backup] ${(e as Error).message}`)
  process.exitCode = 1
})
