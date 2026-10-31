import { test } from "node:test"
import assert from "node:assert/strict"
import { extractInstagramSignals, toInstagramLeadRow, type InstagramCreatorInput } from "../lib/leads/instagram"
import { extractSpotifySignals, toSpotifyLeadRow, type SpotifyShow, type SpotifyEpisode } from "../lib/leads/spotify"
import { extractLinkedInSignals, toLinkedInLeadRow, type LinkedInProfile } from "../lib/leads/linkedin"
import { fetchAndQualifyCreators } from "../lib/leads/multi-platform"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { parseLeadRow } from "../lib/leads/normalize"

const NOW = new Date("2026-10-31T12:00:00Z")
const SENDER = {
  name: "Alex Hunter",
  role: "Head of Creator Partnerships",
  company: "IncuBrix",
  website: "https://incubrix.example.com",
  postalAddress: "123 Market St, San Francisco, CA 94105",
}

test("Instagram creator: extracts signals and qualifies with active posts and bio email", () => {
  const creator: InstagramCreatorInput = {
    id: "17841405309211877",
    username: "sarah_creatorcoach",
    fullName: "Sarah Jenkins",
    biography: "Creator Business Coach (US-based). Helping expert creators scale. Sponsored by Riverside.fm. Inquiries: sarah@sarahjenkins.com",
    website: "https://sarahjenkins.com",
    followers: 52000,
    posts: Array.from({ length: 8 }, (_, i) => ({
      permalink: `https://www.instagram.com/p/DB00000000${i}/`,
      timestamp: `2026-10-${String(28 - i).padStart(2, "0")}T12:00:00Z`,
      caption: i === 0
        ? "We are hiring a video editor to turn our longform recordings into Reels! Email sarah@sarahjenkins.com"
        : i === 1
        ? "Thanks to Riverside.fm for sponsoring today's workflow breakdown. Check our masterclass at sarahjenkins.com"
        : `Creator tip #${i}: optimize your retention in the first 3 seconds`,
    })),
  }

  const sig = extractInstagramSignals(creator)
  assert.equal(sig.monetization[0]?.value, "sponsorship")
  assert.equal(sig.need[0]?.value, "editing")
  assert.equal(sig.emails[0]?.value, "sarah@sarahjenkins.com")
  assert.equal(sig.emails[0]?.businessUse, true)

  const row = toInstagramLeadRow(creator, { now: NOW, countryHint: "US" })
  const parsed = parseLeadRow(row, "test")
  assert.ok(parsed.ok, `parse failed: ${(parsed as any).error}`)

  const batch = processBatch([{ row, ref: "ig-test" }], emptyIndex(), { now: NOW, source: "test", sender: SENDER })
  assert.equal(batch.failures.length, 0)
  assert.equal(batch.processed.length, 1)

  const lead = batch.processed[0]
  assert.equal(lead.qualification.status, "qualified", `Rejection reason: ${lead.qualification.rejectionReason}`)
  assert.equal(lead.input.primaryPlatform, "instagram")
  assert.equal(lead.channels.best, "email")
  assert.equal(lead.channels.bestValue, "sarah@sarahjenkins.com")
  assert.ok(lead.score >= 70)
})

test("Spotify podcast creator: extracts signals, validates longform episodes and qualifies", () => {
  const show: SpotifyShow = {
    id: "4rOoJ6Egrf8K2IrywzwOMk",
    name: "The Growth Mindset Podcast",
    publisher: "David Mitchell",
    description: "Weekly conversations with world-class builders. Sponsorships and business inq: david@growthmindset.fm",
    languages: ["en"],
    external_urls: { spotify: "https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk" },
    total_episodes: 120,
  }

  const episodes: SpotifyEpisode[] = [
    {
      id: "512bOgnYX20VhCwimnzp61",
      name: "Episode 120: Engineering Growth with Notion's VP of Marketing",
      description: "Sponsored by Notion. We are looking for an audio editor for our weekly episodes: david@growthmindset.fm",
      release_date: "2026-10-25",
      duration_ms: 45 * 60 * 1000, // 45 mins longform
      external_urls: { spotify: "https://open.spotify.com/episode/512bOgnYX20VhCwimnzp61" },
    },
    {
      id: "512bOgnYX20VhCwimnzp62",
      name: "Episode 119: Content Distribution at Scale",
      description: "Brought to you by ConvertKit. Use promo code GROWTH for 20% off. Full show notes on our site.",
      release_date: "2026-10-18",
      duration_ms: 38 * 60 * 1000, // 38 mins longform
      external_urls: { spotify: "https://open.spotify.com/episode/512bOgnYX20VhCwimnzp62" },
    },
  ]

  const sig = extractSpotifySignals(show, episodes)
  assert.equal(sig.monetization[0]?.value, "sponsorship")
  assert.equal(sig.need[0]?.value, "editing")
  assert.equal(sig.emails[0]?.value, "david@growthmindset.fm")

  const row = toSpotifyLeadRow(show, episodes, { now: NOW, market: "US" })
  const parsed = parseLeadRow(row, "test")
  assert.ok(parsed.ok, `parse failed: ${(parsed as any).error}`)

  const batch = processBatch([{ row, ref: "spotify-test" }], emptyIndex(), { now: NOW, source: "test", sender: SENDER })
  assert.equal(batch.failures.length, 0)
  assert.equal(batch.processed.length, 1)

  const lead = batch.processed[0]
  assert.equal(lead.qualification.status, "qualified", `Rejection reason: ${lead.qualification.rejectionReason}`)
  assert.equal(lead.input.primaryPlatform, "spotify")
  assert.equal(lead.input.segment, "podcaster")
  assert.equal(lead.qualification.activity.longformCount60d, 2)
})

