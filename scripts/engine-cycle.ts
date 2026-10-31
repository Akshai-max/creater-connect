// One scheduled refresh cycle (run every 20 minutes; see docs/changes/2026-10-29-engine-every-20-min.md).
//   npm run engine-cycle
// Refreshes the next slice of channels from the YouTube Data API, then reruns the engine on the full
// input so every lead is requalified. A full refresh of 275 channels costs ~556 quota units, so doing it
// 72 times a day would blow the 10,000-unit daily quota. A 10-channel slice (~21 units) per run walks
// the whole list in about a day. The cursor lives in data/engine-cycle-state.json.
// Daily YouTube budget per key (Cloud project), as its quota page lists it: 100 searches ("Search
// Queries per day") and 10,000 units for everything else ("Queries per day"). A discovery step makes
// 50 searches and fetches as many new channels as the remaining units allow (~2 units each), so a
// fresh key gives roughly 3,000-4,500 new channels in two steps; after that featured channels, guest
// links and Apple Podcasts keep running on what's left, and a new key starts again.
// Refresh (~21 a cycle) and contact units count against the same counter, with 100 kept back for
// refreshes. A new key (new fingerprint) starts fresh counters.
//
// Before the refresh, each cycle can also add leads:
//   1. Discovery (lib/leads/cycle-discovery.ts; at most every --discover-every minutes, capped at
//      --discover-units YouTube units a day): featured channels of up to --featured confirmed
//      individual creators, guest links from video descriptions (--guest-scan existing channels
//      read per step), one Apple Podcasts directory search whose RSS feeds link a YouTube channel
//      (--no-apple turns it off; feed owner emails fill leads that have none), then --searches searches from data/discovery-queries.txt × --regions,
//      alternating between the newest videos since the last search and a depth-first channel
//      search (--search-mode both|video|channel; a channel page with fewer than --min-new new
//      channels ends that search). Channels not already in the input are appended to it and to
//      the id file. Missing queries file = searches off (featured channels still run).
//   2. Entity check (scripts/classify-entities.ts) on the input. Answers are cached, so only new
//      channels cost model calls (Groq/Gemini, see the AI usage page).
//   3. Website contacts (scripts/find-contacts.ts): up to --contacts-limit leads without an email get
//      their own linked site read for a published business email (1 unit each, robots.txt honoured).
// --no-discover / --no-classify / --no-contacts turn each off. A failure in either is logged and the refresh
// still runs.
import fs from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"
import { parse } from "csv-parse/sync"
import { runEngine } from "../lib/leads/engine"
import { csvEscape } from "../lib/leads/export"
import { applyFeedEmail, discoverStep, emptyDiscoveryState, pacificDay, type DiscoveryState, type FeedEmail } from "../lib/leads/cycle-discovery"
import { fetchAndQualifyCreators } from "../lib/leads/multi-platform"

