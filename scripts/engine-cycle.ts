// One scheduled refresh cycle (run every 20 minutes; see docs/changes/2026-10-29-engine-every-20-min.md).
//   npm run engine-cycle
// Refreshes the next slice of channels from the YouTube Data API, then reruns the engine on the full
// input so every lead is requalified. A full refresh of 275 channels costs ~556 quota units, so doing it
// 72 times a day would blow the 10,000-unit daily quota. A 10-channel slice (~21 units) per run walks
// the whole list in about a day. The cursor lives in data/engine-cycle-state.json.
// Daily YouTube budget with the defaults: refresh 72 × ~21 ≈ 1,500 + discovery (1 search every
// 40 min, ~200 units each, capped at 7,000) ≈ 8,500 of 10,000.
//
// Before the refresh, each cycle can also add leads:
//   1. Discovery (at most every --discover-every minutes, capped at --discover-units YouTube units
//      a day): the next --searches searches from data/discovery-queries.txt × --regions, one
//      results page deeper each time. Channels not already in the input are appended to it and
//      to the id file. Missing queries file = no discovery.
//   2. Entity check (scripts/classify-entities.ts) on the input. Answers are cached, so only new
//      channels cost model calls (Groq/Gemini, see the AI usage page).
// --no-discover / --no-classify turn either off. A failure in either is logged and the refresh
// still runs.
import fs from "node:fs"
import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"
import { parse } from "csv-parse/sync"
import { runEngine } from "../lib/leads/engine"
import { csvEscape } from "../lib/leads/export"
import { discoverStep, emptyDiscoveryState, type DiscoveryState } from "../lib/leads/cycle-discovery"

const { values } = parseArgs({
  options: {
    input: { type: "string", default: "data/discovered-2026-10-29.csv" },
    ids: { type: "string", default: "data/channel-ids-2026-10-29.txt" },
    slice: { type: "string", default: "10" },
    queries: { type: "string", default: "data/discovery-queries.txt" },
    regions: { type: "string", default: "US,GB,CA,AU,IE,NZ,SG" },
    searches: { type: "string", default: "1" },
    "discover-every": { type: "string", default: "40" },
    "discover-units": { type: "string", default: "7000" },
    "no-discover": { type: "boolean", default: false },
    "no-classify": { type: "boolean", default: false },
  },
})

const STATE = "data/engine-cycle-state.json"
const LOCK = "data/engine-cycle.lock"
const SLICE_FILE = "data/engine-cycle-slice.txt"
const STALE_LOCK_MS = 60 * 60 * 1000

function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < STALE_LOCK_MS) return false
    fs.writeFileSync(LOCK, String(process.pid))
    return true
  } catch {
    return false
  }
}

type State = { cursor?: number; lastRun?: string; discovery?: DiscoveryState }
const readState = (): State => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch { return {} } }
const writeState = (patch: State) => fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch }))

// Append discovered rows to the input CSV (union of columns; existing rows untouched) and their
// ids to the id file, so later slices refresh them too.
function appendRows(input: string, idsFile: string, rows: Record<string, unknown>[]) {
  const existing = parse(fs.readFileSync(input, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[]
  const cols = Object.keys(existing[0] ?? {})
  for (const r of rows) for (const c of Object.keys(r)) if (!cols.includes(c)) cols.push(c)
  const all = [...existing, ...rows]
  fs.writeFileSync(input, [cols.join(","), ...all.map((r) => cols.map((c) => csvEscape(String((r as Record<string, unknown>)[c] ?? ""))).join(","))].join("\n") + "\n")
  fs.appendFileSync(idsFile, rows.map((r) => String(r.stable_creator_id)).join("\n") + "\n")
}

async function discover(): Promise<number> {
  if (values["no-discover"]) return 0
  if (!fs.existsSync(values.queries!)) {
    console.log(`[discover] skipped: no ${values.queries} (one search query per line)`)
    return 0
  }
  const queries = fs.readFileSync(values.queries!, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
  const existing = parse(fs.readFileSync(values.input!, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[]
  const r = await discoverStep({
    queries, regions: values.regions!.split(",").map((x) => x.trim()).filter(Boolean),
    existingIds: new Set(existing.map((x) => x.stable_creator_id)),
    state: readState().discovery ?? emptyDiscoveryState(), now: new Date(), apiKey: process.env.YOUTUBE_API_KEY,
    searches: Number(values.searches), dailyUnits: Number(values["discover-units"]), everyMin: Number(values["discover-every"]),
  })
  if (r.skipped) {
    console.log(`[discover] skipped: ${r.skipped}`)
    writeState({ discovery: r.state })
    return 0
  }
  if (r.rows.length) appendRows(values.input!, values.ids!, r.rows)
  writeState({ discovery: r.state })
  console.log(`[discover] ${r.searched.join("; ")} → ${r.rows.length} new channels added (${r.units} units, ${r.state.unitsToday}/${values["discover-units"]} today)`)
  return r.rows.length
}

// The entity check runs as its own script (same Node flags, so .env.local and tsx carry over).
function classify() {
  if (values["no-classify"]) return
  const r = spawnSync(process.execPath, [...process.execArgv, "scripts/classify-entities.ts", "--in", values.input!], { encoding: "utf8" })
  // The script ends with its summary as pretty-printed JSON: "{" and "}" alone on their lines.
  const summary = /^\{\r?\n[\s\S]*^\}\s*$/m.exec(r.stdout ?? "")?.[0]
  try {
    const s = JSON.parse(summary ?? "")
    console.log(`[classify] checked ${s.classified} (cache ${s.fromCache}): ${s.individual} individual, ${s.excluded} excluded, ${s.leftForReview} for review, ${s.errors} errors${s.stoppedReason ? `; stopped: ${s.stoppedReason.slice(0, 160)}` : ""}`)
  } catch {
    console.log(`[classify] failed (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" ").slice(0, 300)}`)
  }
}

async function main() {
  if (!acquireLock()) {
    console.log("[cycle] previous run still going, skipping")
    return
  }
  try {
    try { await discover() } catch (e) { console.log(`[discover] failed: ${(e as Error).message}`) }
    classify()

    const lines = fs.readFileSync(values.ids!, "utf8").split(/\r?\n/).filter((l) => l.replace(/#.*/, "").trim())
    const size = Math.max(1, Number(values.slice))
    let cursor = readState().cursor ?? 0
    if (cursor >= lines.length) cursor = 0
    const slice = lines.slice(cursor, cursor + size)
    fs.writeFileSync(SLICE_FILE, slice.join("\n") + "\n")
    console.log(`[cycle] ${new Date().toISOString()} refreshing channels ${cursor + 1}-${cursor + slice.length} of ${lines.length}`)

    const s = await runEngine({
      provider: "file",
      input: values.input,
      youtubeIdsFile: SLICE_FILE,
      log: (m) => console.log(`[engine] ${m}`),
    })
    // Advance only after a successful run, so a failed slice is retried next time.
    if (s.status === "succeeded") writeState({ cursor: cursor + slice.length, lastRun: s.runId })
    console.log(`[cycle] ${s.status}: qualified ${s.qualified}, unverified ${s.unverified}, rejected ${s.rejected}, failed ${s.failed}, api units ${s.apiUnits}`)
    if (s.status !== "succeeded") process.exitCode = 1
  } finally {
    fs.rmSync(LOCK, { force: true })
  }
}

main().catch((e) => {
  fs.rmSync(LOCK, { force: true })
  console.error(`[cycle] fatal: ${(e as Error).message}`)
  process.exitCode = 1
})
