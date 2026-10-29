// Evidence on the lead detail page, summarised per kind instead of one long list:
// a reviewer sees the gist first (counts, newest items) and opens the rest on demand.
// Server component: "Show all" uses <details>, so no client JS.
import { AtSign, Briefcase, Camera, CirclePlay, ExternalLink, Film, Globe, Mail } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import type { leadEvidence } from "@/lib/db/schema"

export type Evidence = typeof leadEvidence.$inferSelect

const NAME: Record<string, string> = { email: "Email", linkedin: "LinkedIn", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X" }
export const nameOf = (s: string | null | undefined) => (s ? NAME[s] ?? s[0].toUpperCase() + s.slice(1) : "—")
// Neutral icons: this lucide version has no brand logos.
const ICON: Record<string, LucideIcon> = { email: Mail, instagram: Camera, linkedin: Briefcase, youtube: CirclePlay }

// Single facts shown side by side as small tiles; the rest as sections, in the order a reviewer reads them.
const FACTS: { kind: string; title: string }[] = [
  { kind: "profile", title: "Profile" },
  { kind: "country", title: "Country" },
  { kind: "monetization", title: "Monetization" },
]
const KINDS: { kind: string; title: string }[] = [
  { kind: "entity", title: "Who runs the channel" },
  { kind: "need", title: "Need" },
  { kind: "contact", title: "Contact routes" },
  { kind: "content", title: "Recent content" },
]
const CONTENT_SHOWN = 5

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "link" } }
const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0)
const DAY = 86_400_000

/** The text itself is the link (with a small icon), so rows don't repeat "youtube.com" in a column. */
function Linked({ url, children, className = "" }: { url: string | null; children: React.ReactNode; className?: string }) {
  if (!url) return <span className={className}>{children} <span className="text-[11px] text-red-600 dark:text-red-400">(no source link)</span></span>
  return (
    <a href={url} target="_blank" rel="noreferrer" title={`Open on ${host(url)}`} className={`group inline-flex min-w-0 max-w-full items-center gap-1 hover:text-zinc-950 hover:underline dark:hover:text-white ${className}`}>
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  )
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source || source === "published") return null
  return <Badge variant="warn" className="px-1.5 py-0 text-[10px]">{source.startsWith("ai:") ? "AI · check it" : source}</Badge>
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h3>
        {aside && <span className="text-[11px] text-zinc-500">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

const List = ({ children }: { children: React.ReactNode }) => (
  <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100 dark:divide-zinc-800/70 dark:border-zinc-800/70">{children}</ul>
)

/** Recent content: a one-line summary, the newest few, the rest behind "Show all". */
function ContentSection({ rows }: { rows: Evidence[] }) {
  const items = [...rows].sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
  const dated = items.filter((e) => e.publishedAt)
  const longform = items.filter((e) => e.isLongform).length
  const newest = dated[0]?.publishedAt ?? null
  const oldest = dated[dated.length - 1]?.publishedAt ?? null
  const spanDays = newest && oldest ? Math.max(1, Math.round((time(newest) - time(oldest)) / DAY)) : null
  // Average gap between uploads, from the dates shown.
  const every = spanDays && dated.length > 1 ? spanDays / (dated.length - 1) : null
  const rhythm = every == null ? null : every <= 1.5 ? "about daily" : every <= 8 ? `every ~${Math.round(every)} days` : `every ~${Math.round(every / 7)} weeks`

  const row = (e: Evidence) => (
    <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
      <Film className={`h-3.5 w-3.5 shrink-0 ${e.isLongform ? "text-sky-500" : "text-zinc-300 dark:text-zinc-700"}`} aria-label={e.isLongform ? "Long-form" : "Short"} />
      <Linked url={e.url} className="flex-1">{e.label ?? "Untitled"}</Linked>
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{e.publishedAt ? formatDate(e.publishedAt) : "—"}</span>
    </li>
  )

  return (
    <Section title="Recent content" aside={newest && oldest ? `${formatDate(oldest)} – ${formatDate(newest)}` : undefined}>
      <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
        <Badge variant="secondary">{items.length} videos</Badge>
        <Badge variant="secondary"><Film className="mr-1 h-3 w-3 text-sky-500" />{longform} long-form ({items.length ? Math.round((longform / items.length) * 100) : 0}%)</Badge>
        {rhythm && <Badge variant="secondary">uploads {rhythm}</Badge>}
      </div>
      <List>{items.slice(0, CONTENT_SHOWN).map(row)}</List>
      {items.length > CONTENT_SHOWN && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Show all {items.length} videos</summary>
          <div className="mt-1.5"><List>{items.slice(CONTENT_SHOWN).map(row)}</List></div>
        </details>
      )}
    </Section>
  )
}

