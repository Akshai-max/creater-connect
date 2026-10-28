// Backup channels from what the creator publishes themselves.
//   - Instagram and LinkedIn links are taken only from the creator's own YouTube
//     text (channel description, video descriptions); each keeps the URL it was
//     found on. No handle is guessed from a name.
//   - Instagram handles are then checked with the official Instagram Graph API
//     "Business Discovery" endpoint, which returns a professional account's public
//     profile and recent posts. It needs your own IG professional account and token.
//   - LinkedIn has no permitted API for this, so a LinkedIn link is recorded but
//     its activity stays unconfirmed until a person checks it.
import { ProviderError } from "./providers"
import type { DiscoveredChannel } from "./discovery"

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>
const defaultFetcher: Fetcher = (u) => fetch(u) as any

export type SocialLink = { value: string; url: string; evidenceUrl: string; quote: string; lastSeen: string | null }

// instagram.com/<handle> but not posts, reels, stories or app pages.
const IG_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?=[\s"'<>)\],?]|$)/gi
const IG_RESERVED = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "developer", "legal", "web"])
const LI_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(in|company)\/([A-Za-z0-9\-_%]{3,100})\/?/gi

const snippet = (text: string, idx: number, len: number) =>
  text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + len + 60)).replace(/\s+/g, " ").trim()

export function extractSocialLinks(ch: DiscoveredChannel): { instagram: SocialLink[]; linkedin: SocialLink[] } {
  const texts = [
    ...(ch.description ? [{ url: `${ch.channelUrl}/about`, text: ch.description, at: null as string | null }] : []),
    ...[...ch.videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((v) => ({ url: v.url, text: v.description, at: v.publishedAt as string | null })),
  ]
  const instagram: SocialLink[] = []
  const linkedin: SocialLink[] = []
  const add = (list: SocialLink[], value: string, url: string, t: { url: string; text: string; at: string | null }, idx: number, len: number) => {
    const prev = list.find((l) => l.value === value)
    if (prev) {
      if (t.at && (!prev.lastSeen || t.at > prev.lastSeen)) prev.lastSeen = t.at
      return
    }
    list.push({ value, url, evidenceUrl: t.url, quote: snippet(t.text, idx, len), lastSeen: t.at })
  }
  for (const t of texts) {
    for (const m of t.text.matchAll(IG_RE)) {
      const handle = m[1].replace(/\.+$/, "").toLowerCase()
      if (!handle || IG_RESERVED.has(handle)) continue
      add(instagram, handle, `https://www.instagram.com/${handle}/`, t, m.index ?? 0, m[0].length)
    }
    for (const m of t.text.matchAll(LI_RE)) {
      const kind = m[1].toLowerCase()
      const slug = m[2]
      add(linkedin, `${kind}/${slug.toLowerCase()}`, `https://www.linkedin.com/${kind}/${slug}/`, t, m.index ?? 0, m[0].length)
    }
  }
  // A personal profile is the creator; a company page is a fallback.
  linkedin.sort((a, b) => Number(b.value.startsWith("in/")) - Number(a.value.startsWith("in/")))
  return { instagram, linkedin }
}

// ── Instagram Graph API: Business Discovery ─────────────────────────────────
export type InstagramProfile = {
  username: string
  name: string | null
  biography: string
  website: string | null
  followers: number | null
  mediaCount: number | null
  posts: { permalink: string; timestamp: string; caption: string }[]
}

export type InstagramLookup = { ok: true; profile: InstagramProfile } | { ok: false; reason: "not_professional_or_missing" | "rate_limited" | "error"; error: string }

export function instagramConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim()
  const igUserId = env.INSTAGRAM_IG_USER_ID?.trim()
  return token && igUserId ? { token, igUserId } : null
}

