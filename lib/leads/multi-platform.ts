// Multi-platform Creator Discovery and Qualification Engine.
// Fetches creators from Instagram, Spotify, and LinkedIn APIs,
// extracts verifiable evidence, and runs them through the 15 deterministic
// qualification criteria defined in lib/leads/qualify.ts.

import { toInstagramLeadRow, fetchInstagramViaGraph, searchInstagramViaHashtag, type InstagramCreatorInput } from "./instagram"
import { toSpotifyLeadRow, searchSpotifyShows, fetchSpotifyShowEpisodes, type SpotifyShow, type SpotifyEpisode } from "./spotify"
import { toLinkedInLeadRow, fetchLinkedInProfilesViaApify, type LinkedInProfile } from "./linkedin"
import { processBatch, emptyIndex, type ProcessedLead, type BatchResult } from "./process"
import { senderFromEnv } from "./config"
import type { Platform } from "./types"

export type MultiPlatformFetchOptions = {
  platforms?: ("instagram" | "spotify" | "linkedin")[]
  query?: string
  limit?: number
  now?: Date
  market?: string
  // Explicit targets when you know the accounts/creators to evaluate:
  instagramUsernames?: string[]
  spotifyShowIds?: string[]
  linkedInSlugs?: string[]
  // Synthetic / fixture fallbacks for offline testing or when credentials are not configured:
  allowSampleDataOnAuthError?: boolean
}

export type PlatformSummary = {
  platform: "instagram" | "spotify" | "linkedin"
  fetched: number
  qualified: number
  unverified: number
  rejected: number
  errors: string[]
}

export type MultiPlatformResult = {
  totalFetched: number
  qualifiedCount: number
  unverifiedCount: number
  rejectedCount: number
  qualifiedLeads: ProcessedLead[]
  unverifiedLeads: ProcessedLead[]
  rejectedLeads: ProcessedLead[]
  platformSummaries: Record<string, PlatformSummary>
  rawRows: Record<string, unknown>[]
  batchResult: BatchResult
}

