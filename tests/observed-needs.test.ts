import { test } from "node:test"
import assert from "node:assert/strict"
import { observeNeeds, toResearchRow, type DiscoveredChannel, type DiscoveredVideo } from "../lib/leads/discovery"
import { parseLeadRow } from "../lib/leads/normalize"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { FIXTURE_SENDER } from "./fixtures/rows"

// FICTIONAL channel data in the YouTube API shape discovery produces.
const NOW = new Date("2026-10-29T12:00:00Z")
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const vid = (n: number, ageDays: number, o: Partial<DiscoveredVideo> = {}): DiscoveredVideo => ({
  url: `https://www.youtube.com/watch?v=obs${n}`, title: `Episode ${n}: building a studio`, publishedAt: day(ageDays), description: "",
  isLongform: true, durationSec: 3600, hasCaptions: false, language: "en", ...o,
})
const channel = (videos: DiscoveredVideo[], source: DiscoveredChannel["source"] = "youtube_api"): DiscoveredChannel => ({
  channelId: "UCFIXTURE000000000000099", title: "Fixture Studio Pod", channelUrl: "https://www.youtube.com/channel/UCFIXTURE000000000000099",
  description: "", country: "US", subscribers: 20000, videos, source,
})
// Weekly long episodes, no captions, no Shorts.
const weekly = [0, 7, 14, 21, 28, 35].map((age, i) => vid(6 - i, age, i === 0 ? { description: "Business inquiries: hello@fixturestudio.test" } : {}))

test("captions and repurposing are observed from API facts, each with a checkable URL", () => {
  const needs = observeNeeds(channel(weekly), NOW)
  assert.deepEqual(needs.map((n) => n.need), ["captions", "repurposing"])
  assert.equal(needs[0].evidenceUrl, "https://www.youtube.com/watch?v=obs6") // newest long-form video
  assert.match(needs[0].text, /don't have an uploaded caption track/)
  assert.match(needs[1].detail, /no video of 180s or less among the last 6 uploads/)
})

test("nothing is observed when the facts don't hold or aren't known", () => {
  const captioned = weekly.map((v) => ({ ...v, hasCaptions: true }))
  const withShort = [...captioned, vid(9, 3, { isLongform: false, durationSec: 45 })]
  assert.deepEqual(observeNeeds(channel(withShort), NOW), [])
  // Unknown caption flags or durations (RSS) never count as evidence.
  const unknown = weekly.map((v) => ({ ...v, hasCaptions: null, durationSec: null }))
  assert.deepEqual(observeNeeds(channel(unknown), NOW), [])
  assert.deepEqual(observeNeeds(channel(weekly, "youtube_rss"), NOW), [])
  // One recent long-form video isn't a pattern.
  assert.deepEqual(observeNeeds(channel([vid(1, 2), vid(2, 90), vid(3, 97), vid(4, 104), vid(5, 111)]), NOW).map((n) => n.need), ["publishing_consistency"])
})

test("a long gap against a steady rhythm is a consistency observation", () => {
  const vids = [vid(1, 1, { hasCaptions: true }), vid(2, 50, { hasCaptions: true }), vid(3, 57, { hasCaptions: true }), vid(4, 64, { hasCaptions: true }), vid(5, 71, { hasCaptions: true, durationSec: 40, isLongform: false })]
  const [n] = observeNeeds(channel(vids), NOW)
  assert.equal(n.need, "publishing_consistency")
  assert.equal(n.evidenceUrl, "https://www.youtube.com/watch?v=obs1")
  assert.match(n.detail, /49-day gap .* usual gap of 7 days/)
})

test("observed needs reach the row labelled as observed, and messages say 'I noticed', not 'You mentioned'", () => {
  const row = toResearchRow(channel(weekly), { now: NOW })
  assert.equal(row.incubrix_need, "captions")
  assert.equal(row.need_source, "observed")
  assert.match(row.review_notes, /CHECK: need is observed, not stated \(captions\)/)
  const parsed = parseLeadRow(row as unknown as Record<string, unknown>, "test")
  assert.ok(parsed.ok)
  assert.equal(parsed.ok && parsed.input.needSource, "observed")
  const r = processBatch([{ row: { ...row, entity_type: "individual" }, ref: "o1" }], emptyIndex(), { now: NOW, source: "test", sender: FIXTURE_SENDER })
  const bodies = r.processed[0].messages.map((m) => m.body).join("\n")
  assert.match(bodies, /I noticed your recent long-form videos/)
  assert.doesNotMatch(bodies, /You mentioned/)
  assert.ok(r.processed[0].qualification.checks.find((c) => c.id === "need")!.pass)
})

test("a stated need always wins over an observation, and is quoted once", () => {
  const stated = channel([{ ...weekly[0], description: "We're hiring a video editor for the show. Business inquiries: hello@fixturestudio.test" }, ...weekly.slice(1)])
  const row = toResearchRow(stated, { now: NOW })
  assert.equal(row.incubrix_need, "editing")
  assert.equal(row.need_source, "stated")
  assert.match(row.need_signal_text, /^"/)
  const r = processBatch([{ row: { ...row, entity_type: "individual" }, ref: "s1" }], emptyIndex(), { now: NOW, source: "test", sender: FIXTURE_SENDER })
  const body = r.processed[0].messages[0].body
  assert.match(body, /You mentioned "/)
  assert.doesNotMatch(body, /You mentioned you mentioned/)
})
