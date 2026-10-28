import { test } from "node:test"
import assert from "node:assert/strict"
import { extractSignals, parseYouTubeRss, searchChannels, toResearchRow, fetchChannelsViaRss } from "../lib/leads/discovery"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { FIXTURE_NOW, FIXTURE_SENDER } from "./fixtures/rows"

// FICTIONAL feed in YouTube's RSS shape.
const ID = "UCFIXTURE000000000000077"
const entry = (n: number, day: string, desc: string) => `<entry><id>yt:video:v${n}</id><yt:videoId>fxv${n}</yt:videoId><title>Fixture Pod Episode ${n} &amp; friends</title><published>${day}T10:00:00+00:00</published><media:group><media:description>${desc}</media:description></media:group></entry>`
const XML = `<?xml version="1.0"?><feed><title>Fixture Pod</title>` +
  entry(3, "2026-10-25", "This episode is sponsored by FixtureCo. Business inquiries: hello@fixturepod.test") +
  entry(2, "2026-10-18", "We&#39;re hiring a video editor! Apply at fixturepod.test/jobs") +
  entry(1, "2026-10-11", "Support us on patreon.com/fixturepod") + `</feed>`

test("RSS feed parses titles, dates and descriptions", () => {
  const ch = parseYouTubeRss(XML, ID)
  assert.equal(ch.title, "Fixture Pod")
  assert.equal(ch.videos.length, 3)
  assert.equal(ch.videos[0].title, "Fixture Pod Episode 3 & friends")
  assert.equal(ch.videos[0].url, "https://www.youtube.com/watch?v=fxv3")
  assert.match(ch.videos[1].description, /We're hiring/)
})

test("signals come only from the creator's own text, each with its source URL", () => {
  const s = extractSignals(parseYouTubeRss(XML, ID))
  const spons = s.monetization.find((m) => m.value === "sponsorship")!
  assert.equal(spons.evidenceUrl, "https://www.youtube.com/watch?v=fxv3")
  assert.ok(s.monetization.some((m) => m.value === "membership"))
  assert.equal(s.need[0].value, "editing")
  assert.equal(s.need[0].evidenceUrl, "https://www.youtube.com/watch?v=fxv2")
  assert.equal(s.emails[0].value, "hello@fixturepod.test")
  assert.equal(s.emails[0].businessUse, true)
  const none = extractSignals({ ...parseYouTubeRss(XML, ID), videos: [] })
  assert.deepEqual([none.monetization.length, none.need.length, none.emails.length], [0, 0, 0])
})

test("discovered rows are never qualified until a person confirms them", () => {
  const row = toResearchRow(parseYouTubeRss(XML, ID), { now: FIXTURE_NOW, countryHint: "US" })
  assert.equal(row.entity_type, "needs_review")
  assert.equal(row.creator_segment, "video_podcaster")
  assert.match(row.review_notes, /CONFIRM: individual/)
  const r = processBatch([{ row, ref: "d1" }], emptyIndex(), { now: FIXTURE_NOW, source: "test", sender: FIXTURE_SENDER })
  assert.notEqual(r.processed[0].qualification.status, "qualified")
  assert.ok(r.processed[0].qualification.checks.some((c) => c.id === "entity" && !c.pass))
})

test("discovery fails loudly: no key for search, HTTP errors recorded per channel", async () => {
  await assert.rejects(searchChannels(["podcast"], ["US"], { apiKey: undefined }), /YOUTUBE_API_KEY/)
  const fetcher = async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) })
  const r = await fetchChannelsViaRss([ID], { fetcher })
  assert.equal(r.channels.length, 0)
  assert.match(r.errors[0].error, /HTTP 404/)
})

test("unknown video lengths make activity unverified, not rejected", () => {
  const ch = parseYouTubeRss(XML, ID) // 3 uploads in 30d, durations unknown
  const row = toResearchRow(ch, { now: FIXTURE_NOW, countryHint: "US" })
  const p = processBatch([{ row, ref: "d1" }], emptyIndex(), { now: FIXTURE_NOW, source: "test", sender: FIXTURE_SENDER }).processed[0]
  const act = p.qualification.checks.find((c) => c.id === "activity")!
  assert.equal(act.pass, false)
  assert.equal(act.severity, "unverified")
  assert.match(act.reason, /unknown length/)
  // Known-short items still reject.
  const known = { ...row, content_items: JSON.stringify(JSON.parse(row.content_items).map((i: any) => ({ ...i, isLongform: false }))) }
  const k = processBatch([{ row: known, ref: "d2" }], emptyIndex(), { now: FIXTURE_NOW, source: "test", sender: FIXTURE_SENDER }).processed[0]
  assert.equal(k.qualification.checks.find((c) => c.id === "activity")!.severity, "reject")
})

test("primary language comes from the creator's own YouTube language settings, never a guess", async () => {
  const { primaryLanguage } = await import("../lib/leads/discovery")
  const base = parseYouTubeRss(XML, ID)
  const v = (lang: string | null, i: number) => ({ ...base.videos[0], url: `u${i}`, publishedAt: `2026-10-2${i}`, language: lang })
  assert.equal(primaryLanguage({ ...base, videos: [v("en-US", 1), v("en", 2), v("en-GB", 3), v("es", 4)] }), "en")
  assert.equal(primaryLanguage({ ...base, videos: [v("en", 1), v("es", 2), v("es", 3), v("en", 4)] }), null) // no clear majority, no default
  assert.equal(primaryLanguage({ ...base, defaultLanguage: "en-GB", videos: [v(null, 1)] }), "en") // channel default
  assert.equal(primaryLanguage(base), null) // RSS: unknown
  assert.match(toResearchRow(base, { now: FIXTURE_NOW }).review_notes, /CONFIRM: primary_language/)
})
