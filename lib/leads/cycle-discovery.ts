// New-channel discovery for the scheduled engine cycle (scripts/engine-cycle.ts).
// Each step tries to add channels that aren't in the input file yet, in this order:
//   1. Channels carried over from the last step (found beyond the per-step cap).
//   2. Featured channels: the channels a confirmed individual creator features on their own page
//      (1 unit per creator instead of 100 per search; similar creators tend to feature each other).
//   3. Searches, alternating between two kinds when mode is "both":
//      - video: the newest videos for a query × region published since that pair was last searched
//        (order=date, publishedAfter). A new time window each time, so results are mostly channels
//        not seen before, and every one has just posted.
//      - channel: channel search by relevance, depth first: one page deeper each time on the same
//        pair. A page that brings fewer than `minNew` new channels marks the pair worn out, so
//        quota isn't spent on pages of channels already in the file.
// Only new channels are fetched, through the official API. A step runs at most every `everyMin`
// minutes and stops for the day at `dailyUnits` YouTube quota units, which resets at midnight
// US Pacific like the YouTube quota itself.
import { fetchChannelsViaApi, fetchFeaturedChannels, searchChannelPage, searchRecentVideoChannels, toResearchRow } from "./discovery"

export type DiscoveryState = {
  pos: number // channel search: position in the query × region rotation
  pages: Record<string, string> // channel search: "query|region" → next page token, or "done"
  depth?: Record<string, number> // channel search: "query|region" → pages searched so far
  pending?: string[] // new channels found beyond the per-step cap, fetched first next time
  turn?: number // which search kind is next when mode is "both"
  vpos?: number // video search: position in the query × region rotation
  since?: Record<string, string> // video search: "query|region" → last searched at
  expanded?: string[] // creators whose featured channels have been looked up
  day: string // US Pacific date the unit count belongs to
  unitsToday: number
  lastAt: string | null
}
export const emptyDiscoveryState = (): DiscoveryState => ({ pos: 0, pages: {}, day: "", unitsToday: 0, lastAt: null })
export type SearchMode = "both" | "video" | "channel"

export const pacificDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })

const pairs = (queries: string[], regions: string[]) =>
  queries.flatMap((query) => regions.map((region) => ({ key: `${query}|${region}`, query, region })))

/** Channel search: the pair to search next (from `pos`, skipping worn-out pairs), or null when all are done. */
export function nextSearch(queries: string[], regions: string[], state: DiscoveryState) {
  const all = pairs(queries, regions)
  for (let i = 0; i < all.length; i++) {
    const pos = (state.pos + i) % all.length
    const page = state.pages[all[pos].key]
    if (page !== "done") return { ...all[pos], pageToken: page ?? null, pos }
  }
  return null
}

/** Video search: the next pair in the rotation and the start of its time window. */
export function nextVideoSearch(queries: string[], regions: string[], state: DiscoveryState, now: Date, firstWindowDays: number) {
  const all = pairs(queries, regions)
  if (!all.length) return null
  const pos = (state.vpos ?? 0) % all.length
  const since = state.since?.[all[pos].key] ?? new Date(now.getTime() - firstWindowDays * 86_400_000).toISOString()
  return { ...all[pos], since, pos }
}

