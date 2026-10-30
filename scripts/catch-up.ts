// Catch-up: unblock the leads already found, as fast as the rules allow.
//   npm run catch-up                       (all leads waiting on a contact or the entity check)
//   npm run catch-up -- --contacts 300     (cap the website lookups)
// Most unverified leads miss a contact route or the entity check; the 20-minute cycle only does
// 25 contact lookups and 150 entity checks per run. This runs both over the whole backlog once,
// then reruns the engine so the Leads page shows the result. Same rules as the cycle: only emails
// published on the creator's own site (robots.txt honoured), only quotes in the creator's own words.
// It holds the cycle's lock, refreshed every few minutes, so scheduled cycles skip while it runs
// instead of writing the lead file at the same time.
import fs from "node:fs"
import { spawn } from "node:child_process"
import { parseArgs } from "node:util"
import { runEngine } from "../lib/leads/engine"

const { values } = parseArgs({
  options: {
    input: { type: "string", default: "data/discovered-2026-10-29.csv" },
    contacts: { type: "string", default: "2000" },
    "contact-minutes": { type: "string", default: "150" },
    entity: { type: "string", default: "1200" },
    "no-contacts": { type: "boolean", default: false },
    "no-entity": { type: "boolean", default: false },
  },
})

const LOCK = "data/engine-cycle.lock"
const pidAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" }
}

// Runs a script with the same Node flags (.env.local, tsx), streaming its output.
function run(script: string, args: string[]) {
  return new Promise<number>((resolve) => {
    const p = spawn(process.execPath, [...process.execArgv, script, ...args], { stdio: "inherit" })
    p.on("exit", (code) => resolve(code ?? 1))
  })
}

async function main() {
  // Wait for a running cycle to finish rather than writing the lead file under it.
  for (let i = 0; fs.existsSync(LOCK) && pidAlive(Number(fs.readFileSync(LOCK, "utf8"))); i++) {
    if (i === 0) console.log("[catch-up] a cycle is running; waiting for it to finish")
    if (i > 240) throw new Error("a cycle has held the lock for 20 minutes; try again later")
    await new Promise((r) => setTimeout(r, 5000))
  }
  fs.writeFileSync(LOCK, String(process.pid))
  // The cycle treats a lock older than an hour as stale, so keep it fresh while this runs.
  const keepFresh = setInterval(() => { try { fs.writeFileSync(LOCK, String(process.pid)) } catch { /* next tick */ } }, 5 * 60_000)
  const started = Date.now()
  try {
    if (!values["no-contacts"]) {
      console.log(`[catch-up] contacts: up to ${values.contacts} leads, ${values["contact-minutes"]} min`)
      await run("scripts/find-contacts.ts", ["--in", values.input!, "--limit", values.contacts!, "--max-minutes", values["contact-minutes"]!])
    }
    if (!values["no-entity"]) {
      console.log(`[catch-up] entity check: up to ${values.entity} model calls`)
      // With video descriptions for the leads that only the entity check stands between.
      await run("scripts/classify-entities.ts", ["--in", values.input!, "--limit", values.entity!, "--with-descriptions"])
    }
    console.log("[catch-up] rerunning the engine on the updated file")
    const s = await runEngine({ provider: "file", input: values.input, log: (m) => console.log(`[engine] ${m}`), extraMetrics: { catchUp: true } })
    console.log(`[catch-up] ${s.status} in ${Math.round((Date.now() - started) / 60_000)} min: qualified ${s.qualified}, unverified ${s.unverified}, rejected ${s.rejected}`)
  } finally {
    clearInterval(keepFresh)
    fs.rmSync(LOCK, { force: true })
  }
}

main().catch((e) => {
  console.error(`[catch-up] ${(e as Error).message}`)
  process.exitCode = 1
})
