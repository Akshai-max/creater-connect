// Business contact from the creator's own website. Most creators publish their business email on
// their own site or link-in-bio page, not on YouTube. This reads only sites the creator links from
// their own channel or video descriptions, and only emails actually published on the page:
//   - robots.txt is honoured (RFC 9309: 4xx = no rules, 5xx/unreachable = stay away);
//   - a few pages per site (home, link page, then up to 3 same-site contact/about pages);
//   - 8 s timeout, 1.5 MB cap, HTML only, redirects followed by hand so each host's robots.txt is read;
//   - no guessed addresses (name@domain), no third-party email finders, no decoding of obfuscated
//     addresses (Cloudflare email protection etc. is the site asking not to be harvested).
// Business use is set only when the text around the email or the page itself is about business,
// sponsorship, bookings or contact. The activity date is the newest video whose description links
// the site: the creator still points viewers there. A site linked only from the channel description
// gets no date, so a person confirms the email is current.
import { isValidEvidenceUrl } from "./normalize"

export type WebResponse = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
export type WebFetcher = (url: string) => Promise<WebResponse>

export const UA_TOKEN = "creator-crm-contact-finder"
const UA = `${UA_TOKEN}/1.0 (looks up published business contacts; respects robots.txt)`
const TIMEOUT_MS = 8_000
const MAX_CHARS = 1_500_000

export const defaultWebFetcher: WebFetcher = (url) =>
  fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain;q=0.9" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) })

// ── URLs ─────────────────────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi

export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?…]+$/, "")
    try { out.push(new URL(u).toString()) } catch { /* not a URL */ }
  }
  return [...new Set(out)]
}

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" } }
const endsWithAny = (h: string, list: string[]) => list.some((d) => h === d || h.endsWith(`.${d}`))

// Platforms, stores and shorteners: not the creator's own site (social profiles are handled elsewhere).
const SKIP_HOSTS = [
  "youtube.com", "youtu.be", "instagram.com", "facebook.com", "fb.com", "fb.me", "twitter.com", "x.com", "tiktok.com",
  "linkedin.com", "threads.net", "pinterest.com", "reddit.com", "snapchat.com", "twitch.tv", "discord.gg", "discord.com",
  "t.me", "telegram.me", "wa.me", "whatsapp.com", "spotify.com", "apple.com", "podcasts.apple.com", "music.apple.com",
  "amazon.com", "amzn.to", "amzn.eu", "a.co", "ebay.com", "etsy.com", "patreon.com", "ko-fi.com", "buymeacoffee.com",
  "paypal.com", "paypal.me", "venmo.com", "cash.app", "gofundme.com", "google.com", "goo.gl", "g.co", "forms.gle",
  "bit.ly", "tinyurl.com", "ow.ly", "rebrand.ly", "geni.us", "shorturl.at", "cutt.ly", "is.gd", "lnk.to", "found.ee",
  "audible.com", "skillshare.com", "nordvpn.com", "squarespace.com", "wix.com", "shopify.com", "medium.com", "substack.com",
  "github.com", "gumroad.com", "calendly.com", "zoom.us", "eventbrite.com", "imdb.com", "wikipedia.org", "soundcloud.com",
]
// Link-in-bio pages: one creator's page of links, often with an email or a link to their own site.
const LINK_PAGE_HOSTS = ["linktr.ee", "beacons.ai", "stan.store", "linkin.bio", "bio.link", "campsite.bio", "carrd.co", "hoo.be", "msha.ke", "taplink.cc", "snipfeed.co", "koji.to", "allmylinks.com", "lnk.bio", "solo.to"]

export type SiteKind = "skip" | "linkpage" | "site"
export function classifyUrl(u: string): SiteKind {
  const h = host(u)
  if (!h || /\.(pdf|jpe?g|png|gif|mp3|mp4|zip)(\?|$)/i.test(u)) return "skip"
  if (endsWithAny(h, LINK_PAGE_HOSTS)) return "linkpage"
  if (endsWithAny(h, SKIP_HOSTS)) return "skip"
  return "site"
}