export async function lookupInstagram(username: string, cfg: { token: string; igUserId: string }, opts: { fetcher?: Fetcher } = {}): Promise<InstagramLookup> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const fields = `business_discovery.username(${username}){username,name,biography,website,followers_count,media_count,media.limit(12){permalink,timestamp,caption}}`
  const url = `https://graph.facebook.com/${encodeURIComponent(cfg.igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(cfg.token)}`
  let res
  try {
    res = await fetcher(url)
  } catch (e) {
    return { ok: false, reason: "error", error: (e as Error).message }
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    const err = body.error ?? {}
    // 4, 17, 32, 613: app/user/page rate limits.
    if ([4, 17, 32, 613].includes(err.code)) return { ok: false, reason: "rate_limited", error: err.message ?? `HTTP ${res.status}` }
    // 190: bad or expired token - every later call fails the same way.
    if (err.code === 190) throw new ProviderError("instagram", `access token invalid or expired: ${err.message ?? ""}`.trim())
    // 110 / 100 with a "user not found"-type subcode: personal account or no such user.
    if (err.code === 110 || err.code === 100 || err.error_subcode === 2207013) return { ok: false, reason: "not_professional_or_missing", error: err.message ?? `HTTP ${res.status}` }
    return { ok: false, reason: "error", error: err.message ?? `HTTP ${res.status}` }
  }
  const bd = body.business_discovery ?? {}
  return {
    ok: true,
    profile: {
      username: bd.username ?? username,
      name: bd.name ?? null,
      biography: bd.biography ?? "",
      website: bd.website ?? null,
      followers: typeof bd.followers_count === "number" ? bd.followers_count : null,
      mediaCount: typeof bd.media_count === "number" ? bd.media_count : null,
      posts: (bd.media?.data ?? []).map((m: any) => ({ permalink: m.permalink ?? "", timestamp: m.timestamp ?? "", caption: m.caption ?? "" })),
    },
  }
}

const BUSINESS_RE = /(business|inquir|enquir|sponsor|collab|partnership|booking|press|media|contact|dm (?:me |us )?for|work with)/i
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

// Research-row columns for the backup channels (engine CSV input format).
export function socialColumns(
  ch: DiscoveredChannel,
  ig: InstagramLookup | null,
): { cols: Record<string, string>; notes: string[]; bioEmail: { value: string; evidenceUrl: string; lastActive: string } | null } {
  const links = extractSocialLinks(ch)
  const cols: Record<string, string> = {
    linkedin_url: "", linkedin_evidence_url: "", linkedin_last_active: "", linkedin_source: "", linkedin_business_use: "",
    instagram_handle: "", instagram_evidence_url: "", instagram_last_active: "", instagram_source: "", instagram_business_use: "",
  }
  const notes: string[] = []
  let bioEmail: { value: string; evidenceUrl: string; lastActive: string } | null = null

  const li = links.linkedin[0]
  if (li) {
    cols.linkedin_url = li.url
    cols.linkedin_evidence_url = li.evidenceUrl
    cols.linkedin_source = "published"
    // Activity and business use can't be read from LinkedIn without scraping: a person confirms them.
    notes.push(`CONFIRM: LinkedIn ${li.url} is active in the last 60 days and open to business messages, then fill linkedin_last_active and linkedin_business_use`)
  }

  const handle = links.instagram[0]
  if (handle) {
    cols.instagram_handle = `@${handle.value}`
    cols.instagram_evidence_url = handle.evidenceUrl
    cols.instagram_source = "published"
    if (ig?.ok) {
      const p = ig.profile
      const latest = p.posts.map((x) => x.timestamp).filter(Boolean).sort().pop()
      if (latest) cols.instagram_last_active = latest.slice(0, 10)
      else notes.push(`CHECK: @${handle.value} has no recent public posts`)
      if (BUSINESS_RE.test(p.biography) || EMAIL_RE.test(p.biography)) cols.instagram_business_use = "yes"
      else notes.push(`CONFIRM: @${handle.value} bio doesn't say it takes business messages`)
      const email = EMAIL_RE.exec(p.biography)?.[0]?.toLowerCase()
      if (email && latest) bioEmail = { value: email, evidenceUrl: `https://www.instagram.com/${p.username}/`, lastActive: latest.slice(0, 10) }
    } else if (ig && !ig.ok) {
      notes.push(ig.reason === "not_professional_or_missing"
        ? `CHECK: @${handle.value} isn't a public professional Instagram account (Business Discovery found nothing)`
        : `CHECK: Instagram lookup for @${handle.value} failed (${ig.reason}): ${ig.error.slice(0, 120)}`)
    } else {
      notes.push(`CONFIRM: Instagram @${handle.value} activity (set INSTAGRAM_ACCESS_TOKEN to check it automatically)`)
    }
  }
  return { cols, notes, bioEmail }
}
