import { test } from "node:test"
import assert from "node:assert/strict"
import { toResearchRow, type DiscoveredChannel } from "../lib/leads/discovery"
import { extractSocialLinks, instagramConfig, lookupInstagram, socialColumns, type InstagramLookup } from "../lib/leads/social"
import { parseLeadRow } from "../lib/leads/normalize"
import { recommendChannels } from "../lib/leads/channels"
import { FIXTURE_NOW } from "./fixtures/rows"

// FICTIONAL channel. Links appear only in the creator's own descriptions.
const ch: DiscoveredChannel = {
  channelId: "UCFIXTURE000000000000088",
  title: "Fixture Coach",
  channelUrl: "https://www.youtube.com/channel/UCFIXTURE000000000000088",
  description: "Coaching for founders. Instagram: https://www.instagram.com/fixture.coach/ | LinkedIn: https://www.linkedin.com/company/fixture-coach-co",
  country: "US",
  subscribers: 12000,
  source: "youtube_api",
  videos: [
    { url: "https://www.youtube.com/watch?v=fxc2", title: "Episode 2", publishedAt: "2026-10-20T10:00:00Z", isLongform: true, description: "Clip: instagram.com/p/AbC123 Follow instagram.com/Fixture.Coach and linkedin.com/in/fixture-coach" },
    { url: "https://www.youtube.com/watch?v=fxc1", title: "Episode 1", publishedAt: "2026-10-05T10:00:00Z", isLongform: true, description: "instagram.com/explore/tags/coaching" },
  ],
}

const igOk = (bio: string, posts = [{ permalink: "https://www.instagram.com/p/X1/", timestamp: "2026-10-24T09:00:00+0000", caption: "new episode" }]): InstagramLookup => ({
  ok: true,
  profile: { username: "fixture.coach", name: "Fixture Coach", biography: bio, website: null, followers: 5000, mediaCount: 300, posts },
})

test("social links come only from published text: posts, tags and app pages are ignored", () => {
  const l = extractSocialLinks(ch)
  assert.deepEqual(l.instagram.map((x) => x.value), ["fixture.coach"])
  assert.equal(l.instagram[0].evidenceUrl, `${ch.channelUrl}/about`)
  assert.equal(l.instagram[0].lastSeen, "2026-10-20T10:00:00Z") // also mentioned in the newest video
  // Personal profile first, company page as fallback.
  assert.deepEqual(l.linkedin.map((x) => x.value), ["in/fixture-coach", "company/fixture-coach-co"])
  assert.equal(l.linkedin[0].url, "https://www.linkedin.com/in/fixture-coach/")
  assert.equal(l.linkedin[0].evidenceUrl, "https://www.youtube.com/watch?v=fxc2")
  assert.deepEqual(extractSocialLinks({ ...ch, description: "", videos: [] }), { instagram: [], linkedin: [] })
})

test("LinkedIn is recorded but never marked active or business-use without a person confirming", () => {
  const s = socialColumns(ch, null)
  assert.equal(s.cols.linkedin_url, "https://www.linkedin.com/in/fixture-coach/")
  assert.equal(s.cols.linkedin_last_active, "")
  assert.equal(s.cols.linkedin_business_use, "")
  assert.ok(s.notes.some((n) => /CONFIRM: LinkedIn/.test(n)))
  assert.ok(s.notes.some((n) => /set INSTAGRAM_ACCESS_TOKEN/.test(n)))
})

test("a verified Instagram account becomes a reachable backup channel; a bio email is used with the profile as evidence", () => {
  const s = socialColumns(ch, igOk("Founder coach. Business: hello@fixturecoach.test"))
  assert.equal(s.cols.instagram_handle, "@fixture.coach")
  assert.equal(s.cols.instagram_last_active, "2026-10-24")
  assert.equal(s.cols.instagram_business_use, "yes")
  assert.deepEqual(s.bioEmail, { value: "hello@fixturecoach.test", evidenceUrl: "https://www.instagram.com/fixture.coach/", lastActive: "2026-10-24" })

  const row = toResearchRow(ch, { now: FIXTURE_NOW, instagram: igOk("Founder coach. Business: hello@fixturecoach.test") })
  assert.equal(row.email, "hello@fixturecoach.test")
  const parsed = parseLeadRow(row as unknown as Record<string, unknown>, "test")
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error)
  const rec = recommendChannels(parsed.ok ? parsed.input.contacts : [], FIXTURE_NOW)
  assert.equal(rec.best, "email")
  assert.equal(rec.backup, "instagram")
})

test("an Instagram bio without business wording, or a failed lookup, stays unconfirmed", () => {
  assert.equal(socialColumns(ch, igOk("Just vibes")).cols.instagram_business_use, "")
  const none = socialColumns(ch, { ok: false, reason: "not_professional_or_missing", error: "not found" })
  assert.equal(none.cols.instagram_last_active, "")
  assert.ok(none.notes.some((n) => /isn't a public professional/.test(n)))
  assert.equal(socialColumns(ch, igOk("Business: dm me", [])).cols.instagram_last_active, "")
})

test("Business Discovery: parses the profile, flags rate limits, and stops on a bad token", async () => {
  const cfg = { token: "TEST_TOKEN", igUserId: "1789" }
  const reply = (status: number, body: unknown) => async (url: string) => {
    assert.match(url, /graph\.facebook\.com\/1789\?fields=business_discovery\.username\(fixture\.coach\)/)
    return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) }
  }
  const ok = await lookupInstagram("fixture.coach", cfg, {
    fetcher: reply(200, { business_discovery: { username: "fixture.coach", biography: "Coach", followers_count: 5000, media_count: 3, media: { data: [{ permalink: "p", timestamp: "2026-10-24T09:00:00+0000", caption: "c" }] } } }),
  })
  assert.ok(ok.ok && ok.profile.followers === 5000 && ok.profile.posts.length === 1)
  const limited = await lookupInstagram("fixture.coach", cfg, { fetcher: reply(400, { error: { code: 4, message: "Application request limit reached" } }) })
  assert.deepEqual(limited.ok ? null : limited.reason, "rate_limited")
  const missing = await lookupInstagram("fixture.coach", cfg, { fetcher: reply(400, { error: { code: 110, message: "Invalid user id" } }) })
  assert.deepEqual(missing.ok ? null : missing.reason, "not_professional_or_missing")
  await assert.rejects(lookupInstagram("fixture.coach", cfg, { fetcher: reply(400, { error: { code: 190, message: "expired" } }) }), /token invalid or expired/)
  assert.equal(instagramConfig({ INSTAGRAM_ACCESS_TOKEN: "x" }), null)
})