/** Contact routes: one compact line each, icon + value, with where it was found. */
function ContactSection({ rows }: { rows: Evidence[] }) {
  return (
    <Section title="Contact routes">
      <List>
        {rows.map((e) => {
          const Icon = (e.channel && ICON[e.channel]) || (e.value?.includes("@") ? AtSign : Globe)
          return (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <Linked url={e.url}>{e.value ?? e.label ?? "—"}</Linked>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  <span>{nameOf(e.channel)}</span>
                  {e.label && <span>· {e.label}</span>}
                  {e.lastActiveAt && <span>· active {formatDate(e.lastActiveAt)}</span>}
                  {e.url && <span>· found on {host(e.url)}</span>}
                  <SourceBadge source={e.source} />
                </div>
              </div>
            </li>
          )
        })}
      </List>
    </Section>
  )
}

/** Any other kind: the value (or quote) as the link, with its date and source. */
function PlainSection({ kind, title, rows }: { kind: string; title: string; rows: Evidence[] }) {
  return (
    <Section title={title}>
      <List>
        {rows.map((e) => (
          <li key={e.id} className="px-3 py-2 text-sm">
            {/* A need's label is the observation ("your recent long-form videos … have no captions"); its value is the type. */}
            <Linked url={e.url}>{kind === "entity" && e.label ? `“${e.label}”` : kind === "need" ? e.label ?? e.value ?? "—" : e.value ?? e.label ?? "—"}</Linked>
            {(e.publishedAt || (kind === "need" && e.value) || (e.source && e.source !== "published")) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                {kind === "need" && e.value && <Badge variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">{e.value}</Badge>}
                {e.publishedAt && <span>{formatDate(e.publishedAt)}</span>}
                <SourceBadge source={e.source} />
              </div>
            )}
          </li>
        ))}
      </List>
    </Section>
  )
}

/** Profile, country and monetization: one value each, so tiles instead of a section apiece. */
function Facts({ evidence }: { evidence: Evidence[] }) {
  const facts = FACTS.map((f) => ({ ...f, rows: evidence.filter((e) => e.kind === f.kind) })).filter((f) => f.rows.length)
  if (!facts.length) return null
  const text = (kind: string, e: Evidence) =>
    kind === "profile" ? `${nameOf(e.channel ?? "youtube")} channel` : kind === "monetization" ? (e.value ?? e.label ?? "—").replace(/^\w/, (c) => c.toUpperCase()) : e.value ?? e.label ?? "—"
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {facts.map((f) => (
        <div key={f.kind} className="min-w-0 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800/70">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{f.title}</div>
          {f.rows.map((e) => (
            <div key={e.id} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm">
              <Linked url={e.url}>{text(f.kind, e)}</Linked>
              <SourceBadge source={e.source} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function EvidenceSections({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="text-sm text-zinc-500">No evidence stored.</p>
  return (
    <>
      <Facts evidence={evidence} />
      {KINDS.map(({ kind, title }) => {
        const rows = evidence.filter((e) => e.kind === kind)
        if (rows.length === 0) return null
        if (kind === "content") return <ContentSection key={kind} rows={rows} />
        if (kind === "contact") return <ContactSection key={kind} rows={rows} />
        return <PlainSection key={kind} kind={kind} title={title} rows={rows} />
      })}
    </>
  )
}