// ── robots.txt ───────────────────────────────────────────────────────────────
type Rule = { allow: boolean; path: string }

/** Rules for our user agent (its own group, else "*"). Longest match wins; Allow wins a tie. */
export function parseRobots(txt: string, agent = UA_TOKEN): (path: string) => boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let cur: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase(), val = m[2].trim()
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur) }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val })
    }
  }
  const a = agent.toLowerCase()
  const mine = groups.filter((g) => g.agents.some((x) => x !== "*" && a.startsWith(x)))
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules).filter((r) => r.path !== "")
  const toRe = (p: string) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"))
  return (path: string) => {
    let best: Rule | null = null
    for (const r of rules) {
      if (!toRe(r.path).test(path)) continue
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r
    }
    return best ? best.allow : true
  }
}

// ── HTML ─────────────────────────────────────────────────────────────────────
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", commat: "@", period: "." }
const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)

export function visibleText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|section|footer|header|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim()
}

type Link = { href: string; text: string }
export function links(html: string, base: string): Link[] {
  const out: Link[] = []
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeEntities(m[1].trim())
    const text = visibleText(m[2]).slice(0, 120)
    if (/^mailto:/i.test(raw)) { out.push({ href: raw, text }); continue }
    try { out.push({ href: new URL(raw, base).toString(), text }) } catch { /* bad href */ }
  }
  return out
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g
export const BUSINESS_RE = /(business|inquir|enquir|sponsor|collab|partner|booking|bookings|press|media kit|brand deal|work with (me|us)|contact)/i
const BUSINESS_PATH_RE = /(contact|business|sponsor|partner|collab|press|media|booking|work-with|workwith|advertis|brand)/i
const JUNK_EMAIL_RE = /(^(no-?reply|donotreply|mailer-daemon|postmaster|abuse|privacy|legal|dmca|copyright|webmaster|wordpress|admin)@)|@(example\.(com|org)|domain\.com|email\.com|sentry\.io|.*sentry.*|wixpress\.com|wix\.com|squarespace\.com|shopify\.com|godaddy\.com|linktr\.ee|beacons\.ai|stan\.store|mysite\.com|yourdomain\.com|company\.com)$|\.(png|jpe?g|gif|webp|svg|css|js)$/i

// The line an email sits on, plus the line before when it's bare ("Business enquiries:" / "team@…").
// Wider windows would mark a fan-mail address as business because a sponsorship line sits above it.
function around(text: string, i: number, len: number): string {
  const start = text.lastIndexOf("\n", i - 1) + 1
  const endAt = text.indexOf("\n", i + len)
  const line = text.slice(start, endAt < 0 ? text.length : endAt)
  // A line with no label of its own ("team@x.com", "Email: team@x.com") borrows the line above.
  if (/[A-Za-z]{3}/.test(line.replace(/\S+@\S+/g, "").replace(/\b(e-?mail|mail)\b/gi, "")) || start === 0) return line
  const prevStart = text.lastIndexOf("\n", start - 2) + 1
  return text.slice(prevStart, start) + line
}

export type PageEmail = { email: string; quote: string; businessUse: boolean; mailto: boolean }

/** Emails published on one page: mailto links and addresses in the visible text. */
export function pageEmails(html: string, pageUrl: string): PageEmail[] {
  const text = visibleText(html)
  const pathBusiness = BUSINESS_PATH_RE.test(new URL(pageUrl).pathname)
  const found = new Map<string, PageEmail>()
  const add = (email: string, around: string, mailto: boolean) => {
    const e = email.toLowerCase().replace(/^mailto:/, "").replace(/[.,;]+$/, "")
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e) || JUNK_EMAIL_RE.test(e)) return
    // A platform's own address (pr@patreon.com, help@linktr.ee) is never the creator's.
    const domain = e.split("@")[1]
    if (endsWithAny(domain, SKIP_HOSTS) || endsWithAny(domain, LINK_PAGE_HOSTS)) return
    const quote = around.replace(/\s+/g, " ").trim().slice(0, 200)
    const businessUse = BUSINESS_RE.test(around) || pathBusiness
    const prev = found.get(e)
    if (!prev || (businessUse && !prev.businessUse)) found.set(e, { email: e, quote, businessUse, mailto: mailto || !!prev?.mailto })
  }
  for (const m of text.matchAll(EMAIL_RE)) add(m[0], around(text, m.index ?? 0, m[0].length), false)
  for (const l of links(html, pageUrl)) {
    if (!/^mailto:/i.test(l.href)) continue
    const addr = decodeURIComponent(l.href.slice(7).split("?")[0])
    const i = l.text ? text.indexOf(l.text) : -1
    add(addr, i >= 0 ? around(text, i, l.text.length) : `${l.text} ${addr}`, true)
  }
  return [...found.values()]
}