test("LinkedIn expert creator: extracts signals and qualifies with recent activity and contact", () => {
  const profile: LinkedInProfile = {
    slug: "emily-chen-product",
    fullName: "Emily Chen",
    headline: "Chief Product Officer & Tech Creator | Author of Product Levers | Executive Coach",
    summary: "I advise high-growth tech executives. 1:1 advisory & coaching programs open. Inquiries: emily@emilychenadvisory.com",
    location: "San Francisco, California, United States",
    followersCount: 42000,
    email: "emily@emilychenadvisory.com",
    website: "https://emilychenadvisory.com",
    posts: Array.from({ length: 8 }, (_, i) => ({
      url: `https://www.linkedin.com/in/emily-chen-product/recent-activity/post-${i + 1}`,
      title: `Executive Product Insight #${i + 1}`,
      text: i === 0
        ? "We're hiring a video editor to repurpose our leadership talks into short video clips! Reach out at emily@emilychenadvisory.com"
        : i === 1
        ? "Enrollment for my executive coaching cohort is open at emilychenadvisory.com/cohort"
        : `Product strategy framework #${i}: retention over acquisition`,
      publishedAt: `2026-10-${String(27 - i).padStart(2, "0")}`,
      isArticle: false,
    })),
  }

  const sig = extractLinkedInSignals(profile)
  assert.equal(sig.monetization[0]?.value, "service")
  assert.equal(sig.need[0]?.value, "editing")
  assert.equal(sig.emails[0]?.value, "emily@emilychenadvisory.com")

  const row = toLinkedInLeadRow(profile, { now: NOW, countryHint: "US" })
  const parsed = parseLeadRow(row, "test")
  assert.ok(parsed.ok, `parse failed: ${(parsed as any).error}`)

  const batch = processBatch([{ row, ref: "li-test" }], emptyIndex(), { now: NOW, source: "test", sender: SENDER })
  assert.equal(batch.failures.length, 0)
  assert.equal(batch.processed.length, 1)

  const lead = batch.processed[0]
  assert.equal(lead.qualification.status, "qualified", `Rejection reason: ${lead.qualification.rejectionReason}`)
  assert.equal(lead.input.primaryPlatform, "linkedin")
  assert.equal(lead.input.segment, "expert_creator")
})

test("fetchAndQualifyCreators runs across all three platforms and qualifies valid creators", async () => {
  const result = await fetchAndQualifyCreators({
    platforms: ["instagram", "spotify", "linkedin"],
    now: NOW,
    allowSampleDataOnAuthError: true,
  })

  assert.equal(result.totalFetched, 3)
  assert.equal(result.qualifiedCount, 3)
  assert.equal(result.unverifiedCount, 0)
  assert.equal(result.rejectedCount, 0)

  assert.equal(result.platformSummaries.instagram.qualified, 1)
  assert.equal(result.platformSummaries.spotify.qualified, 1)
  assert.equal(result.platformSummaries.linkedin.qualified, 1)

  // Verify each qualified lead has generated personalized messages
  for (const lead of result.qualifiedLeads) {
    assert.ok(lead.messages.length > 0)
    assert.ok(lead.channels.best !== null)
    assert.ok(lead.firstMessage !== null)
  }
})
