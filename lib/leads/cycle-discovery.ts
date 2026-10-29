// New-channel discovery for the scheduled engine cycle (scripts/engine-cycle.ts).
// Each step runs the next few searches: it stays on one query × region pair and goes one
// results page deeper each time (YouTube's nextPageToken) until that pair has no more pages,
// then moves to the next pair. Depth first, because page 1 of every pair is usually what the
// first discovery run already collected. Only channels not already in the input file are
// fetched, through the official API. It runs at most every `everyMin`
// minutes and stops for the day at `dailyUnits` YouTube quota units, which resets at
// midnight US Pacific like the YouTube quota itself.
import { fetchChannelsViaApi, searchChannelPage, toResearchRow } from "./discovery"

export type DiscoveryState = {
  pos: number // next position in the query × region rotation
  pages: Record<string, string> // "query|region" → next page token, or "done"
  depth?: Record<string, number> // "query|region" → pages searched so far
  pending?: string[] // new channels found beyond the per-step cap, fetched first next time
  day: string // US Pacific date the unit count belongs to
  unitsToday: number
  lastAt: string | null
}
export const emptyDiscoveryState = (): DiscoveryState => ({ pos: 0, pages: {}, day: "", unitsToday: 0, lastAt: null })

export const pacificDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })

/** The pair to search next (from `pos`, skipping pairs with no more pages), or null when all are done. */
export function nextSearch(queries: string[], regions: string[], state: DiscoveryState) {
  const all = queries.flatMap((query) => regions.map((region) => ({ key: `${query}|${region}`, query, region })))
  for (let i = 0; i < all.length; i++) {
    const pos = (state.pos + i) % all.length
    const page = state.pages[all[pos].key]
    if (page !== "done") return { ...all[pos], pageToken: page ?? null, pos }
  }
  return null
}

export async function discoverStep(opts: {
  queries: string[]; regions: string[]; existingIds: Set<string>; state: DiscoveryState; now: Date
  apiKey: string | undefined; searches: number; dailyUnits: number; everyMin: number; maxNew?: number
  fetcher?: Parameters<typeof searchChannelPage>[2]["fetcher"]
}): Promise<{ rows: Record<string, unknown>[]; units: number; searched: string[]; skipped: string | null; state: DiscoveryState }> {
  const state: DiscoveryState = { ...opts.state, pages: { ...opts.state.pages } }
  const day = pacificDay(opts.now)
  if (state.day !== day) { state.day = day; state.unitsToday = 0 }
  const none = (skipped: string) => ({ rows: [], units: 0, searched: [], skipped, state })

  if (!opts.queries.length) return none("no discovery queries configured")
  if (state.lastAt && opts.now.getTime() - Date.parse(state.lastAt) < opts.everyMin * 60_000) {
    return none(`last discovery ${Math.round((opts.now.getTime() - Date.parse(state.lastAt)) / 60_000)} min ago (runs every ${opts.everyMin} min)`)
  }
  if (!state.pending?.length && !nextSearch(opts.queries, opts.regions, state)) return none("every query × region has been searched to its last page; add queries to find more")
  // 100 per search, then about 2 per new channel (uploads + video details) plus 1 per 50 channels.
  const maxNew = opts.maxNew ?? 50
  const estimate = opts.searches * 100 + 2 * maxNew + Math.ceil(maxNew / 50)
  if (state.unitsToday + estimate > opts.dailyUnits) {
    return none(`daily discovery budget reached (${state.unitsToday}/${opts.dailyUnits} units); resumes after midnight US Pacific`)
  }

  let units = 0
  const carried = (state.pending ?? []).filter((id) => !opts.existingIds.has(id))
  const found = new Set<string>(carried)
  const searched: string[] = carried.length ? [`${carried.length} channels carried over from the last step`] : []
  state.depth = { ...(state.depth ?? {}) }
  // Search only while there's room under the cap: carried-over channels come first.
  for (let i = 0; i < opts.searches && found.size < maxNew; i++) {
    const s = nextSearch(opts.queries, opts.regions, state)
    if (!s) break
    const r = await searchChannelPage(s.query, s.region, { apiKey: opts.apiKey, pageToken: s.pageToken, fetcher: opts.fetcher })
    units += r.apiUnits
    const page = (state.depth[s.key] ?? 0) + 1
    state.depth[s.key] = page
    state.pages[s.key] = r.nextPageToken ?? "done"
    state.pos = r.nextPageToken ? s.pos : s.pos + 1 // stay on this pair until it runs out of pages
    const fresh = r.channelIds.filter((id) => !opts.existingIds.has(id) && !found.has(id))
    fresh.forEach((id) => found.add(id))
    searched.push(`"${s.query}" ${s.region} page ${page}: ${r.channelIds.length} channels, ${fresh.length} new`)
  }

  const ids = [...found].slice(0, maxNew)
  state.pending = [...found].slice(maxNew)
  let rows: Record<string, unknown>[] = []
  if (ids.length) {
    const r = await fetchChannelsViaApi(ids, { apiKey: opts.apiKey, fetcher: opts.fetcher })
    units += r.apiUnits
    rows = r.channels.map((c) => toResearchRow(c, { now: opts.now }) as Record<string, unknown>)
  }
  state.unitsToday += units
  state.lastAt = opts.now.toISOString()
  return { rows, units, searched, skipped: null, state }
}
