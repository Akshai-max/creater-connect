// AI-scoring for candidate creators using Claude Haiku 4.5.
// Falls back to heuristic scoring when ANTHROPIC_API_KEY is missing.
// Brand-specific context comes from lib/brand.ts (configurable via env).

import { BRAND_NAME, BRAND_CONTEXT, TARGET_NICHE } from "./brand"

export type AiScore = {
  fitScore: number // 0-10
  fitReasoning: string
  personaMatch: string // "UGC Creator" | "Authority/Expert" | "Long-form Reviewer" | "Notable/Celebrity" | "Other"
  nicheGuess: string | null // a short tag for the creator's primary content category, or null if unclear
  nicheRelevant: boolean
  redFlags: string[]
  suggestedRateBand: string | null
  outreachAngle: string // one-sentence pitch hook
  aiScored: boolean
}

function buildSystemPrompt(): string {
  return `You are a creator-fit scorer for ${BRAND_NAME}.

BRAND CONTEXT
${BRAND_CONTEXT}

PERSONA TYPES THAT FIT
- "UGC Creator" — produces ads/reels for brands; rate $50-500
- "Authority/Expert" — professional or credentialed voice; credibility play
- "Long-form Reviewer" — long-form review/demo content (YouTube etc.)
- "Notable/Celebrity" — notable name whose reach carries weight
- "Other"

RED FLAGS (each adds to red_flags array)
- Recently promoted a direct competitor
- Audience is in the wrong region for shipping / regulatory reasons
- Very low engagement rate (<1% on accounts >10k)
- Bot-like patterns (huge follower jumps, comment-to-like ratio off)
- Past flags from existing notes (rate-sensitive, doesn't deliver, went cold)
- Account dormant (no posts in last 30 days)
- Business/brand account (not an individual creator)

SCORING (0-10)
- 9-10: strong niche fit, right region, healthy ER, persona match, no flags
- 7-8: solid match, minor flags
- 4-6: tangentially related, would need a pitch angle to land
- 1-3: weak fit, not worth outreach
- 0: spam/brand/disqualified

OUTPUT
Return ONLY valid JSON, no preamble, no markdown:
{
  "fit_score": <0-10 float>,
  "fit_reasoning": "<1-2 sentence why this score>",
  "persona_match": "<UGC Creator|Authority/Expert|Long-form Reviewer|Notable/Celebrity|Other>",
  "niche_guess": "<short content-category tag, or null>",
  "niche_relevant": <true|false>,
  "red_flags": [<short strings>],
  "suggested_rate_band": "<$50-$200|$150-$500|$300-$900|Authority/Endorsement|null>",
  "outreach_angle": "<one sentence hook for an outreach email — must reference something specific from THEIR content>"
}`
}

export async function scoreCandidate(c: {
  handle: string
  fullName?: string | null
  followers?: number | null
  engagementRate?: number | null
  bio?: string | null
  location?: string | null
  recentCaptions?: string[]
  externalUrl?: string | null
  source?: string | null
  sourceDetail?: string | null
}): Promise<AiScore> {
  const userPrompt = buildUserPrompt(c)

  // 1. Try Anthropic Claude if key is provided
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

      const result = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: [
          { type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userPrompt }],
      })

      const text = result.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("")
      const jsonText = text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim()
      const parsed = JSON.parse(jsonText)

      return {
        fitScore: clamp(Number(parsed.fit_score), 0, 10),
        fitReasoning: String(parsed.fit_reasoning ?? ""),
        personaMatch: String(parsed.persona_match ?? "Other"),
        nicheGuess: parsed.niche_guess && parsed.niche_guess !== "null" ? String(parsed.niche_guess) : null,
        nicheRelevant: !!parsed.niche_relevant,
        redFlags: Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
        suggestedRateBand: parsed.suggested_rate_band && parsed.suggested_rate_band !== "null" ? String(parsed.suggested_rate_band) : null,
        outreachAngle: String(parsed.outreach_angle ?? ""),
        aiScored: true,
      }
    } catch (e) {
      console.error(`Anthropic scoring failed for ${c.handle}, falling back to router:`, (e as Error).message)
    }
  }

  // 2. Try configured LLM router providers (Groq, Gemini, OpenRouter, Ollama)
  try {
    const { defaultRouter } = await import("@/lib/llm/router")
    const router = defaultRouter()
    const r = await router.call({
      purpose: "ai_scoring",
      subjectRef: c.handle,
      json: true,
      maxTokens: 800,
      messages: [
        { role: "system", content: `${buildSystemPrompt()}\n\nReturn JSON only.` },
        { role: "user", content: userPrompt },
      ],
      parse: (m) => {
        const text = (m.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
        return JSON.parse(text)
      },
    })
    const parsed = r.value
    return {
      fitScore: clamp(Number(parsed.fit_score), 0, 10),
      fitReasoning: String(parsed.fit_reasoning ?? ""),
      personaMatch: String(parsed.persona_match ?? "Other"),
      nicheGuess: parsed.niche_guess && parsed.niche_guess !== "null" ? String(parsed.niche_guess) : null,
      nicheRelevant: !!parsed.niche_relevant,
      redFlags: Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
      suggestedRateBand: parsed.suggested_rate_band && parsed.suggested_rate_band !== "null" ? String(parsed.suggested_rate_band) : null,
      outreachAngle: String(parsed.outreach_angle ?? ""),
      aiScored: true,
    }
  } catch (e) {
    console.error(`AI scoring failed for ${c.handle}, using heuristic:`, (e as Error).message)
    return heuristicScore(c)
  }
}

