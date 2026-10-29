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
//   Also, before the searches (cheap, so they go first):
//   - guest links: YouTube channel links in video descriptions (podcast guests, collaborators).
//     New channels' descriptions come free with their fetch; existing channels are scanned a few
//     per step (2 units each). A handle costs 1 unit to resolve, and resolved handles are cached.
//   - Apple Podcasts (lib/leads/podcasts.ts, no YouTube units): one directory search per step;
//     podcasts whose RSS feed links a YouTube channel are added, with the feed's owner email as a
//     contact route to review. A matching lead already in the file without an email gets it too.
import { fetchChannelsViaApi, fetchFeaturedChannels, extractYouTubeRefs, resolveYouTubeRefs, searchChannelPage, searchRecentVideoChannels, toResearchRow, type DiscoveredChannel, type YouTubeRef } from "./discovery"
import { fetchFeed, searchApplePodcasts, type PodcastFetcher } from "./podcasts"

/** An email from a podcast's RSS feed (<itunes:owner>), to attach to the matching YouTube lead. */
export type FeedEmail = { email: string; feedUrl: string; lastActive: string | null; podcast: string }

/** Fills a research row's email from a feed, only if the row has none. The podcaster published it
 *  in their own feed (so "published"), but nothing in the feed says it's for business enquiries,
 *  so business use stays unset, and the review note asks a person to confirm it reaches the creator. */
export function applyFeedEmail(row: Record<string, unknown>, f: FeedEmail): boolean {
  if (String(row.email ?? "").trim()) return false
  row.email = f.email
  row.email_evidence_url = f.feedUrl
  row.email_last_active = f.lastActive?.slice(0, 10) ?? ""
  row.email_source = "published"
  row.email_business_use = ""
  row.email_quote = `itunes:owner email in the RSS feed of "${f.podcast}"`
  const notes = String(row.review_notes ?? "").replace("FIND: published business contact", "").replace(/^;\s*|;\s*;/g, "").trim()
  row.review_notes = [notes, `CHECK: email ${f.email} is from the podcast RSS feed (itunes:owner); confirm it reaches the creator`].filter(Boolean).join("; ")
  return true
}