/** Same-site pages likely to hold a contact address, best first. */
export function contactPageLinks(html: string, pageUrl: string, max = 3): string[] {
  const h = host(pageUrl)
  const scored = links(html, pageUrl)
    .filter((l) => /^https?:/i.test(l.href) && host(l.href) === h)
    .map((l) => {
      const p = new URL(l.href).pathname
      const s = (BUSINESS_PATH_RE.test(p) || BUSINESS_RE.test(l.text) ? 2 : 0) + (/about/i.test(p) || /about/i.test(l.text) ? 1 : 0)
      return { url: l.href.split("#")[0], s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  return [...new Set(scored.map((x) => x.url))].filter((u) => u !== pageUrl.split("#")[0]).slice(0, max)
}

// ── Crawl ────────────────────────────────────────────────────────────────────
export type VideoText = { url: string; description: string; publishedAt: string }
export type WebsiteContact = {
  email: string; pageUrl: string; quote: string; businessUse: boolean
  siteUrl: string; lastActive: string | null // newest video linking the site
}
export type FinderResult = { contact: WebsiteContact | null; pages: number; sites: string[]; reason: string }

export class Crawler {
  private robots = new Map<string, ((p: string) => boolean) | null>()
  private lastHit = new Map<string, number>()
  pages = 0
  constructor(private fetcher: WebFetcher = defaultWebFetcher, private delayMs = 1000, private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}

  private async allowed(u: URL): Promise<boolean> {
    if (!this.robots.has(u.origin)) {
      let rule: ((p: string) => boolean) | null
      try {
        let r = await this.fetcher(`${u.origin}/robots.txt`)
        // Follow a couple of redirects (http → https, bare → www), as RFC 9309 asks.
        for (let hop = 0; hop < 3 && r.status >= 300 && r.status < 400 && r.headers.get("location"); hop++) {
          r = await this.fetcher(new URL(r.headers.get("location")!, `${u.origin}/robots.txt`).toString())
        }
        rule = r.status >= 200 && r.status < 300 ? parseRobots((await r.text()).slice(0, 500_000))
          : r.status >= 300 && r.status < 500 ? () => true // 4xx (or endless redirects): no robots.txt, crawl allowed
          : null // 5xx: treat as disallowed
      } catch { rule = null }
      this.robots.set(u.origin, rule)
    }
    const rule = this.robots.get(u.origin)
    return !!rule && rule(u.pathname + u.search)
  }

  /** GETs an HTML page, following up to 3 redirects (each checked against its host's robots.txt). */
  async get(url: string): Promise<{ url: string; html: string } | { blocked: string }> {
    let u = new URL(url)
    for (let hop = 0; hop < 4; hop++) {
      if (!/^https?:$/.test(u.protocol)) return { blocked: "not http" }
      // A redirect onto a platform (Patreon, Amazon…) leaves the creator's site: its emails are the platform's.
      if (hop > 0 && classifyUrl(u.toString()) === "skip") return { blocked: `redirects to ${u.host}` }
      if (!(await this.allowed(u))) return { blocked: `robots.txt disallows ${u.host}${u.pathname}` }
      const wait = (this.lastHit.get(u.host) ?? 0) + this.delayMs - Date.now()
      if (wait > 0) await this.sleep(wait)
      this.lastHit.set(u.host, Date.now())
      this.pages++
      const r = await this.fetcher(u.toString())
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location")
        if (!loc) return { blocked: `HTTP ${r.status} without location` }
        u = new URL(loc, u)
        continue
      }
      if (r.status !== 200) return { blocked: `HTTP ${r.status}` }
      const type = r.headers.get("content-type") ?? ""
      if (type && !/html|text\/plain/i.test(type)) return { blocked: `not HTML (${type})` }
      return { url: u.toString(), html: (await r.text()).slice(0, MAX_CHARS) }
    }
    return { blocked: "too many redirects" }
  }
}

// Words too generic to tie a domain to a creator ("Gym Business Coach" vs "businesscoach.com").
const GENERIC = new Set(["podcast", "podcasts", "show", "channel", "official", "media", "with", "your", "the", "and", "business", "coach", "coaching", "life", "life", "daily", "network", "studio", "studios", "radio", "talk", "talks", "news", "online", "academy", "group", "global", "world", "real", "live", "tube", "creator", "creators"])
/** True when the site's domain contains a distinctive word of the creator's name (4+ letters). */
export function nameInHost(name: string, url: string): boolean {
  const h = host(url).replace(/[^a-z0-9]/g, "")
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).some((w) => w.length >= 4 && !GENERIC.has(w) && h.includes(w))
}

const sameSite = (a: string, b: string) => { const x = host(a), y = host(b); return !!x && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)) }
const emailDomainMatches = (email: string, site: string) => { const d = email.split("@")[1] ?? ""; const h = host(site); return !!d && (h === d || h.endsWith(`.${d}`)) }