const { values } = parseArgs({
  options: {
    input: { type: "string", default: "data/discovered-2026-10-29.csv" },
    ids: { type: "string", default: "data/channel-ids-2026-10-29.txt" },
    slice: { type: "string", default: "10" },
    queries: { type: "string", default: "data/discovery-queries.txt" },
    // English results barely differ between regions: on 2026-10-31 "leadership podcast" pages found
    // 31-47 new channels each in the US but 0-2 in GB/AU/CA/IE/NZ/SG, so other regions mostly spend
    // the 100 daily searches on channels already found. One region, more queries. (A channel's
    // country comes from its own settings, not the search region.)
    regions: { type: "string", default: "US" },
    // All of a key's daily searches in one step: a fresh key is used up in a single cycle (its units go
    // on fetching the channels found, ~2 each), then the next key can be put in .env.local.
    searches: { type: "string", default: "100" },
    // New channels added per discovery step; extra ones carry over to the next step.
    // A ceiling: each step takes as many new channels as the key's remaining units allow (~2 each).
    "max-new": { type: "string", default: "5000" },
    "search-mode": { type: "string", default: "both" },
    "min-new": { type: "string", default: "10" },
    featured: { type: "string", default: "25" },
    // Guest links: existing channels whose video descriptions are read per step (2 units each), and
    // queued links checked per step (1 unit each). Searches cap at 100 a day while units go up to
    // 10,000, so these use the units searches can't: 2,306 links were waiting at 20 a step.
    "guest-scan": { type: "string", default: "200" },
    "guest-resolve": { type: "string", default: "1500" },
    // Apple Podcasts directory + RSS feeds (no YouTube units except resolving a feed's YouTube link).
    "no-apple": { type: "boolean", default: false },
    "apple-feeds": { type: "string", default: "15" },
    "discover-every": { type: "string", default: "10" },
    // A key's whole daily YouTube quota. Refresh and contact units count against it too (added after
    // each run), and --reserve-units are kept back so the 20-minute refreshes keep working.
    "discover-units": { type: "string", default: "10000" },
    "reserve-units": { type: "string", default: "100" },
    // Newer Cloud projects list "Search Queries per day" (100) apart from "Queries per day" (10,000);
    // a search then counts there, and 1 unit against the 10,000. Set --search-units 100 and
    // --daily-searches 100000 for the classic model (a search costs 100 units, no separate limit).
    "daily-searches": { type: "string", default: "100" },
    "search-units": { type: "string", default: "1" },
    "no-discover": { type: "boolean", default: false },
    "no-classify": { type: "boolean", default: false },
    // Entity checks per cycle (cached, so the rest are done next cycle). Keeps a 500-channel batch
    // from holding the cycle lock for an hour while Groq/Gemini rate limits are waited out.
    "classify-limit": { type: "string", default: "400" },
    // Website contact lookups per cycle (scripts/find-contacts.ts): 1 YouTube unit each plus a few
    // pages on the creator's own site. Each lead is looked up once a month at most.
    "contacts-limit": { type: "string", default: "25" },
    "no-contacts": { type: "boolean", default: false },
    "multiplatform": { type: "boolean", default: true },
    "no-multiplatform": { type: "boolean", default: false },
    "multiplatform-limit": { type: "string", default: "5" },
  },
})

const STATE = "data/engine-cycle-state.json"
const LOCK = "data/engine-cycle.lock"
const SLICE_FILE = "data/engine-cycle-slice.txt"
const STALE_LOCK_MS = 60 * 60 * 1000

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (process.platform === "win32") {
    try {
      const res = spawnSync("powershell", ["-NoProfile", "-Command", `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 1 } else { 0 }`], { encoding: "utf8", timeout: 3000 })
      return res.stdout?.trim() === "1"
    } catch {
      return false
    }
  }
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" }
}

function acquireLock(): boolean {
  try {
    // A cycle that was killed (window closed, Ctrl+C, reboot) never removes its lock, so a lock only
    // counts while the process that wrote it is still running.
    if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < STALE_LOCK_MS && pidAlive(Number(fs.readFileSync(LOCK, "utf8")))) return false
    fs.writeFileSync(LOCK, String(process.pid))
    return true
  } catch {
    return false
  }
}

type State = { cursor?: number; lastRun?: string; discovery?: DiscoveryState; keyId?: string }
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

function fillEmails(input: string, updates: Record<string, FeedEmail>): number {
  const rows = parse(fs.readFileSync(input, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[]
  let n = 0
  for (const row of rows) if (updates[row.stable_creator_id] && applyFeedEmail(row, updates[row.stable_creator_id])) n++
  if (!n) return 0
  const cols = Object.keys(rows[0] ?? {})
  for (const c of ["email", "email_evidence_url", "email_last_active", "email_source", "email_business_use", "email_quote", "review_notes"]) if (!cols.includes(c)) cols.push(c)
  fs.writeFileSync(input, [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(String(r[c] ?? ""))).join(","))].join("\n") + "\n")
  return n
}

// What this cycle's discovery did, recorded with the engine run for the Engine page.
export type DiscoveryReport = {
  status: "added" | "none_new" | "skipped" | "failed" | "off"
  added: number
  units: number
  sources: string[] // e.g. 'videos "marketing podcast" GB since …: 40 channels, 38 new'
  reason?: string // why it was skipped or failed
  nextAt?: string | null // when the next search is due
  unitsToday?: number
  dailyUnits?: number
  searchesToday?: number
  dailySearches?: number
}
export type EntityReport =
  | { checked: number; individual: number; excluded: number; forReview: number; errors: number; stopped?: string | null }
  | { failed: string }

const nextDue = (lastAt: string | null | undefined) =>
  lastAt ? new Date(Date.parse(lastAt) + Number(values["discover-every"]) * 60_000).toISOString() : null

