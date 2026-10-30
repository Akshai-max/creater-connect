// Entity check: fills entity_type in a discovered CSV from an exact quote in the
// creator's own text (lib/leads/entity.ts). The model comes from the LLM router
// (lib/llm/router.ts): Groq, then Gemini, then local Ollama, switching automatically
// when a free quota runs out. Every call is audited in llm_calls (the AI usage page).
//   npm run classify-entities -- --in data/discovered.csv  (writes back to the same file)
//   npm run engine -- --input data/discovered.csv
// Options:
//   --out <file>      write elsewhere instead of in place
//   --limit <n>       at most n model calls this run (cached answers don't count; resume later)
//   --all             also classify rows that fail other checks (default: only rows
//                     where the entity type is what decides the outcome)
// Rows a person already set (entity_type other than needs_review) are never changed.
// Cache: data/entity-cache.json holds each raw answer and the model that gave it (by
// channel id + text), so rule changes apply on the next run without asking again.
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import { parse } from "csv-parse/sync"
import { classifyEntity, verdictFrom, type EntitySource } from "../lib/leads/entity"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { senderFromEnv } from "../lib/leads/config"
import { AllProvidersUnavailable, defaultRouter } from "../lib/llm/router"
import { csvEscape } from "../lib/leads/export"
import { fetchChannelsViaApi } from "../lib/leads/discovery"

const { values } = parseArgs({
  options: {
    in: { type: "string" },
    out: { type: "string" },
    limit: { type: "string" },
    all: { type: "boolean", default: false },
    cache: { type: "string", default: "data/entity-cache.json" },
    // For leads that would qualify if confirmed as individuals but whose titles didn't say who runs
    // the channel: fetch their recent video descriptions (~2 YouTube units each) and ask again.
    "with-descriptions": { type: "boolean", default: false },
  },
})

type Row = Record<string, string>

function sourceOf(row: Row): EntitySource {
  let items: { url?: string; title?: string }[] = []
  try { items = JSON.parse(row.content_items || "[]") } catch { /* keep empty */ }
  return {
    channelUrl: row.profile_url,
    title: row.creator_name,
    description: row.channel_description ?? "",
    videos: items.filter((i) => i.url && i.title).map((i) => ({ url: i.url!, title: i.title! })),
  }
}

// Would this row's outcome depend on the entity type? (Run the engine's own rules with
// entity_type=individual: if it's still rejected for something else, skip the model call.)
function probeStatus(row: Row, now: Date) {
  const r = processBatch([{ row: { ...row, entity_type: "individual" }, ref: "probe" }], emptyIndex(), { now, source: "probe", sender: senderFromEnv() })
  return r.processed[0]?.qualification.status ?? null
}
function entityDecides(row: Row, now: Date): boolean {
  const r = processBatch([{ row: { ...row, entity_type: "individual" }, ref: "probe" }], emptyIndex(), { now, source: "probe", sender: senderFromEnv() })
  const p = r.processed[0]
  return !!p && p.qualification.status !== "rejected"
}

