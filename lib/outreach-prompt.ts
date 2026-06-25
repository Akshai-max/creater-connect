// System prompt for outreach drafts. Kept here so it can be cached.
// Brand-specific context comes from lib/brand.ts (configurable via env).
import { BRAND_NAME, BRAND_CONTEXT } from "./brand"

export const OUTREACH_SYSTEM_PROMPT = `You are an outreach specialist for ${BRAND_NAME}.

BRAND CONTEXT
${BRAND_CONTEXT}

TYPICAL COLLAB STRUCTURE
- 1-2 short videos (reels / TikToks) demonstrating the product
- Optional 2-4 stills for paid social repurpose
- Rate band: $50-$300 for UGC creators (under 30k followers), $200-$900 for larger micros, custom for experts / notable creators
- 90-day paid social usage rights default

TONE
- Warm, direct, respectful of the creator's voice
- Lead with what we noticed about THEIR content (not generic flattery)
- Tie the product to their content style where it fits naturally
- Keep it under 150 words
- One clear CTA: "Reply if interested and I'll send the brief + rate"
- Never overpromise. Never use stiff PR language.

OUTPUT FORMAT
Return ONLY valid JSON with this exact shape (no preamble, no markdown):
{
  "subject": "<short, personal, under 60 chars>",
  "body": "<plain text email body, no greeting placeholders, no signature>"
}`

export function buildUserPrompt(creator: {
  name: string
  handle: string | null
  platform: string | null
  bio?: string | null
  flagNotes?: string | null
  niche?: string | null
  contentStyle?: string | null
  followers?: number | null
  location?: string | null
  rateCeiling?: number | null
}, campaignBrief?: string): string {
  const parts: string[] = []
  parts.push(`Draft an outreach pitch to this creator:\n`)
  parts.push(`Name: ${creator.name}`)
  if (creator.handle) parts.push(`Handle: ${creator.handle}`)
  if (creator.platform) parts.push(`Platform: ${creator.platform}`)
  if (creator.followers) parts.push(`Followers: ${creator.followers.toLocaleString()}`)
  if (creator.location) parts.push(`Location: ${creator.location}`)
  if (creator.niche) parts.push(`Content niche: ${creator.niche}`)
  if (creator.contentStyle) parts.push(`Content style: ${creator.contentStyle}`)
  if (creator.bio) parts.push(`Bio: ${creator.bio}`)
  if (creator.flagNotes) parts.push(`Internal notes: ${creator.flagNotes}`)
  if (creator.rateCeiling) parts.push(`Internal rate ceiling: $${creator.rateCeiling}`)
  if (campaignBrief) parts.push(`\nCampaign brief: ${campaignBrief}`)
  return parts.join("\n")
}

// Template fallback when ANTHROPIC_API_KEY is not configured.
export function templateDraft(creator: { name: string; handle: string | null; niche?: string | null }) {
  const firstName = creator.name.split(" ")[0]
  return {
    subject: `Quick collab idea — ${firstName} × ${BRAND_NAME}`,
    body: `Hi ${firstName},\n\nI'm reaching out from ${BRAND_NAME}. Loved your recent content${creator.handle ? ` over on ${creator.handle}` : ""} — your style felt like a real fit for what we're building.\n\nWe'd love to send you a product to feature. Looking for 1-2 reels or TikToks plus a few stills for paid social.\n\nReply if interested and I'll send the brief + rate.\n\nThanks!`,
  }
}