// The discovery unit counter belongs to one YouTube key. A new key (a new Google account or project)
// has its own daily quota, so the counter and the next-search timer restart when the key changes.
// Only a fingerprint of the key is stored, never the key. The first run just records it.
function resetCounterIfKeyChanged() {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return
  const keyId = createHash("sha256").update(key).digest("hex").slice(0, 12)
  const st = readState()
  if (st.keyId === keyId) return
  if (st.keyId && st.discovery) {
    console.log(`[discover] YouTube key changed: daily unit counter reset (was ${st.discovery.unitsToday ?? 0})`)
    writeState({ keyId, discovery: { ...st.discovery, unitsToday: 0, searchesToday: 0, lastAt: null } })
  } else writeState({ keyId })
}

async function discover(): Promise<DiscoveryReport> {
  if (values["no-discover"]) return { status: "off", added: 0, units: 0, sources: [], reason: "--no-discover" }
  resetCounterIfKeyChanged()
  const queries = fs.existsSync(values.queries!)
    ? fs.readFileSync(values.queries!, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
    : []
  if (!queries.length) console.log(`[discover] no queries in ${values.queries} (one search per line): searches off`)
  const existing = parse(fs.readFileSync(values.input!, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[]
  const mode = values["search-mode"] as "both" | "video" | "channel"
  if (!["both", "video", "channel"].includes(mode)) throw new Error(`--search-mode must be both, video or channel (got ${mode})`)
  const r = await discoverStep({
    queries, regions: values.regions!.split(",").map((x) => x.trim()).filter(Boolean),
    existingIds: new Set(existing.map((x) => x.stable_creator_id)),
    state: readState().discovery ?? emptyDiscoveryState(), now: new Date(), apiKey: process.env.YOUTUBE_API_KEY,
    searches: Number(values.searches), maxNew: Number(values["max-new"]), dailyUnits: Number(values["discover-units"]) - Number(values["reserve-units"]),
    dailySearches: Number(values["daily-searches"]), searchUnitCost: Number(values["search-units"]), everyMin: Number(values["discover-every"]),
    mode, minNew: Number(values["min-new"]), featuredPerStep: Number(values.featured),
    // Confirmed individuals only: their featured channels are the ones most likely to be creators too.
    featuredFrom: existing.filter((x) => x.entity_type === "individual").map((x) => x.stable_creator_id),
    guestScanPerStep: Number(values["guest-scan"]), guestResolvePerStep: Number(values["guest-resolve"]),
    apple: !values["no-apple"], appleFeedsPerStep: Number(values["apple-feeds"]),
  })
  // Feed emails for leads already in the file that have none (never overwrites an email).
  const filled = Object.keys(r.emailUpdates).length ? fillEmails(values.input!, r.emailUpdates) : 0
  if (filled) r.searched.push(`podcast feed emails added to ${filled} existing leads`)
  const budget = { unitsToday: r.state.unitsToday, dailyUnits: Number(values["discover-units"]), searchesToday: r.state.searchesToday ?? 0, dailySearches: Number(values["daily-searches"]) }
  if (r.skipped) {
    console.log(`[discover] skipped: ${r.skipped}`)
    writeState({ discovery: r.state })
    return { status: "skipped", added: 0, units: 0, sources: [], reason: r.skipped, nextAt: nextDue(r.state.lastAt), ...budget }
  }
  if (r.rows.length) appendRows(values.input!, values.ids!, r.rows)
  writeState({ discovery: r.state })
  console.log(`[discover] ${r.searched.join("; ")} → ${r.rows.length} new channels added (${r.units} units, ${r.state.unitsToday}/${values["discover-units"]} today)`)
  return { status: r.rows.length ? "added" : "none_new", added: r.rows.length, units: r.units, sources: r.searched, nextAt: nextDue(r.state.lastAt), ...budget }
}

// The entity check runs as its own script (same Node flags, so .env.local and tsx carry over).
function classify(): EntityReport | null {
  if (values["no-classify"]) return null
  const r = spawnSync(process.execPath, [...process.execArgv, "scripts/classify-entities.ts", "--in", values.input!, "--limit", values["classify-limit"]!], { encoding: "utf8" })
  // The script ends with its summary as pretty-printed JSON: "{" and "}" alone on their lines.
  const summary = /^\{\r?\n[\s\S]*^\}\s*$/m.exec(r.stdout ?? "")?.[0]
  try {
    const s = JSON.parse(summary ?? "")
    console.log(`[classify] checked ${s.classified} (cache ${s.fromCache}): ${s.individual} individual, ${s.excluded} excluded, ${s.leftForReview} for review, ${s.errors} errors${s.stoppedReason ? `; stopped: ${s.stoppedReason.slice(0, 160)}` : ""}`)
    return { checked: s.classified, individual: s.individual, excluded: s.excluded, forReview: s.leftForReview, errors: s.errors, stopped: s.stoppedReason ?? null }
  } catch {
    const why = (r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" ").slice(0, 300)
    console.log(`[classify] failed (exit ${r.status}): ${why}`)
    return { failed: why || `exit ${r.status}` }
  }
}

// Business emails from creators' own websites, for leads that have none (its own script, like classify).
type ContactsReport = { checked: number; found: number; business: number; units: number; pages: number; errors: number } | { failed: string } | null
function findContacts(): ContactsReport {
  if (values["no-contacts"]) return null
  const r = spawnSync(process.execPath, [...process.execArgv, "scripts/find-contacts.ts", "--in", values.input!, "--limit", values["contacts-limit"]!], { encoding: "utf8", timeout: 12 * 60_000 })
  const summary = /^\{\r?\n[\s\S]*^\}\s*$/m.exec(r.stdout ?? "")?.[0]
  try {
    const s = JSON.parse(summary ?? "")
    console.log(`[contacts] checked ${s.checked} of ${s.eligible}: ${s.found} emails found (${s.business} business), ${s.pages} pages, ${s.units} units, ${s.errors} errors`)
    return { checked: s.checked, found: s.found, business: s.business, units: s.units, pages: s.pages, errors: s.errors }
  } catch {
    const why = (r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" ").slice(0, 300)
    console.log(`[contacts] failed (exit ${r.status}): ${why}`)
    return { failed: why || `exit ${r.status}` }
  }
}

// Auto-discovery from Instagram, Spotify, and LinkedIn APIs.
async function discoverMultiplatform(): Promise<number> {
  if (values["no-multiplatform"] || !values.multiplatform) return 0
  try {
    const existing = parse(fs.readFileSync(values.input!, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[]
    const existingIds = new Set(existing.map((x) => x.stable_creator_id))
    const qLines = fs.existsSync(values.queries!)
      ? fs.readFileSync(values.queries!, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
      : ["business coach"]
    const q = qLines[Math.floor(Math.random() * qLines.length)] || "business coach"

    const res = await fetchAndQualifyCreators({
      platforms: ["instagram", "spotify", "linkedin"],
      query: q,
      limit: Number(values["multiplatform-limit"] ?? 5),
      allowSampleDataOnAuthError: false,
    })

    const newRows = res.rawRows.filter((r) => !existingIds.has(String(r.stable_creator_id)))
    if (newRows.length > 0) {
      appendRows(values.input!, values.ids!, newRows)
      console.log(`[multiplatform] added ${newRows.length} new creators from Instagram/Spotify/LinkedIn (query: "${q}")`)
      return newRows.length
    }
  } catch (e: any) {
    console.log(`[multiplatform] skipped or failed: ${e.message}`)
  }
  return 0
}

async function main() {
  if (!acquireLock()) {
    console.log("[cycle] previous run still going, skipping")
    return
  }
  try {
    let discovery: DiscoveryReport
    try {
      discovery = await discover()
    } catch (e) {
      console.log(`[discover] failed: ${(e as Error).message}`)
      discovery = { status: "failed", added: 0, units: 0, sources: [], reason: (e as Error).message.slice(0, 300) }
    }
    const entityCheck = classify()
    const contacts = findContacts()
    await discoverMultiplatform()

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
      extraMetrics: { cycle: { discovery, entityCheck, contacts } },
      extraApiUnits: discovery.units + (contacts && "units" in contacts ? contacts.units : 0),
    })
    // Advance only after a successful run, so a failed slice is retried next time.
    if (s.status === "succeeded") writeState({ cursor: cursor + slice.length, lastRun: s.runId })
    // The key's daily quota is shared: count the refresh and contact units too (discovery already
    // counted its own), so discovery stops before the key runs out instead of at a guessed cap.
    const st = readState()
    if (st.discovery && st.discovery.day === pacificDay(new Date())) {
      writeState({ discovery: { ...st.discovery, unitsToday: st.discovery.unitsToday + Math.max(0, s.apiUnits - discovery.units) } })
    }
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