async function main() {
  if (!values.in) throw new Error("pass --in <discovered.csv>")
  const out = values.out ?? values.in
  const text = fs.readFileSync(values.in, "utf8")
  const rows = parse(text, { columns: true, skip_empty_lines: true }) as Row[]
  if (!rows.length) throw new Error(`no rows in ${values.in}`)
  const cols = Object.keys(rows[0])
  for (const c of ["entity_evidence_url", "entity_quote", "entity_source", "entity_note"]) if (!cols.includes(c)) cols.push(c)
  const now = new Date()
  const router = defaultRouter()
  const providers = router.configured.join(" → ") || "none configured"
  if (!rows.some((r) => r.channel_description)) {
    console.warn("[classify] no channel_description column: re-run discovery (it now keeps it) for better results. Using names and video titles only.")
  }

  type Answer = { entity?: string; quote?: string; model?: string }
  let cache: Record<string, Answer> = {}
  try { cache = JSON.parse(fs.readFileSync(values.cache!, "utf8")) } catch { /* first run */ }
  const saveCache = () => {
    fs.mkdirSync(path.dirname(values.cache!), { recursive: true })
    fs.writeFileSync(values.cache!, JSON.stringify(cache, null, 1))
  }
  const saveCsv = () => fs.writeFileSync(out, [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c] ?? "")).join(","))].join("\n") + "\n")

  const todo = rows.filter((r) => (r.entity_type || "needs_review") === "needs_review" && (values.all || entityDecides(r, now)))
  const limit = values.limit ? Number(values.limit) : todo.length
  const stats = {
    rows: rows.length, needsReview: rows.filter((r) => (r.entity_type || "needs_review") === "needs_review").length, toClassify: Math.min(limit, todo.length),
    skippedOtherwiseRejected: 0, classified: 0, fromCache: 0, individual: 0, excluded: 0, leftForReview: 0, errors: 0, avgSeconds: 0,
    byProvider: {} as Record<string, number>, stoppedReason: null as string | null,
  }
  stats.skippedOtherwiseRejected = stats.needsReview - todo.length
  console.log(`[classify] ${rows.length} rows, ${todo.length} need the entity check (${stats.skippedOtherwiseRejected} skipped: rejected for other reasons). Providers: ${providers}.`)

  // Free tiers have per-minute limits (Gemini's free flash model allows a handful of calls a
  // minute). When every provider is resting only briefly, wait it out instead of stopping; a
  // long rest (a daily quota) still stops the run. Capped so an unreachable provider's short
  // rest can't keep it waiting forever.
  const classifyWithWait = async (src: ReturnType<typeof sourceOf>, subjectRef: string) => {
    for (let waits = 0; ; waits++) {
      try {
        return await classifyEntity(src, { router, subjectRef })
      } catch (e) {
        const wait = e instanceof AllProvidersUnavailable && e.nextAvailableAt ? Date.parse(e.nextAvailableAt) - Date.now() : NaN
        if (!(wait <= 10 * 60_000) || waits >= 6) throw e
        const ms = Math.max(wait, 0) + 1000
        console.log(`  waiting ${Math.round(ms / 1000)}s for a provider to come back (${(e as Error).message.slice(0, 120)})`)
        await new Promise((r) => setTimeout(r, ms))
      }
    }
  }

  const keyOf = (row: Row, src: EntitySource) => createHash("sha1").update([row.stable_creator_id, src.title, src.description, src.videos.map((v) => v.title).join("|"),
    // Descriptions only when present, so title-only answers keep their cache keys.
    ...(src.videos.some((v) => v.description) ? [src.videos.map((v) => v.description ?? "").join("|")] : [])].join("\n")).digest("hex")

  // Video descriptions for leads only the entity check stands between and the title-only check left
  // for review. Same rules: the quote must appear word for word, now in a title or a description.
  const descriptions = new Map<string, Map<string, string>>()
  if (values["with-descriptions"]) {
    const want = todo.filter((row) => {
      const c = cache[keyOf(row, sourceOf(row))]
      return c?.model && verdictFrom(sourceOf(row), c, c.model).entityType === "needs_review" && probeStatus(row, now) === "qualified"
    })
    if (want.length) {
      const r = await fetchChannelsViaApi(want.map((x) => x.stable_creator_id), { apiKey: process.env.YOUTUBE_API_KEY })
      for (const ch of r.channels) descriptions.set(ch.channelId, new Map(ch.videos.map((v) => [v.url, v.description ?? ""])))
      console.log(`[classify] video descriptions for ${r.channels.length} leads that only need the entity check (${r.apiUnits} YouTube units)`)
    }
  }

  let totalMs = 0
  let consecutiveErrors = 0
  for (const row of todo) {
    const base = sourceOf(row)
    const d = descriptions.get(row.stable_creator_id)
    // Fetched descriptions cover the newest uploads; titles stay as stored, and a fetched video not
    // in the stored list is added so its description can be quoted with its own URL.
    const src: EntitySource = d ? { ...base, videos: [
      ...base.videos.map((v) => ({ ...v, description: d.get(v.url) })),
      ...[...d.entries()].filter(([u]) => !base.videos.some((v) => v.url === u)).map(([url, description]) => ({ url, title: "", description })),
    ] } : base
    const key = keyOf(row, src)
    const cached = cache[key]
    // The limit counts model calls: rows still left for review come back from the cache every run
    // and sit before newly added rows, so a row limit would mostly re-read the cache.
    if (!cached?.model && stats.classified + stats.errors >= limit) continue
    let v = cached?.model ? verdictFrom(src, cached, cached.model) : null
    if (v) stats.fromCache++
    else {
      try {
        const r = await classifyWithWait(src, row.stable_creator_id)
        v = r.verdict
        cache[key] = { ...r.answer, model: v.model }
        totalMs += r.ms
        stats.classified++
        stats.byProvider[v.model] = (stats.byProvider[v.model] ?? 0) + 1
        consecutiveErrors = 0
        saveCache() // so an interrupted run resumes where it stopped
        console.log(`  ${(r.ms / 1000).toFixed(1)}s  ${v.model.padEnd(32)} ${v.entityType.padEnd(12)} ${row.creator_name.slice(0, 36)}${v.quote ? `  "${v.quote.slice(0, 50)}"` : `  (${v.reason})`}`)
      } catch (e) {
        if (e instanceof AllProvidersUnavailable) {
          stats.stoppedReason = `${e.message}. Next provider free at ${e.nextAvailableAt ?? "unknown"}; rerun then (answers so far are kept).`
          console.error(`[classify] ${stats.stoppedReason}`)
          break
        }
        stats.errors++
        consecutiveErrors++
        console.error(`  error  ${row.creator_name.slice(0, 40)}: ${(e as Error).message.slice(0, 160)}`)
        if (consecutiveErrors >= 3) {
          stats.stoppedReason = "3 errors in a row - see the AI usage page for each provider's last error"
          console.error(`[classify] ${stats.stoppedReason}`)
          break
        }
        continue
      }
    }
    if (v.entityType === "needs_review") {
      stats.leftForReview++
      row.entity_note = `AI could not confirm: ${v.reason}`
      continue
    }
    row.entity_type = v.entityType
    row.entity_evidence_url = v.evidenceUrl ?? ""
    row.entity_quote = v.quote ?? ""
    row.entity_source = `ai:${v.model}`
    row.entity_note = ""
    row.review_notes = (row.review_notes ?? "").replace("CONFIRM: individual creator (not company/network)", `CHECK: entity "${v.entityType}" read by ${v.model} from "${(v.quote ?? "").slice(0, 60)}"`)
    if (v.entityType === "individual") stats.individual++
    else stats.excluded++
  }
  stats.avgSeconds = stats.classified ? +(totalMs / stats.classified / 1000).toFixed(1) : 0

  saveCsv() // also written when the run stops early, so finished rows aren't lost
  console.log(JSON.stringify({ out, ...stats, next: `npm run engine -- --input ${out}` }, null, 2))
}

main().catch((e) => {
  console.error(`[classify] ${(e as Error).message}`)
  process.exitCode = 1
})
