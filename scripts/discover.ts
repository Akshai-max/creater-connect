// Discovery → research CSV (README › Discovery). Output feeds `npm run engine -- --input`.
//   npm run discover-youtube -- --ids data/channel-ids.txt --out data/discovered.csv           (RSS, no key)
//   npm run discover-youtube -- --ids data/channel-ids.txt --api --out data/discovered.csv     (official API)
//   npm run discover-youtube -- --query "podcast;business coach" --regions US,GB,AU --out data/discovered.csv (API search)
// Channel id file: one channel per line, optionally "UC… <country> <segment>" when
// you've confirmed them by hand; "#" starts a comment.
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { fetchChannelsViaApi, fetchChannelsViaRss, searchChannels, toResearchRow, type DiscoveredChannel } from "../lib/leads/discovery"

const { values } = parseArgs({
  options: {
    ids: { type: "string" },
    query: { type: "string" },
    regions: { type: "string", default: "US,GB,CA,AU" },
    max: { type: "string", default: "25" },
    api: { type: "boolean", default: false },
    out: { type: "string", default: "data/discovered.csv" },
    now: { type: "string" },
  },
})

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const now = values.now ? new Date(values.now) : new Date()
  const key = process.env.YOUTUBE_API_KEY
  const hints = new Map<string, { country?: string; segment?: string }>()
  let ids: string[] = []
  let apiUnits = 0

  if (values.ids) {
    for (const line of fs.readFileSync(values.ids, "utf8").split(/\r?\n/)) {
      const [id, country, segment] = line.replace(/#.*/, "").trim().split(/\s+/)
      if (!id) continue
      ids.push(id)
      hints.set(id, { country, segment })
    }
  } else if (values.query) {
    const r = await searchChannels(values.query.split(";").map((q) => q.trim()).filter(Boolean), values.regions!.split(","), { apiKey: key, maxPerQuery: Number(values.max) })
    ids = r.channelIds
    apiUnits += r.apiUnits
  } else {
    throw new Error("pass --ids <file> or --query <q1;q2>")
  }

  let channels: DiscoveredChannel[]
  let errors: { ref: string; error: string }[]
  if (values.api || values.query) {
    const r = await fetchChannelsViaApi(ids, { apiKey: key })
    ;({ channels, errors } = r)
    apiUnits += r.apiUnits
  } else {
    ;({ channels, errors } = await fetchChannelsViaRss(ids, { delayMs: 300 }))
  }

  const rows = channels.map((c) => toResearchRow(c, { now, countryHint: hints.get(c.channelId)?.country, segmentHint: hints.get(c.channelId)?.segment }))
  if (!rows.length) throw new Error(`no channels fetched (${errors.length} errors: ${errors.slice(0, 3).map((e) => `${e.ref} ${e.error}`).join("; ")})`)
  const cols = Object.keys(rows[0])
  fs.mkdirSync(path.dirname(values.out!), { recursive: true })
  fs.writeFileSync(values.out!, [cols.join(","), ...rows.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c])).join(","))].join("\n") + "\n")
  const count = (k: string) => rows.filter((r) => (r as Record<string, unknown>)[k]).length
  console.log(JSON.stringify({
    out: values.out, channels: rows.length, errors, apiUnits,
    withMonetizationEvidence: count("monetization_signal"), withNeedEvidence: count("incubrix_need"), withBusinessEmail: count("email"),
    next: "Review the rows (review_notes column), confirm entity_type=individual and fill gaps with real evidence, then: npm run engine -- --input " + values.out,
  }, null, 2))
}

main().catch((e) => {
  console.error(`[discover] ${(e as Error).message}`)
  process.exitCode = 1
})
