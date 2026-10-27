import { test } from "node:test"
import assert from "node:assert/strict"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { validateMessage } from "../lib/leads/messages"
import { recommendChannels } from "../lib/leads/channels"
import { checkBearer } from "../lib/auth"
import { assertSendAllowed, isAllowlisted, parseAllowlist, seedReport } from "../lib/leads/seed-test"
import { fetchYouTubeActivity, ProviderError, readInputFile } from "../lib/leads/providers"
import { redact } from "../lib/leads/engine"
import { CHANNEL_LIMITS } from "../lib/leads/config"
import { FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_SENDER } from "./fixtures/rows"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const one = (row: Record<string, unknown>) =>
  processBatch([{ row, ref: "r1" }], emptyIndex(), { now: FIXTURE_NOW, source: "test", sender: FIXTURE_SENDER }).processed[0]

test("each channel gets 3 messages that pass validation and cite real content", () => {
  const p = one(FIXTURE_ROWS[0])
  assert.equal(p.messages.length, 9)
  const latest = p.recentContent!
  for (const m of p.messages) {
    assert.equal(m.status, "draft", `${m.channel}#${m.sequence}`)
    const v = validateMessage(m, FIXTURE_SENDER, latest)
    assert.ok(v.ok, `${m.channel}#${m.sequence}: ${v.problems.join(", ")}`)
    assert.ok(m.evidenceRefs.includes(latest.url))
  }
  const li = p.messages.find((m) => m.channel === "linkedin" && m.sequence === 1)!
  assert.ok(li.body.length <= CHANNEL_LIMITS.linkedin.connection)
  assert.ok(p.messages.find((m) => m.channel === "email" && m.sequence === 1)!.body.includes(FIXTURE_SENDER.postalAddress))
})

test("long titles still fit the LinkedIn 300-char connection note", () => {
  const items = JSON.stringify([{ url: "https://www.youtube.com/watch?v=long1", title: "A".repeat(400), publishedAt: "2026-10-25", isLongform: true }, { url: "https://www.youtube.com/watch?v=long2", title: "B", publishedAt: "2026-10-01", isLongform: true }])
  const li = one({ ...FIXTURE_ROWS[0], content_items: items }).messages.find((m) => m.channel === "linkedin" && m.sequence === 1)!
  assert.ok(li.body.length <= 300, String(li.body.length))
})

test("channels without verified evidence are unavailable with a reason, never invented", () => {
  const p = one({ ...FIXTURE_ROWS[0], linkedin_url: "", instagram_evidence_url: "" })
  const li = p.messages.filter((m) => m.channel === "linkedin")
  assert.ok(li.every((m) => m.status === "unavailable" && /No linkedin route found/.test(m.unavailableReason!) && m.body === ""))
  const ig = p.messages.filter((m) => m.channel === "instagram")
  assert.ok(ig.every((m) => m.status === "unavailable" && /no valid public evidence URL/.test(m.unavailableReason!)))
  assert.equal(p.channels.best, "email")
  assert.equal(p.channels.backup, null)
})

test("validateMessage catches missing opt-out and sender", () => {
  const v = validateMessage({ channel: "email", sequence: 1, subject: "x", body: "Hi there, great video." }, FIXTURE_SENDER, { title: "great video", url: "https://x.y" })
  assert.equal(v.ok, false)
  assert.ok(v.problems.includes("missing opt-out language"))
  assert.ok(v.problems.includes("missing sender identification"))
})

test("channel recommendation explains itself and prefers recent, business routes", () => {
  const rec = recommendChannels([
    { channel: "instagram", value: "@me", evidenceUrl: "https://example.com/a", lastActiveAt: "2026-10-26", source: "published", businessUse: true },
    { channel: "email", value: "me@example.com", evidenceUrl: "https://example.com/b", lastActiveAt: "2026-10-20", source: "published", businessUse: true },
    { channel: "linkedin", value: "https://www.linkedin.com/in/me", evidenceUrl: "https://example.com/c", lastActiveAt: "2026-06-01", source: "published", businessUse: true },
  ], FIXTURE_NOW)
  assert.equal(rec.best, "email")
  assert.equal(rec.backup, "instagram")
  assert.equal(rec.verificationStatus, "verified")
  assert.match(rec.bestReason, /No response-rate evidence assumed/)
  assert.match(rec.unavailable.find((u) => u.channel === "linkedin")!.reason, /older than 60d/)
  assert.deepEqual(rec.evidenceUsed, ["https://example.com/b", "https://example.com/a"])
})

