import { test } from "node:test"
import assert from "node:assert/strict"
import { entityPrompt, locateQuote, quoteShowsEntity, verdictFrom, type EntitySource } from "../lib/leads/entity"
import { parseLeadRow } from "../lib/leads/normalize"

// FICTIONAL channel text.
const src: EntitySource = {
  channelUrl: "https://www.youtube.com/channel/UCFIXTURE000000000000055",
  title: "Fixture Growth Show",
  description: "Hi, I’m Sam Fixture, a business coach.  New episodes every Tuesday.\nBusiness inquiries: hello@fixture.test",
  videos: [
    { url: "https://www.youtube.com/watch?v=ent1", title: "How to price your coaching offer" },
    { url: "https://www.youtube.com/watch?v=ent2", title: "Hosted by Sam and Alex: Q&A #12" },
  ],
}
const M = "qwen3:4b"

test("a quote is located word for word in the creator's own text (case, spacing and curly quotes ignored)", () => {
  assert.equal(locateQuote(src, "hi, i'm sam fixture, a business coach."), `${src.channelUrl}/about`)
  assert.equal(locateQuote(src, "Hosted by Sam and Alex"), "https://www.youtube.com/watch?v=ent2")
  assert.equal(locateQuote(src, "I'm Sam, a top business coach"), null) // altered wording
  assert.equal(locateQuote(src, "Hi"), null) // too short to mean anything
})

test("the quote must say who runs the channel, not just exist", () => {
  assert.ok(quoteShowsEntity("individual", "Hi, I'm Sam Fixture, a business coach"))
  assert.ok(quoteShowsEntity("individual", "Hosted by Sam and Alex"))
  assert.ok(!quoteShowsEntity("individual", "How to price your coaching offer"))
  assert.ok(quoteShowsEntity("agency", "We are a digital marketing agency"))
  assert.ok(!quoteShowsEntity("brand", "Hi, I'm Sam"))
})

test("only a located quote that shows the entity can set it; everything else stays for review", () => {
  const ok = verdictFrom(src, { entity: "individual", quote: "Hi, I'm Sam Fixture, a business coach" }, M)
  assert.deepEqual([ok.entityType, ok.evidenceUrl], ["individual", `${src.channelUrl}/about`])
  assert.equal(verdictFrom(src, { entity: "unsure", quote: "" }, M).entityType, "needs_review")
  const made = verdictFrom(src, { entity: "individual", quote: "I'm Sam, host of the top coaching show" }, M)
  assert.equal(made.entityType, "needs_review")
  assert.match(made.reason, /quote not found/)
  const topic = verdictFrom(src, { entity: "individual", quote: "How to price your coaching offer" }, M)
  assert.equal(topic.entityType, "needs_review")
  assert.match(topic.reason, /doesn't say who runs the channel/)
  assert.equal(verdictFrom(src, { entity: "freelancer", quote: "Hi, I'm Sam Fixture" }, M).entityType, "needs_review") // not an allowed answer
})

test("the prompt is short and only contains the creator's own text", () => {
  const long = { ...src, description: "x".repeat(5000), videos: Array.from({ length: 20 }, (_, i) => ({ url: `u${i}`, title: `Video ${i}` })) }
  const p = entityPrompt(long)
  assert.ok(p.length < 1200, String(p.length))
  assert.equal((p.match(/^- Video/gm) ?? []).length, 8)
})

test("entity evidence columns reach the engine input", () => {
  const parsed = parseLeadRow({
    creator_name: "Fixture Growth Show", creator_segment: "youtuber", entity_type: "individual", primary_platform: "youtube",
    profile_url: src.channelUrl, stable_creator_id: "UCFIXTURE000000000000055",
    entity_evidence_url: `${src.channelUrl}/about`, entity_quote: "Hi, I'm Sam Fixture", entity_source: "ai:qwen3:4b",
  }, "test")
  assert.ok(parsed.ok)
  if (parsed.ok) assert.deepEqual([parsed.input.entityEvidenceUrl, parsed.input.entityQuote, parsed.input.entitySource], [`${src.channelUrl}/about`, "Hi, I'm Sam Fixture", "ai:qwen3:4b"])
})

test("the prompt's own patterns can't be copied as evidence; a story line alone doesn't prove a person runs it", () => {
  assert.equal(verdictFrom(src, { entity: "individual", quote: "I'm <name>, a <job>" }, M).entityType, "needs_review")
  // Studios write founder stories in the first person too, so "I was…" goes to a person.
  const story = { ...src, description: "At 30, I was broke and two weeks from eviction. Now I teach money." }
  assert.equal(verdictFrom(story, { entity: "individual", quote: "At 30, I was broke" }, M).entityType, "needs_review")
  assert.equal(verdictFrom(story, { entity: "individual", quote: "Now I teach money" }, M).entityType, "individual")
})

test("a quote from a fetched video description is located and points at that video", () => {
  const src = {
    channelUrl: "https://www.youtube.com/channel/UC1", title: "Grow Show", description: "",
    videos: [{ url: "https://youtu.be/a", title: "Episode 12", description: "Hi, I'm Sam Lee and on this show I talk to founders." }],
  }
  assert.equal(locateQuote(src, "I'm Sam Lee and on this show"), "https://youtu.be/a")
  assert.match(entityPrompt(src), /Recent video descriptions:\n- Hi, I'm Sam Lee/)
  // Without descriptions the prompt is unchanged (title-only answers keep their cache).
  assert.doesNotMatch(entityPrompt({ ...src, videos: [{ url: "https://youtu.be/a", title: "Episode 12" }] }), /descriptions/)
})
