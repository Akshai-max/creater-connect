// Normalization, identity and input parsing. Pure functions only.
import { createHash } from "node:crypto"
import {
  PLATFORMS,
  OUTREACH_CHANNELS,
  type ContactRoute,
  type ContentItem,
  type LeadInput,
  type OutreachChannel,
  type Platform,
} from "./types"

const DAY_MS = 86_400_000

// ── URLs ─────────────────────────────────────────────────────────────────────

export function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw || typeof raw !== "string") return null
  const s = raw.trim()
  if (!/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    if (!u.hostname.includes(".")) return null
    return u
  } catch {
    return null
  }
}

export function isValidEvidenceUrl(raw: string | null | undefined): boolean {
  return parseHttpUrl(raw) !== null
}

// Lowercase host, drop www./m., force https, drop query/hash/trailing slash.
// YouTube video URLs keep their ?v= since it's the identity of the video.
export function canonicalUrl(raw: string): string | null {
  const u = parseHttpUrl(raw)
  if (!u) return null
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "")
  let path = u.pathname.replace(/\/+$/, "")
  if (host !== "youtube.com" || !path.startsWith("/watch")) {
    path = path.toLowerCase()
    return `https://${host}${path}`
  }
  const v = u.searchParams.get("v")
  return `https://${host}${path}${v ? `?v=${v}` : ""}`
}

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  youtube: ["youtube.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  apple_podcasts: ["podcasts.apple.com"],
  spotify: ["open.spotify.com"],
  linkedin: ["linkedin.com"],
  x: ["x.com", "twitter.com"],
}

const STABLE_ID_PATTERNS: Record<Platform, RegExp> = {
  youtube: /^UC[A-Za-z0-9_-]{22}$/, // channel id, not @handle
  instagram: /^\d{3,20}$/, // numeric user id
  tiktok: /^\d{5,25}$/,
  apple_podcasts: /^\d{5,15}$/,
  spotify: /^[A-Za-z0-9]{22}$/,
  linkedin: /^[A-Za-z0-9-]{3,100}$/,
  x: /^\d{1,20}$/,
}

export function normalizePlatform(raw: string | null | undefined): Platform | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  const alias: Record<string, Platform> = { yt: "youtube", ig: "instagram", apple: "apple_podcasts", twitter: "x" }
  const p = (alias[s] ?? s) as Platform
  return (PLATFORMS as readonly string[]).includes(p) ? p : null
}

export function profileUrlMatchesPlatform(url: string, platform: Platform): boolean {
  const u = parseHttpUrl(url)
  if (!u) return false
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "")
  return PLATFORM_HOSTS[platform].some((h) => host === h || host.endsWith(`.${h}`))
}

export function isValidStableId(id: string | null | undefined, platform: Platform): boolean {
  return !!id && STABLE_ID_PATTERNS[platform].test(id.trim())
}

// ── Identity ─────────────────────────────────────────────────────────────────

export function identityKey(platform: string, stableId: string): string {
  return `${platform.trim().toLowerCase()}:${stableId.trim()}`
}

// Deterministic id so the same creator always maps to the same lead_id.
export function leadIdFor(key: string): string {
  return `L-${createHash("sha1").update(key).digest("hex").slice(0, 10).toUpperCase()}`
}

export function hashInput(input: LeadInput): string {
  // checkedDate excluded: re-verifying unchanged evidence shouldn't count as an "update"
  const { checkedDate: _ignored, ...rest } = input
  return createHash("sha1").update(stableStringify(rest)).digest("hex")
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`).join(",")}}`
  }
  return JSON.stringify(v ?? null)
}

// ── Dates ────────────────────────────────────────────────────────────────────

export function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const s = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s)
  return isNaN(d.getTime()) ? null : d
}

// Whole-or-fractional days between d and now. Negative = in the future.
export function ageDays(d: Date, now: Date): number {
  return (now.getTime() - d.getTime()) / DAY_MS
}