export type DiscoveryState = {
  pos: number // channel search: position in the query × region rotation
  pages: Record<string, string> // channel search: "query|region" → next page token, or "done"
  depth?: Record<string, number> // channel search: "query|region" → pages searched so far
  pending?: string[] // new channels found beyond the per-step cap, fetched first next time
  turn?: number // which search kind is next when mode is "both"
  vpos?: number // video search: position in the query × region rotation
  since?: Record<string, string> // video search: "query|region" → last searched at
  expanded?: string[] // creators whose featured channels have been looked up
  guestScanned?: string[] // existing channels whose video descriptions have been read
  guestQueue?: YouTubeRef[] // channel links found in descriptions, not resolved yet
  refsSeen?: string[] // "kind:value" of every link ever queued, so none is queued twice
  handles?: Record<string, string | null> // resolved handle/user → channel id (null: not found)
  apos?: number // Apple Podcasts: position in the query × region rotation
  appleSeen?: number[] // podcasts (iTunes collection ids) already read
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
  guestScanPerStep?: number; guestResolvePerStep?: number
  apple?: boolean; appleFeedsPerStep?: number
  fetcher?: Parameters<typeof searchChannelPage>[2]["fetcher"]
  podcastFetcher?: PodcastFetcher
}): Promise<{ rows: Record<string, unknown>[]; units: number; searched: string[]; skipped: string | null; state: DiscoveryState; emailUpdates: Record<string, FeedEmail> }> {
  const state: DiscoveryState = {
    ...opts.state, pages: { ...opts.state.pages }, depth: { ...(opts.state.depth ?? {}) },
    since: { ...(opts.state.since ?? {}) }, expanded: [...(opts.state.expanded ?? [])],
    guestQueue: [...(opts.state.guestQueue ?? [])], handles: { ...(opts.state.handles ?? {}) },
  }
  const emailUpdates: Record<string, FeedEmail> = {}
  const day = pacificDay(opts.now)
  if (state.day !== day) { state.day = day; state.unitsToday = 0 }
  const none = (skipped: string) => ({ rows: [], units: 0, searched: [], skipped, state, emailUpdates })
  const mode = opts.mode ?? "both"
  const minNew = opts.minNew ?? 10
  const maxNew = opts.maxNew ?? 50
  const featuredPerStep = opts.featuredPerStep ?? 10
  const expanded = new Set(state.expanded)
  const toExpand = (opts.featuredFrom ?? []).filter((id) => !expanded.has(id)).slice(0, featuredPerStep)
  const guestScanPerStep = opts.guestScanPerStep ?? 0
  const guestResolvePerStep = opts.guestResolvePerStep ?? 20
  const scanned = new Set(state.guestScanned ?? [])
  const toScan = guestScanPerStep ? [...opts.existingIds].filter((id) => !scanned.has(id)).slice(0, guestScanPerStep) : []

  if (!opts.queries.length && !toExpand.length && !toScan.length && !state.guestQueue!.length) return none("no discovery queries configured")
  // 2 minutes of slack: the scheduler starts cycles a few seconds early or late, and a strict
  // 40-minute check would then skip a cycle that starts 39:58 after the last search.
  if (state.lastAt && opts.now.getTime() - Date.parse(state.lastAt) < opts.everyMin * 60_000 - 2 * 60_000) {
    return none(`last discovery ${Math.round((opts.now.getTime() - Date.parse(state.lastAt)) / 60_000)} min ago (runs every ${opts.everyMin} min)`)
  }
  // 100 per search, 1 per featured lookup, then about 2 per new channel (uploads + video details)
  // plus 1 per 50 channels.
  // Guest links: 2 per channel scanned, 1 per link resolved. Apple Podcasts: up to 1 per feed's link.
  const estimate = opts.searches * 100 + toExpand.length + 2 * maxNew + Math.ceil(maxNew / 50)
    + 2 * toScan.length + guestResolvePerStep + (opts.apple ? opts.appleFeedsPerStep ?? 15 : 0)
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

  // Links → channel ids, using and filling the cache so a handle is only paid for once.
  const resolve = async (refs: YouTubeRef[]) => {
    const out: string[] = []
    const unknown = refs.filter((r) => r.kind !== "id" && !(`${r.kind}:${r.value.toLowerCase()}` in state.handles!))
    if (unknown.length) {
      const r = await resolveYouTubeRefs(unknown, { apiKey: opts.apiKey, fetcher: opts.fetcher })
      units += r.apiUnits
      for (const u of unknown) { const k = `${u.kind}:${u.value.toLowerCase()}`; state.handles![k] = r.ids.get(k) ?? null }
    }
    for (const r of refs) {
      const id = r.kind === "id" ? r.value : state.handles![`${r.kind}:${r.value.toLowerCase()}`]
      if (id) out.push(id)
    }
    return out
  }

  // Guest links. A channel's links to itself resolve to an id already in the file and are dropped.
  const refsSeen = new Set(state.refsSeen ?? [])
  const queueRefs = (ch: DiscoveredChannel) => {
    let n = 0
    for (const v of ch.videos) {
      for (const r of extractYouTubeRefs(v.description ?? "")) {
        const k = `${r.kind}:${r.value.toLowerCase()}`
        if ((r.kind === "id" && r.value === ch.channelId) || refsSeen.has(k)) continue
        refsSeen.add(k)
        state.guestQueue!.push(r)
        n++
      }
    }
    return n
  }
  if (toScan.length) {
    const r = await fetchChannelsViaApi(toScan, { apiKey: opts.apiKey, fetcher: opts.fetcher })
    units += r.apiUnits
    let queued = 0
    for (const ch of r.channels) queued += queueRefs(ch)
    toScan.forEach((id) => scanned.add(id))
    searched.push(`guest links: read ${toScan.length} channels' video descriptions, ${queued} channel links found`)
  }
  if (state.guestQueue!.length && found.size < maxNew) {
    const batch = state.guestQueue!.splice(0, guestResolvePerStep)
    const ids = await resolve(batch)
    searched.push(`guest links: ${batch.length} checked, ${addFresh(ids)} new${state.guestQueue!.length ? ` (${state.guestQueue!.length} waiting)` : ""}`)
  }

  // Apple Podcasts: one directory search, then each new podcast's RSS feed.
  const feedEmails: Record<string, FeedEmail> = {}
  if (opts.apple && opts.queries.length && found.size < maxNew) {
    const all = pairs(opts.queries, opts.regions)
    const s = all[(state.apos ?? 0) % all.length]
    state.apos = (state.apos ?? 0) + 1
    const seen = new Set(state.appleSeen ?? [])
    try {
      const pods = (await searchApplePodcasts(s.query, { country: s.region, fetcher: opts.podcastFetcher })).filter((p) => !seen.has(p.collectionId))
      let linked = 0, fresh = 0, emails = 0, failed = 0
      for (const p of pods.slice(0, opts.appleFeedsPerStep ?? 15)) {
        seen.add(p.collectionId)
        let feed
        try { feed = await fetchFeed(p.feedUrl, { fetcher: opts.podcastFetcher }) } catch { failed++; continue }
        const ids = feed.youtube.length ? await resolve(feed.youtube) : []
        if (!ids.length) continue
        linked++
        const id = ids[0]
        const hint = feed.ownerEmail ? { email: feed.ownerEmail, feedUrl: p.feedUrl, lastActive: feed.latestEpisodeAt, podcast: p.name } : null
        if (opts.existingIds.has(id)) {
          if (hint) { emailUpdates[id] = hint; emails++ }
        } else if (addFresh([id])) {
          fresh++
          if (hint) { feedEmails[id] = hint; emails++ }
        }
      }
      searched.push(`Apple Podcasts "${s.query}" ${s.region}: ${pods.length} podcasts, ${linked} link a YouTube channel, ${fresh} new, ${emails} feed emails${failed ? `, ${failed} feeds unreadable` : ""}`)
    } catch (e) {
      searched.push(`Apple Podcasts "${s.query}" ${s.region}: failed (${(e as Error).message.slice(0, 80)})`)
    }
    state.appleSeen = [...seen].slice(-5000)
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
    rows = r.channels.map((c) => {
      // New channels' own guest links come free with this fetch.
      queueRefs(c)
      scanned.add(c.channelId)
      const row = toResearchRow(c, { now: opts.now }) as Record<string, unknown>
      if (feedEmails[c.channelId]) applyFeedEmail(row, feedEmails[c.channelId])
      return row
    })
  }
  state.guestScanned = [...scanned]
  state.refsSeen = [...refsSeen]
  state.unitsToday += units
  state.lastAt = opts.now.toISOString()
  return { rows, units, searched, skipped: null, state, emailUpdates }
}