export async function discoverStep(opts: {
  queries: string[]; regions: string[]; existingIds: Set<string>; state: DiscoveryState; now: Date
  apiKey: string | undefined; searches: number; dailyUnits: number; everyMin: number; maxNew?: number
  mode?: SearchMode; minNew?: number; firstWindowDays?: number
  featuredFrom?: string[]; featuredPerStep?: number
  fetcher?: Parameters<typeof searchChannelPage>[2]["fetcher"]
}): Promise<{ rows: Record<string, unknown>[]; units: number; searched: string[]; skipped: string | null; state: DiscoveryState }> {
  const state: DiscoveryState = {
    ...opts.state, pages: { ...opts.state.pages }, depth: { ...(opts.state.depth ?? {}) },
    since: { ...(opts.state.since ?? {}) }, expanded: [...(opts.state.expanded ?? [])],
  }
  const day = pacificDay(opts.now)
  if (state.day !== day) { state.day = day; state.unitsToday = 0 }
  const none = (skipped: string) => ({ rows: [], units: 0, searched: [], skipped, state })
  const mode = opts.mode ?? "both"
  const minNew = opts.minNew ?? 10
  const maxNew = opts.maxNew ?? 50
  const featuredPerStep = opts.featuredPerStep ?? 10
  const expanded = new Set(state.expanded)
  const toExpand = (opts.featuredFrom ?? []).filter((id) => !expanded.has(id)).slice(0, featuredPerStep)

  if (!opts.queries.length && !toExpand.length) return none("no discovery queries configured")
  // 2 minutes of slack: the scheduler starts cycles a few seconds early or late, and a strict
  // 40-minute check would then skip a cycle that starts 39:58 after the last search.
  if (state.lastAt && opts.now.getTime() - Date.parse(state.lastAt) < opts.everyMin * 60_000 - 2 * 60_000) {
    return none(`last discovery ${Math.round((opts.now.getTime() - Date.parse(state.lastAt)) / 60_000)} min ago (runs every ${opts.everyMin} min)`)
  }
  // 100 per search, 1 per featured lookup, then about 2 per new channel (uploads + video details)
  // plus 1 per 50 channels.
  const estimate = opts.searches * 100 + toExpand.length + 2 * maxNew + Math.ceil(maxNew / 50)
  if (state.unitsToday + estimate > opts.dailyUnits) {
    return none(`daily discovery budget reached (${state.unitsToday}/${opts.dailyUnits} units); resumes after midnight US Pacific`)
  }

  let units = 0
  const carried = (state.pending ?? []).filter((id) => !opts.existingIds.has(id))
  const found = new Set<string>(carried)
  const searched: string[] = carried.length ? [`${carried.length} carried over`] : []
  const addFresh = (ids: string[]) => {
    const fresh = ids.filter((id) => !opts.existingIds.has(id) && !found.has(id))
    fresh.forEach((id) => found.add(id))
    return fresh.length
  }

  // Featured channels of confirmed creators: cheap, so done before any search.
  if (toExpand.length) {
    let listed = 0
    let fresh = 0
    for (const id of toExpand) {
      const r = await fetchFeaturedChannels(id, { apiKey: opts.apiKey, fetcher: opts.fetcher })
      units += r.apiUnits
      listed += r.channelIds.length
      fresh += addFresh(r.channelIds)
      expanded.add(id)
    }
    searched.push(`featured channels of ${toExpand.length} confirmed creators: ${listed} listed, ${fresh} new`)
  }

  // Searches, only while there's room under the cap.
  for (let i = 0; i < opts.searches && found.size < maxNew; i++) {
    const kind = mode === "both" ? ((state.turn ?? 0) % 2 === 0 ? "video" : "channel") : mode
    state.turn = (state.turn ?? 0) + 1
    if (kind === "video") {
      const s = nextVideoSearch(opts.queries, opts.regions, state, opts.now, opts.firstWindowDays ?? 7)
      if (!s) continue
      const r = await searchRecentVideoChannels(s.query, s.region, { apiKey: opts.apiKey, publishedAfter: s.since, fetcher: opts.fetcher })
      units += r.apiUnits
      state.since![s.key] = opts.now.toISOString()
      state.vpos = s.pos + 1
      searched.push(`videos "${s.query}" ${s.region} since ${s.since.slice(0, 16)}Z: ${r.channelIds.length} channels, ${addFresh(r.channelIds)} new`)
    } else {
      const s = nextSearch(opts.queries, opts.regions, state)
      if (!s) continue
      const r = await searchChannelPage(s.query, s.region, { apiKey: opts.apiKey, pageToken: s.pageToken, fetcher: opts.fetcher })
      units += r.apiUnits
      const page = (state.depth![s.key] ?? 0) + 1
      state.depth![s.key] = page
      const fresh = addFresh(r.channelIds)
      // Worn out: no more pages, or a later page that is mostly channels already in the file.
      const wornOut = !r.nextPageToken || (page > 1 && fresh < minNew)
      state.pages[s.key] = wornOut ? "done" : r.nextPageToken!
      state.pos = wornOut ? s.pos + 1 : s.pos // stay on this pair until it runs out
      searched.push(`channels "${s.query}" ${s.region} page ${page}: ${r.channelIds.length} channels, ${fresh} new${wornOut && r.nextPageToken ? " (worn out, moving on)" : ""}`)
    }
  }
  state.expanded = [...expanded]

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
