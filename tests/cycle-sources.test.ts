import { test } from "node:test"
import assert from "node:assert/strict"
import { applyFeedEmail, discoverStep, emptyDiscoveryState } from "../lib/leads/cycle-discovery"
import { extractYouTubeRefs } from "../lib/leads/discovery"
import { parseFeed } from "../lib/leads/podcasts"

const NOW = new Date("2026-10-29T12:00:00Z")
const base = { queries: ["business podcast"], regions: ["US"], apiKey: "TEST_YT_KEY", searches: 0, dailyUnits: 4000, everyMin: 40 }
const ok = (j: unknown) => ({ ok: true, status: 200, text: async () => (typeof j === "string" ? j : JSON.stringify(j)), json: async () => j })

// A fake YouTube API: channels with an uploads playlist whose videos have the given descriptions,
// and handle lookups.
function fakeYouTube(opts: { descriptions?: Record<string, string[]>; handles?: Record<string, string> }, urls: string[] = []) {
  return async (u: string) => {
    urls.push(u)
    const url = new URL(u)
    const p = url.pathname
    if (p.endsWith("/channels") && url.searchParams.get("forHandle")) {
      const id = opts.handles?.[url.searchParams.get("forHandle")!.slice(1).toLowerCase()]
      return ok({ items: id ? [{ id }] : [] })
    }
    if (p.endsWith("/channels")) {
      const ids = url.searchParams.get("id")!.split(",")
      return ok({ items: ids.map((id) => ({ id, snippet: { title: `Channel ${id}`, description: "" }, statistics: { subscriberCount: "5000" }, contentDetails: { relatedPlaylists: opts.descriptions?.[id] ? { uploads: `UU_${id}` } : {} } })) })
    }
    if (p.endsWith("/playlistItems")) {
      const id = url.searchParams.get("playlistId")!.slice(3)
      return ok({ items: (opts.descriptions?.[id] ?? []).map((_, i) => ({ contentDetails: { videoId: `${id}_v${i}` } })) })
    }
    if (p.endsWith("/videos")) {
      const vids = url.searchParams.get("id")!.split(",")
      return ok({ items: vids.map((v) => { const [ch, n] = v.split("_v"); return { id: v, snippet: { title: `Episode ${n}`, publishedAt: "2026-10-20T00:00:00Z", description: opts.descriptions?.[ch]?.[Number(n)] ?? "" }, contentDetails: { duration: "PT45M" } } }) })
    }
    return ok({ items: [] })
  }
}

test("YouTube channel links are read from text; bare @mentions are not", () => {
  const refs = extractYouTubeRefs("Guest: https://www.youtube.com/@JaneDoeCoach. Also youtube.com/channel/UCabcdefghijklmnopqrstuv and youtube.com/user/oldname. Follow @jane on Instagram")
  assert.deepEqual(refs, [
    { kind: "id", value: "UCabcdefghijklmnopqrstuv" },
    { kind: "handle", value: "JaneDoeCoach" },
    { kind: "user", value: "oldname" },
  ])
})