function buildUserPrompt(c: any): string {
  const parts = [`Score this candidate creator for ${BRAND_NAME}:\n`]
  parts.push(`Handle: ${c.handle}`)
  if (c.fullName) parts.push(`Name: ${c.fullName}`)
  if (c.followers) parts.push(`Followers: ${c.followers.toLocaleString()}`)
  if (c.engagementRate != null) parts.push(`Engagement rate: ${c.engagementRate.toFixed(2)}%`)
  if (c.location) parts.push(`Location: ${c.location}`)
  if (c.bio) parts.push(`Bio: ${c.bio}`)
  if (c.externalUrl) parts.push(`Link in bio: ${c.externalUrl}`)
  if (c.recentCaptions?.length) {
    parts.push(`\nRecent post captions (most recent first):`)
    c.recentCaptions.slice(0, 8).forEach((cap: string, i: number) => {
      parts.push(`  ${i + 1}. "${cap.slice(0, 200).replace(/\n/g, " ")}"`)
    })
  }
  if (c.sourceDetail) parts.push(`\nDiscovery source: ${c.sourceDetail}`)
  return parts.join("\n")
}

function clamp(n: number, min: number, max: number): number {
  if (isNaN(n)) return 0
  return Math.max(min, Math.min(max, n))
}

// Heuristic fallback when no API key. Brand-agnostic: scores on follower tier,
// engagement, whether they self-identify as a creator, and whether their bio
// mentions your target niche (TARGET_NICHE, set via env).
function heuristicScore(c: any): AiScore {
  const flags: string[] = []
  let score = 5
  const bio = (c.bio || "").toLowerCase()
  const text = bio + " " + (c.recentCaptions || []).join(" ").toLowerCase()
  const isUgc = bio.includes("ugc") || bio.includes("content creator")
  const nicheTerms = TARGET_NICHE.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)
  const onNiche = nicheTerms.length > 0 && nicheTerms.some((w) => text.includes(w))

  if (isUgc) score += 1
  if (onNiche) score += 2
  if ((c.followers || 0) < 1000) flags.push("Very small audience")
  if ((c.followers || 0) > 100000) score -= 1
  if (c.engagementRate != null && c.engagementRate < 1) flags.push("Engagement <1%")

  return {
    fitScore: clamp(score, 0, 10),
    fitReasoning: `Heuristic score (no AI key set). ${onNiche ? "On-niche signals in bio/posts. " : ""}${isUgc ? "Self-identified UGC creator." : ""}`.trim(),
    personaMatch: isUgc ? "UGC Creator" : "Other",
    nicheGuess: null,
    nicheRelevant: onNiche,
    redFlags: flags,
    suggestedRateBand:
      (c.followers || 0) < 10000 ? "$50-$200" :
      (c.followers || 0) < 30000 ? "$150-$500" :
      (c.followers || 0) < 100000 ? "$300-$900" : null,
    outreachAngle: `Reach out to ${c.handle?.replace("@", "") ?? "this creator"} about a collab.`,
    aiScored: false,
  }
}
