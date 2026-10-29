import { test } from "node:test"
import assert from "node:assert/strict"
import { discoverStep, emptyDiscoveryState, nextSearch, pacificDay } from "../lib/leads/cycle-discovery"

const NOW = new Date("2026-10-29T12:00:00Z")
const base = { queries: ["video podcast", "business coach"], regions: ["US", "GB"], apiKey: "TEST_YT_KEY", searches: 2, dailyUnits: 4000, everyMin: 120 }

// A fake YouTube API: search pages by token, and channels/playlists/videos for any id.
function fakeYouTube(pages: Record<string, { ids: string[]; next?: string }>, urls: string[] = []) {
  const ok = (j: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(j), json: async () => j })
  return async (u: string) => {
    urls.push(u)
    const url = new URL(u)
    if (url.pathname.endsWith("/search")) {
      const key = `${url.searchParams.get("q")}|${url.searchParams.get("regionCode")}|${url.searchParams.get("pageToken") ?? ""}`
      const p = pages[key] ?? { ids: [] }
      return ok({ items: p.ids.map((channelId) => ({ id: { channelId } })), nextPageToken: p.next })
    }
    if (url.pathname.endsWith("/channels")) {
      const ids = url.searchParams.get("id")!.split(",")
      return ok({ items: ids.map((id) => ({ id, snippet: { title: `Channel ${id}`, description: "" }, statistics: { subscriberCount: "5000" }, contentDetails: { relatedPlaylists: {} } })) })
    }
    return ok({ items: [] })
  }
}

test("discovery picks the current query × region, wrapping and skipping pairs with no more pages", () => {
  const s = emptyDiscoveryState()
  assert.equal(nextSearch(base.queries, base.regions, s)?.key, "video podcast|US")
  const later = { ...s, pos: 3, pages: { "business coach|GB": "TOKEN2" } }
  assert.deepEqual([nextSearch(base.queries, base.regions, later)?.key, nextSearch(base.queries, base.regions, later)?.pageToken], ["business coach|GB", "TOKEN2"])
  const wrapped = { ...s, pos: 3, pages: { "business coach|GB": "done", "video podcast|US": "done" } }
  assert.equal(nextSearch(base.queries, base.regions, wrapped)?.key, "video podcast|GB")
  const all = { ...s, pages: Object.fromEntries(["video podcast|US", "video podcast|GB", "business coach|US", "business coach|GB"].map((k) => [k, "done"])) }
  assert.equal(nextSearch(base.queries, base.regions, all), null)
})

test("a discovery step keeps only channels not already in the file and remembers the next page", async () => {
  const urls: string[] = []
  const fetcher = fakeYouTube({
    "video podcast|US|": { ids: ["UC_old", "UC_new1"], next: "P2" },
    "video podcast|US|P2": { ids: ["UC_new1", "UC_new2"] }, // last page
  }, urls)
  const r = await discoverStep({ ...base, existingIds: new Set(["UC_old"]), state: emptyDiscoveryState(), now: NOW, fetcher })
  assert.equal(r.skipped, null)
  assert.deepEqual(r.rows.map((x) => x.stable_creator_id).sort(), ["UC_new1", "UC_new2"])
  // Depth first: page 1 then page 2 of the same pair; it had no page 3, so the next step moves on.
  assert.equal(r.state.pages["video podcast|US"], "done")
  assert.deepEqual(r.state.depth, { "video podcast|US": 2 })
  assert.equal(r.state.pos, 1)
  assert.match(r.searched[1], /page 2: 2 channels, 1 new/)
  assert.equal(r.units, 200 + 1) // 2 searches + one channels call (no uploads playlist in the fake)
  assert.equal(r.state.unitsToday, 201)
  assert.ok(!urls.some((u) => u.includes("UC_old") && u.includes("/channels")), "existing channels are not fetched again")

  // The next step, 30 minutes later, is skipped: discovery runs every 120 min.
  const again = await discoverStep({ ...base, existingIds: new Set(), state: r.state, now: new Date(NOW.getTime() + 30 * 60_000), fetcher })
  assert.match(again.skipped ?? "", /every 120 min/)
})

test("the daily YouTube budget stops discovery until midnight US Pacific", async () => {
  const state = { ...emptyDiscoveryState(), day: pacificDay(NOW), unitsToday: 3900 }
  const r = await discoverStep({ ...base, existingIds: new Set(), state, now: NOW, fetcher: fakeYouTube({}) })
  assert.match(r.skipped ?? "", /daily discovery budget reached \(3900\/4000/)
  const nextDay = await discoverStep({ ...base, existingIds: new Set(), state, now: new Date(NOW.getTime() + 24 * 3_600_000), fetcher: fakeYouTube({}) })
  assert.equal(nextDay.skipped, null)
  assert.equal(nextDay.state.unitsToday, 200)
})

test("channels found beyond the per-step cap are kept and fetched first next time", async () => {
  const fetcher = fakeYouTube({ "video podcast|US|": { ids: ["UC1", "UC2", "UC3"], next: "P2" } })
  const r = await discoverStep({ ...base, searches: 2, maxNew: 2, existingIds: new Set(), state: emptyDiscoveryState(), now: NOW, fetcher })
  assert.deepEqual(r.rows.map((x) => x.stable_creator_id), ["UC1", "UC2"])
  assert.deepEqual(r.state.pending, ["UC3"])
  assert.equal(r.searched.length, 1) // the cap was full after one search, so the second wasn't spent
  const next = await discoverStep({ ...base, searches: 2, maxNew: 2, existingIds: new Set(["UC1", "UC2"]), state: { ...r.state, lastAt: null }, now: NOW, fetcher: fakeYouTube({ "video podcast|US|P2": { ids: ["UC4"] } }) })
  assert.deepEqual(next.rows.map((x) => x.stable_creator_id), ["UC3", "UC4"])
  assert.deepEqual(next.state.pending, [])
})