test("webhook bearer auth: constant-time, closed in production without a secret", () => {
  assert.equal(checkBearer("Bearer s3cret", "s3cret").ok, true)
  assert.equal(checkBearer("Bearer wrong!", "s3cret").ok, false)
  assert.equal(checkBearer(null, "s3cret").ok, false)
  assert.equal(checkBearer(null, undefined, "development").ok, true)
  assert.equal(checkBearer("Bearer anything", undefined, "production").ok, false)
})

test("test mode refuses non-allowlisted recipients", () => {
  const env = { SEED_TEST_ALLOWLIST: "email:me@mine.test, instagram:@My_Test" }
  assert.doesNotThrow(() => assertSendAllowed("email", "ME@mine.test", env))
  assert.doesNotThrow(() => assertSendAllowed("instagram", "my_test", env))
  assert.throws(() => assertSendAllowed("email", "creator@realdomain.com", env), /not on SEED_TEST_ALLOWLIST/)
  assert.throws(() => assertSendAllowed("email", "me@mine.test", {}), /Test mode/)
  assert.doesNotThrow(() => assertSendAllowed("email", "anyone@x.com", { OUTREACH_MODE: "live" }))
  assert.equal(isAllowlisted("linkedin", "me@mine.test", parseAllowlist(env.SEED_TEST_ALLOWLIST)), false)
})

test("seed report: passes only when every expected event was observed", () => {
  const entries = parseAllowlist("email:me@mine.test,instagram:@me")
  const ev = (channel: string, recipient: string, eventType: string, t: string) => ({ channel, recipient, eventType, occurredAt: `2026-10-27T10:00:0${t}Z` })
  const partial = seedReport(entries, [ev("email", "me@mine.test", "scheduled", "1"), ev("email", "me@mine.test", "sent", "2"), ev("email", "me@mine.test", "click", "3")])
  assert.equal(partial.pass, false)
  assert.deepEqual(partial.rows[0].missing, ["reply"])
  assert.deepEqual(partial.rows[1].missing, ["scheduled", "sent", "click", "reply"])
  const full = seedReport(entries.slice(0, 1), [...["scheduled", "sent", "click", "reply"].map((t, i) => ev("email", "me@mine.test", t, String(i)))])
  assert.equal(full.pass, true)
  assert.deepEqual(full.rows[0].observed.map((o) => o.type), ["scheduled", "sent", "click", "reply"])
  assert.equal(seedReport([], []).pass, false)
})

test("failed provider calls surface as errors, not fake data", async () => {
  await assert.rejects(fetchYouTubeActivity(["UCFIXTURE0000000000001"], { apiKey: undefined }), ProviderError)
  const fetcher = async () => ({ ok: false, status: 403, json: async () => ({}) })
  await assert.rejects(fetchYouTubeActivity(["UCFIXTURE0000000000001"], { apiKey: "k", fetcher }), /HTTP 403/)
  assert.throws(() => readInputFile(path.join(os.tmpdir(), "does-not-exist.csv")), /input not found/)
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lt-")), "bad.json")
  fs.writeFileSync(bad, "{not json")
  assert.throws(() => readInputFile(bad), /invalid JSON/)
})

test("youtube provider maps API data into activity fields", async () => {
  const responses: Record<string, any> = {
    channels: { items: [{ id: "UCFIXTURE0000000000000001", snippet: { title: "Fx", country: "NZ" }, statistics: { subscriberCount: "1234" }, contentDetails: { relatedPlaylists: { uploads: "UUfx" } } }] },
    playlistItems: { items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] },
    videos: { items: [
      { id: "v1", snippet: { title: "Long one", publishedAt: "2026-10-20T00:00:00Z", defaultAudioLanguage: "en-GB" }, contentDetails: { duration: "PT1H2M" } },
      { id: "v2", snippet: { title: "Short", publishedAt: "2026-10-21T00:00:00Z", defaultAudioLanguage: "en" }, contentDetails: { duration: "PT45S" } },
    ] },
  }
  const fetcher = async (u: string) => ({ ok: true, status: 200, json: async () => responses[new URL(u).pathname.split("/").pop()!] })
  const r = await fetchYouTubeActivity(["UCFIXTURE0000000000000001"], { apiKey: "k", fetcher })
  const row = r.byChannel.get("UCFIXTURE0000000000000001")!
  assert.equal(r.apiUnits, 3)
  assert.equal(row.country_iso2, "NZ")
  assert.equal(row.primary_language, "en")
  assert.equal(row.followers_or_subscribers, 1234)
  const items = JSON.parse(String(row.content_items))
  assert.deepEqual(items.map((i: any) => i.isLongform), [true, false])
})

test("logs redact emails and API keys", () => {
  assert.equal(redact("failed for jane@example.com at https://x?key=abc123&y=1"), "failed for [email] at https://x?key=[redacted]&y=1")
})