test("guest links: existing channels' video descriptions are scanned, handles resolved once, guests added", async () => {
  const urls: string[] = []
  const fetcher = fakeYouTube({
    descriptions: { UC_host: ["Today's guest: youtube.com/@guestone", "Subscribe: youtube.com/@thehost", "Again youtube.com/@guestone"] },
    handles: { guestone: "UC_guest1", thehost: "UC_host" },
  }, urls)
  const r = await discoverStep({ ...base, queries: [], guestScanPerStep: 5, existingIds: new Set(["UC_host"]), state: emptyDiscoveryState(), now: NOW, fetcher })
  assert.equal(r.skipped, null)
  assert.deepEqual(r.rows.map((x) => x.stable_creator_id), ["UC_guest1"]) // the host's link to itself is dropped
  assert.equal(urls.filter((u) => u.includes("forHandle")).length, 2) // @guestone once (deduped), @thehost once
  assert.deepEqual(r.state.guestScanned?.sort(), ["UC_guest1", "UC_host"]) // the new guest's own videos were read with its fetch
  assert.match(r.searched.join(" | "), /read 1 channels' video descriptions, 2 channel links found/)

  // Next step: nothing left to scan or resolve, and the cached handles cost nothing.
  const again = await discoverStep({ ...base, queries: [], guestScanPerStep: 5, existingIds: new Set(["UC_host", "UC_guest1"]), state: { ...r.state, lastAt: null }, now: NOW, fetcher })
  assert.equal(again.skipped, "no discovery queries configured")
})

const FEED = `<?xml version="1.0"?><rss><channel><title>Grow It</title>
<description><![CDATA[Weekly business talk. Watch on https://www.youtube.com/@growitshow]]></description>
<itunes:owner><itunes:name>Sam</itunes:name><itunes:email>sam@growit.example</itunes:email></itunes:owner>
<item><title>Ep 2</title><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Ep 1</title><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`

test("a podcast RSS feed gives its owner email, newest episode and YouTube link", () => {
  const f = parseFeed(FEED)
  assert.equal(f.ownerEmail, "sam@growit.example")
  assert.equal(f.latestEpisodeAt, "2026-10-27T10:00:00.000Z")
  assert.deepEqual(f.youtube, [{ kind: "handle", value: "growitshow" }])
  assert.equal(parseFeed("<rss><channel><itunes:owner><itunes:email>not an email</itunes:email></itunes:owner></channel></rss>").ownerEmail, null)
})

test("Apple Podcasts: podcasts that link a YouTube channel are added with the feed email; existing leads get it if they have none", async () => {
  const podcastUrls: string[] = []
  const podcastFetcher = async (u: string) => {
    podcastUrls.push(u)
    if (u.includes("itunes.apple.com")) return ok({ results: [
      { collectionId: 1, collectionName: "Grow It", artistName: "Sam", feedUrl: "https://feeds.example/growit", collectionViewUrl: "https://podcasts.apple.com/1" },
      { collectionId: 2, collectionName: "No YouTube", artistName: "Ann", feedUrl: "https://feeds.example/noyt" },
      { collectionId: 3, collectionName: "Old Friend", artistName: "Bo", feedUrl: "https://feeds.example/old" },
    ] })
    if (u.endsWith("/growit")) return ok(FEED)
    if (u.endsWith("/old")) return ok(FEED.replace("@growitshow", "@oldfriend").replace("sam@growit.example", "bo@old.example"))
    return ok("<rss><channel><title>x</title></channel></rss>")
  }
  const fetcher = fakeYouTube({ handles: { growitshow: "UC_grow", oldfriend: "UC_old" } })
  const r = await discoverStep({ ...base, apple: true, existingIds: new Set(["UC_old"]), state: emptyDiscoveryState(), now: NOW, fetcher, podcastFetcher })
  assert.ok(podcastUrls[0].includes("media=podcast") && podcastUrls[0].includes("country=us"))
  assert.deepEqual(r.rows.map((x) => x.stable_creator_id), ["UC_grow"])
  const row = r.rows[0]
  assert.equal(row.email, "sam@growit.example")
  assert.equal(row.email_evidence_url, "https://feeds.example/growit")
  assert.equal(row.email_source, "published")
  assert.equal(row.email_business_use, "") // the feed doesn't say it's for business enquiries
  assert.equal(row.email_last_active, "2026-10-27")
  assert.match(String(row.review_notes), /CHECK: email sam@growit\.example is from the podcast RSS feed/)
  assert.equal(r.emailUpdates.UC_old?.email, "bo@old.example")
  assert.deepEqual(r.state.appleSeen, [1, 2, 3])
  assert.match(r.searched.join(" | "), /3 podcasts, 2 link a YouTube channel, 1 new, 2 feed emails/)
})

test("a feed email never replaces an email the lead already has", () => {
  const row: Record<string, unknown> = { email: "own@creator.example", review_notes: "" }
  assert.equal(applyFeedEmail(row, { email: "feed@x.example", feedUrl: "https://f", lastActive: null, podcast: "P" }), false)
  assert.equal(row.email, "own@creator.example")
})