// Inclusive window: an item exactly `days` old still counts. Future-dated items never count.
export function withinDays(raw: string | null | undefined, days: number, now: Date): boolean {
  const d = parseDate(raw)
  if (!d) return false
  const age = ageDays(d, now)
  return age >= 0 && age <= days
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Contacts ─────────────────────────────────────────────────────────────────

export function isValidContactValue(channel: OutreachChannel, value: string): boolean {
  const v = value.trim()
  if (channel === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
  if (channel === "instagram") return /^@?[A-Za-z0-9._]{1,30}$/.test(v)
  if (channel === "linkedin") {
    const u = parseHttpUrl(v)
    return !!u && /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/(in|company)\/[^/]+/i.test(u.pathname)
  }
  return false
}

// ── Input parsing ────────────────────────────────────────────────────────────

export type ParseResult = { ok: true; input: LeadInput } | { ok: false; error: string }

const str = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s === "" || s === "-" ? null : s
}
const bool = (v: unknown): boolean => /^(y|yes|true|1)$/i.test(String(v ?? "").trim())
const int = (v: unknown): number | null => {
  const s = str(v)
  if (!s) return null
  const n = Number(s.replace(/[,\s]/g, ""))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

function parseContentItems(raw: unknown): ContentItem[] | string {
  if (raw == null || raw === "") return []
  let arr: unknown
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch {
    return "content_items is not valid JSON"
  }
  if (!Array.isArray(arr)) return "content_items must be a JSON array"
  const items: ContentItem[] = []
  for (const it of arr) {
    if (!it || typeof it !== "object") return "content_items entries must be objects"
    const o = it as Record<string, unknown>
    items.push({
      url: str(o.url) ?? "",
      title: str(o.title) ?? "",
      publishedAt: str(o.publishedAt ?? o.published_at) ?? "",
      isLongform: o.isLongform === true || o.longform === true || bool(o.isLongform ?? o.longform),
    })
  }
  return items
}

// Accepts one row from the CSV input format (see README › CSV input format)
// or one object from a JSON input file (already LeadInput-shaped).
export function parseLeadRow(row: Record<string, unknown>, source: string): ParseResult {
  if (Array.isArray((row as any).contacts) && Array.isArray((row as any).contentItems)) {
    return validateShape(row as unknown as LeadInput)
  }
  const content = parseContentItems(row.content_items)
  if (typeof content === "string") return { ok: false, error: content }

  const contacts: ContactRoute[] = []
  for (const ch of OUTREACH_CHANNELS) {
    const col = ch === "email" ? "email" : ch === "linkedin" ? "linkedin_url" : "instagram_handle"
    const value = str(row[col])
    if (!value) continue
    contacts.push({
      channel: ch,
      value,
      evidenceUrl: str(row[`${ch}_evidence_url`]),
      lastActiveAt: str(row[`${ch}_last_active`]),
      source: (str(row[`${ch}_source`]) ?? str(row.contact_source) ?? "published").toLowerCase(),
      businessUse: bool(row[`${ch}_business_use`]),
      responseEvidenceUrl: str(row[`${ch}_response_evidence_url`]),
    })
  }

  return validateShape({
    creatorName: str(row.creator_name) ?? "",
    segment: (str(row.creator_segment) ?? "").toLowerCase(),
    entityType: (str(row.entity_type) ?? "individual").toLowerCase(),
    countryIso2: str(row.country_iso2)?.toUpperCase() ?? null,
    countryEvidenceUrl: str(row.country_evidence_url),
    primaryLanguage: str(row.primary_language)?.toLowerCase() ?? null,
    primaryPlatform: (str(row.primary_platform) ?? "").toLowerCase(),
    profileUrl: str(row.profile_url) ?? "",
    stableCreatorId: str(row.stable_creator_id) ?? "",
    followers: int(row.followers_or_subscribers),
    contentItems: content,
    monetizationSignal: str(row.monetization_signal)?.toLowerCase() ?? null,
    monetizationEvidenceUrl: str(row.monetization_evidence_url),
    need: str(row.incubrix_need)?.toLowerCase() ?? null,
    needSignalText: str(row.need_signal_text),
    needEvidenceUrl: str(row.need_evidence_url),
    contacts,
    checkedDate: str(row.checked_date),
    source: str(row.source) ?? source,
    sourceRef: str(row.source_ref),
  })
}

// Structural validation only: rows that can't even be identified fail here.
// Evidence gaps are NOT errors — they flow through to qualification as unverified.
function validateShape(input: LeadInput): ParseResult {
  if (!input.creatorName) return { ok: false, error: "creator_name is required" }
  const platform = normalizePlatform(input.primaryPlatform)
  if (!platform) return { ok: false, error: `unknown primary_platform "${input.primaryPlatform}"` }
  if (!input.stableCreatorId) return { ok: false, error: "stable_creator_id is required" }
  if (!input.profileUrl || !canonicalUrl(input.profileUrl)) return { ok: false, error: "profile_url must be an http(s) URL" }
  return {
    ok: true,
    input: {
      ...input,
      primaryPlatform: platform,
      primaryLanguage: input.primaryLanguage ? input.primaryLanguage.split(/[-_]/)[0] : null,
      contentItems: input.contentItems ?? [],
      contacts: input.contacts ?? [],
    },
  }
}