export async function fetchAndQualifyCreators(opts: MultiPlatformFetchOptions = {}): Promise<MultiPlatformResult> {
  const now = opts.now ?? new Date()
  const targetPlatforms = opts.platforms ?? ["instagram", "spotify", "linkedin"]
  const limit = opts.limit ?? 10
  const query = opts.query || "creator"
  const market = opts.market || "US"

  const rawRows: { row: Record<string, unknown>; ref: string }[] = []
  const platformSummaries: Record<string, PlatformSummary> = {
    instagram: { platform: "instagram", fetched: 0, qualified: 0, unverified: 0, rejected: 0, errors: [] },
    spotify: { platform: "spotify", fetched: 0, qualified: 0, unverified: 0, rejected: 0, errors: [] },
    linkedin: { platform: "linkedin", fetched: 0, qualified: 0, unverified: 0, rejected: 0, errors: [] },
  }

  // ── 1. Instagram ────────────────────────────────────────────────────────────
  if (targetPlatforms.includes("instagram")) {
    const summary = platformSummaries.instagram
    const creators: InstagramCreatorInput[] = []
    
    // Explicit usernames or hashtag search
    const usernames = opts.instagramUsernames ?? []
    for (const u of usernames) {
      try {
        const creator = await fetchInstagramViaGraph(u)
        if (creator) creators.push(creator)
      } catch (e: any) {
        summary.errors.push(`@${u}: ${e.message}`)
      }
    }

    if (!usernames.length && process.env.APIFY_TOKEN) {
      try {
        const tag = query.startsWith("#") ? query : `#${query.replace(/\s+/g, "")}`
        const fetched = await searchInstagramViaHashtag(tag, limit)
        creators.push(...fetched)
      } catch (e: any) {
        summary.errors.push(`Hashtag discovery: ${e.message}`)
      }
    }

    // Fallback sample data if no credentials or network failure
    if (!creators.length && opts.allowSampleDataOnAuthError) {
      creators.push(...sampleInstagramCreators(now))
    }

    summary.fetched = creators.length
    for (const c of creators) {
      const row = toInstagramLeadRow(c, { now, countryHint: market })
      rawRows.push({ row, ref: `instagram:@${c.username}` })
    }
  }

  // ── 2. Spotify ─────────────────────────────────────────────────────────────
  if (targetPlatforms.includes("spotify")) {
    const summary = platformSummaries.spotify
    const showsWithEpisodes: { show: SpotifyShow; episodes: SpotifyEpisode[] }[] = []

    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      try {
        const shows = await searchSpotifyShows(query, { market, limit })
        for (const show of shows.slice(0, limit)) {
          try {
            const episodes = await fetchSpotifyShowEpisodes(show.id, { market, limit: 10 })
            showsWithEpisodes.push({ show, episodes })
          } catch (e: any) {
            summary.errors.push(`Show ${show.id}: ${e.message}`)
          }
        }
      } catch (e: any) {
        summary.errors.push(`Spotify search: ${e.message}`)
      }
    } else if (opts.spotifyShowIds?.length) {
      summary.errors.push("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not configured")
    }

    if (!showsWithEpisodes.length && opts.allowSampleDataOnAuthError) {
      showsWithEpisodes.push(...sampleSpotifyShows(now))
    }

    summary.fetched = showsWithEpisodes.length
    for (const { show, episodes } of showsWithEpisodes) {
      const row = toSpotifyLeadRow(show, episodes, { now, market })
      rawRows.push({ row, ref: `spotify:${show.id}` })
    }
  }

  // ── 3. LinkedIn ────────────────────────────────────────────────────────────
  if (targetPlatforms.includes("linkedin")) {
    const summary = platformSummaries.linkedin
    const profiles: LinkedInProfile[] = []

    if (opts.linkedInSlugs?.length && process.env.APIFY_TOKEN) {
      try {
        const urls = opts.linkedInSlugs.map((s) => `https://www.linkedin.com/in/${s}/`)
        const fetched = await fetchLinkedInProfilesViaApify(urls)
        profiles.push(...fetched)
      } catch (e: any) {
        summary.errors.push(`LinkedIn Apify: ${e.message}`)
      }
    }

    if (!profiles.length && opts.allowSampleDataOnAuthError) {
      profiles.push(...sampleLinkedInProfiles(now))
    }

    summary.fetched = profiles.length
    for (const p of profiles) {
      const row = toLinkedInLeadRow(p, { now, countryHint: market })
      rawRows.push({ row, ref: `linkedin:${p.slug}` })
    }
  }

  // ── 4. Batch Qualification via Lead Engine ────────────────────────────────
  const sender = senderFromEnv() ?? {
    name: "Alex Hunter",
    role: "Head of Creator Partnerships",
    company: "IncuBrix",
    website: "https://incubrix.example.com",
    postalAddress: "123 Market St, San Francisco, CA 94105",
  }

  const batchResult = processBatch(rawRows, emptyIndex(), {
    now,
    source: "multi_platform_discovery",
    sender,
  })

  const qualifiedLeads: ProcessedLead[] = []
  const unverifiedLeads: ProcessedLead[] = []
  const rejectedLeads: ProcessedLead[] = []

  for (const lead of batchResult.processed) {
    const plat = lead.input.primaryPlatform as "instagram" | "spotify" | "linkedin"
    const summary = platformSummaries[plat]
    if (lead.qualification.status === "qualified") {
      qualifiedLeads.push(lead)
      if (summary) summary.qualified++
    } else if (lead.qualification.status === "unverified") {
      unverifiedLeads.push(lead)
      if (summary) summary.unverified++
    } else {
      rejectedLeads.push(lead)
      if (summary) summary.rejected++
    }
  }

  return {
    totalFetched: rawRows.length,
    qualifiedCount: qualifiedLeads.length,
    unverifiedCount: unverifiedLeads.length,
    rejectedCount: rejectedLeads.length,
    qualifiedLeads,
    unverifiedLeads,
    rejectedLeads,
    platformSummaries,
    rawRows: rawRows.map((r) => r.row),
    batchResult,
  }
}

// ── Sample Creators for offline testing and verification ────────────────────

function sampleInstagramCreators(now: Date): InstagramCreatorInput[] {
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
  return [
    {
      id: "17841405309211877",
      username: "elena_contentcoach",
      fullName: "Elena Rostova",
      biography: "Founder & Creator Coach (US-based). Helping expert creators scale. Sponsored by Notion & Riverside. Inquiries: elena@elenacoaching.com",
      website: "https://elenacoaching.com",
      followers: 48500,
      posts: [
        { permalink: "https://www.instagram.com/p/DB111111111/", timestamp: `${d(2)}T14:00:00Z`, caption: "Hiring a video editor for our weekly Reels & Shorts! DM or email elena@elenacoaching.com" },
        { permalink: "https://www.instagram.com/p/DB222222222/", timestamp: `${d(5)}T14:00:00Z`, caption: "Mastering creator retention. Check our coaching cohort at elenacoaching.com" },
        { permalink: "https://www.instagram.com/p/DB333333333/", timestamp: `${d(8)}T14:00:00Z`, caption: "Thanks to Riverside for sponsoring today's video workflow walkthrough." },
        { permalink: "https://www.instagram.com/p/DB444444444/", timestamp: `${d(11)}T14:00:00Z`, caption: "5 editing mistakes holding your engagement back" },
        { permalink: "https://www.instagram.com/p/DB555555555/", timestamp: `${d(14)}T14:00:00Z`, caption: "Content strategy playbook: how to schedule consistent posts" },
        { permalink: "https://www.instagram.com/p/DB666666666/", timestamp: `${d(18)}T14:00:00Z`, caption: "Breakdown of our video podcast setup" },
        { permalink: "https://www.instagram.com/p/DB777777777/", timestamp: `${d(22)}T14:00:00Z`, caption: "How to repurpose long episodes into viral micro-content" },
        { permalink: "https://www.instagram.com/p/DB888888888/", timestamp: `${d(26)}T14:00:00Z`, caption: "Why captions matter for 85% of mobile viewers" },
      ],
    },
  ]
}