function rank<T extends PageEmail & { siteUrl: string }>(found: T[]): T | null {
  return found.sort((a, b) =>
    Number(b.businessUse) - Number(a.businessUse) || Number(emailDomainMatches(b.email, b.siteUrl)) - Number(emailDomainMatches(a.email, a.siteUrl)) || Number(b.mailto) - Number(a.mailto))[0] ?? null
}

/**
 * Looks for a published business email on the sites a creator links. `channelDescription` and
 * `videos` are the creator's own text; only URLs found there are visited (plus same-site contact
 * pages, and sites a link-in-bio page links to).
 */
export async function findWebsiteContact(opts: {
  channelDescription: string; videos: VideoText[]; crawler: Crawler; creatorName?: string; maxSites?: number; maxPagesPerSite?: number
}): Promise<FinderResult> {
  const { crawler } = opts
  const maxSites = opts.maxSites ?? 3
  const perSite = opts.maxPagesPerSite ?? 4
  const sources = [{ text: opts.channelDescription, at: null as string | null, channel: true }, ...opts.videos.map((v) => ({ text: v.description, at: v.publishedAt, channel: false }))]
  // Each site's newest linking video: how recently the creator pointed viewers there.
  const linked = new Map<string, { url: string; kind: SiteKind; lastActive: string | null; count: number; fromChannel: boolean }>()
  for (const s of sources) for (const u of extractUrls(s.text)) {
    const kind = classifyUrl(u)
    if (kind === "skip") continue
    const h = host(u)
    const prev = linked.get(h)
    const lastActive = [prev?.lastActive, s.at].filter(Boolean).sort().pop() ?? null
    linked.set(h, { url: prev?.url ?? u, kind, lastActive, count: (prev?.count ?? 0) + 1, fromChannel: !!prev?.fromChannel || s.channel })
  }
  // Video descriptions also link sponsors and guests. A site counts as the creator's own when the
  // channel description links it, it's a link page, or its domain carries the creator's name.
  const own = (e: { url: string; kind: SiteKind; fromChannel: boolean }) => e.kind === "linkpage" || e.fromChannel || nameInHost(opts.creatorName ?? "", e.url)
  // Link pages first (they usually list the email or the site), then the most-linked sites.
  const queue = [...linked.values()].filter(own).sort((a, b) => Number(b.kind === "linkpage") - Number(a.kind === "linkpage") || Number(b.fromChannel) - Number(a.fromChannel) || b.count - a.count)
  if (!queue.length) return { contact: null, pages: 0, sites: [], reason: linked.size ? "only other people's sites (sponsors, guests) linked in video descriptions" : "no website or link page in the channel or video descriptions" }

  const found: (PageEmail & { pageUrl: string; siteUrl: string; lastActive: string | null })[] = []
  const visited: string[] = []
  const blocked: string[] = []
  for (let i = 0; i < queue.length && visited.length < maxSites; i++) {
    const site = queue[i]
    visited.push(site.url)
    let first: Awaited<ReturnType<Crawler["get"]>>
    try { first = await crawler.get(site.url) } catch (e) { blocked.push(`${host(site.url)}: ${(e as Error).message.slice(0, 60)}`); continue }
    if ("blocked" in first) { blocked.push(`${host(site.url)}: ${first.blocked}`); continue }
    const pages = [first]
    for (const next of contactPageLinks(first.html, first.url, perSite - 1)) {
      try { const p = await crawler.get(next); if (!("blocked" in p)) pages.push(p) } catch { /* skip page */ }
    }
    for (const p of pages) for (const e of pageEmails(p.html, p.url)) found.push({ ...e, pageUrl: p.url, siteUrl: site.url, lastActive: site.lastActive })
    // A link page can point to the creator's own site: visit it next (it inherits the link date).
    if (site.kind === "linkpage") {
      for (const l of links(first.html, first.url)) {
        if (!/^https?:/i.test(l.href) || classifyUrl(l.href) !== "site" || sameSite(l.href, first.url) || linked.has(host(l.href))) continue
        // A link page lists shops and sponsors too: follow only the creator's own site.
        if (!/(website|my site|official|contact|work with|business|booking)/i.test(l.text) && !nameInHost(opts.creatorName ?? "", l.href)) continue
        const entry = { url: l.href, kind: "site" as SiteKind, lastActive: site.lastActive, count: 0, fromChannel: false }
        linked.set(host(l.href), entry)
        queue.splice(i + 1, 0, entry)
        break
      }
    }
    if (found.some((f) => f.businessUse)) break
  }
  const best = rank(found)
  if (!best) return { contact: null, pages: crawler.pages, sites: visited, reason: blocked.length ? `no email found; ${blocked.join("; ")}` : "no email published on the linked sites" }
  if (!isValidEvidenceUrl(best.pageUrl)) return { contact: null, pages: crawler.pages, sites: visited, reason: "evidence URL invalid" }
  const contact: WebsiteContact = { email: best.email, pageUrl: best.pageUrl, quote: best.quote, businessUse: best.businessUse, siteUrl: best.siteUrl, lastActive: best.lastActive }
  return { contact, pages: crawler.pages, sites: visited, reason: best.businessUse ? "business email published on the creator's site" : "email published, but not marked for business" }
}

/** Fills a research row's email from the creator's site, only if the row has none (same columns as
 *  the podcast-feed email in cycle-discovery.ts). Returns false when the row already has an email. */
export function applyWebsiteContact(row: Record<string, unknown>, c: WebsiteContact): boolean {
  if (String(row.email ?? "").trim()) return false
  row.email = c.email
  row.email_evidence_url = c.pageUrl
  row.email_last_active = c.lastActive?.slice(0, 10) ?? ""
  row.email_source = "published"
  row.email_business_use = c.businessUse ? "yes" : ""
  row.email_quote = c.quote
  const notes = String(row.review_notes ?? "").replace("FIND: published business contact", "").replace(/^;\s*|;\s*;/g, "").trim()
  const check = [
    `CHECK: email ${c.email} is from the creator's site (${c.pageUrl})`,
    c.businessUse ? "" : "CONFIRM: the page doesn't say this email is for business; fill email_business_use if it is",
    c.lastActive ? "" : "CONFIRM: the site is linked only from the channel description; fill email_last_active once you've checked it's current",
  ].filter(Boolean).join("; ")
  row.review_notes = [notes, check].filter(Boolean).join("; ")
  return true
}