function sampleSpotifyShows(now: Date): { show: SpotifyShow; episodes: SpotifyEpisode[] }[] {
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
  return [
    {
      show: {
        id: "4rOoJ6Egrf8K2IrywzwOMk",
        name: "The Creator Engineering Show",
        publisher: "Marcus Sterling",
        description: "Weekly deep dives with creators building 7-figure digital businesses. Inquiries and sponsorships: sponsor@creatorengineer.com",
        languages: ["en"],
        external_urls: { spotify: "https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk" },
        total_episodes: 84,
      },
      episodes: [
        {
          id: "512bOgnYX20VhCwimnzp61",
          name: "Ep 84: Scaling Video Production and Hiring Your First Editor",
          description: "In this episode Marcus breaks down his weekly workflow. Brought to you by ConvertKit. We are looking for an audio editor: sponsor@creatorengineer.com",
          release_date: d(4),
          duration_ms: 42 * 60 * 1000, // 42 mins longform
          external_urls: { spotify: "https://open.spotify.com/episode/512bOgnYX20VhCwimnzp61" },
        },
        {
          id: "512bOgnYX20VhCwimnzp62",
          name: "Ep 83: Repurposing Longform Content into 30 Clips",
          description: "Sponsored by Descript. Use code CREATOR for 20% off. Full show notes and transcripts on our website.",
          release_date: d(18),
          duration_ms: 38 * 60 * 1000, // 38 mins longform
          external_urls: { spotify: "https://open.spotify.com/episode/512bOgnYX20VhCwimnzp62" },
        },
        {
          id: "512bOgnYX20VhCwimnzp63",
          name: "Ep 82: Monetization Models for B2B Creators",
          description: "Our membership community is now open at creatorengineer.com/vip. Special thanks to our sponsor.",
          release_date: d(32),
          duration_ms: 51 * 60 * 1000, // 51 mins longform
          external_urls: { spotify: "https://open.spotify.com/episode/512bOgnYX20VhCwimnzp63" },
        },
      ],
    },
  ]
}

function sampleLinkedInProfiles(now: Date): LinkedInProfile[] {
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
  return [
    {
      slug: "david-vance-growth",
      fullName: "David Vance",
      headline: "Growth Advisor to SaaS Founders | Top B2B Creator | Author of Modern GTM",
      summary: "I help B2B tech executives and creators build personal media engines. Offering 1:1 advisory & cohort programs. Business inquiries: david@vancegrowth.com",
      location: "Austin, Texas, United States",
      followersCount: 38400,
      email: "david@vancegrowth.com",
      website: "https://vancegrowth.com",
      posts: [
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-1",
          title: "The B2B Media Engine Framework",
          text: "We are hiring a video editor to repurpose my weekly video essays into high-impact clips. Email david@vancegrowth.com with portfolio.",
          publishedAt: d(3),
          isArticle: false,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-2",
          title: "Why Founders Must Publish Consistent Longform Insights",
          text: "Enroll in my masterclass on executive branding at vancegrowth.com/masterclass",
          publishedAt: d(7),
          isArticle: true,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-3",
          title: "How to Structure Sponsorships for Professional Creator Brands",
          text: "Sponsored by Apollo.io. Here is how we generated $50k in pipeline.",
          publishedAt: d(12),
          isArticle: false,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-4",
          title: "5 Lessons from Building a 40k Executive Audience",
          text: "Read my weekly newsletter edition on Substack.",
          publishedAt: d(15),
          isArticle: false,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-5",
          title: "Content Repurposing: From Longform to 10 Micro-Assets",
          text: "Breakdown of our team workflow and production stages.",
          publishedAt: d(19),
          isArticle: false,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-6",
          title: "The Death of Cold Outbound and Rise of Creator Trust",
          text: "Thoughts on why B2B trust is won through consistent content.",
          publishedAt: d(22),
          isArticle: false,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-7",
          title: "Client Case Study: $120k ARR from LinkedIn Content",
          text: "1:1 coaching applications open for Q1.",
          publishedAt: d(25),
          isArticle: false,
        },
        {
          url: "https://www.linkedin.com/in/david-vance-growth/recent-activity/post-8",
          title: "Video is eating the feed: why text-only creators are struggling",
          text: "Video drives 3x higher comment engagement on LinkedIn.",
          publishedAt: d(28),
          isArticle: false,
        },
      ],
    },
  ]
}
