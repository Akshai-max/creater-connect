import { db } from "@/lib/db"
import { leadEvidence, leads } from "@/lib/db/schema"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import Link from "next/link"
import { ChevronLeft, ExternalLink, UserCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatNumber } from "@/lib/utils"
import { channelDescriptions } from "@/lib/leads/descriptions"
import { aboutUrl } from "@/lib/leads/entity-reviews"
import { ReviewButtons } from "./review-buttons"

export const dynamic = "force-dynamic"

const PAGE = 12
const LANG: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", hi: "Hindi" }

// Checks still failing, ignoring the two that only follow from the others (complete, message).
const missing = (checks: string | null) =>
  (JSON.parse(checks ?? "[]") as { id: string; pass: boolean }[]).filter((c) => !c.pass && c.id !== "complete" && c.id !== "message").map((c) => c.id)

export default async function EntityReview({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: m } = await searchParams
  const mode = m === "both" ? "both" : "entity"

  // Unverified leads whose entity check fails; the rest of the filtering is on the parsed checks.
  const rows = await db.select({
    id: leads.id, name: leads.creatorName, profileUrl: leads.profileUrl, followers: leads.followers, country: leads.countryIso2,
    language: leads.primaryLanguage, score: leads.leadScore, uploads: leads.contentCount30d, longform: leads.longformCount60d,
    identityKey: leads.identityKey, checks: leads.qualificationChecks,
  }).from(leads)
    .where(and(eq(leads.isFixture, false), eq(leads.candidateStatus, "unverified"), sql`${leads.qualificationChecks}::jsonb @> '[{"id":"entity","pass":false}]'::jsonb`))
    .orderBy(desc(leads.leadScore))

  const entityOnly = rows.filter((r) => { const x = missing(r.checks); return x.length === 1 && x[0] === "entity" })
  const withContact = rows.filter((r) => { const x = missing(r.checks); return x.includes("entity") && x.includes("contact") && x.every((id) => id === "entity" || id === "contact") })
  const list = (mode === "entity" ? entityOnly : withContact).slice(0, PAGE)

  const ids = list.map((r) => r.id)
  const [content, descriptions] = await Promise.all([
    ids.length ? db.select({ leadId: leadEvidence.leadId, title: leadEvidence.label, url: leadEvidence.url, at: leadEvidence.publishedAt })
      .from(leadEvidence).where(and(inArray(leadEvidence.leadId, ids), eq(leadEvidence.kind, "content"))) : Promise.resolve([]),
    channelDescriptions(),
  ])
  const videosOf = (id: string) => content.filter((c) => c.leadId === id).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 4)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <div>
        <Link href="/leads" className="mb-4 inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ChevronLeft className="mr-1 h-3 w-3" /> Back to leads
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><UserCheck className="h-6 w-6" /> Confirm creators</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          The AI only confirms a channel when its own text says one person runs it, and most don&apos;t say so. Look at each channel and decide.
          Your decision is saved and kept by every engine run.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        {([["entity", `Only this is missing (${entityOnly.length})`, "each one you confirm qualifies"], ["both", `Also missing a contact (${withContact.length})`, "qualifies once a contact is found"]] as const).map(([k, label, hint]) => (
          <Link key={k} href={k === "entity" ? "/leads/review" : "/leads/review?mode=both"} title={hint}
            className={`rounded-md px-3 py-1.5 font-medium ${mode === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"}`}>
            {label}
          </Link>
        ))}
      </div>

      {list.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-zinc-500">Nothing to review here. New channels show up as the engine finds them.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {list.map((r) => {
            const channelId = String(r.identityKey).replace(/^youtube:/, "")
            const desc = descriptions.get(channelId)
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/leads/${r.id}`} className="text-base font-semibold hover:underline">{r.name}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                        <span>{formatNumber(r.followers)} subscribers</span>
                        <span>{r.country ?? "—"} · {r.language ? LANG[r.language] ?? r.language : "—"}</span>
                        <span>{r.uploads ?? 0} uploads / 30 days · {r.longform ?? 0} long-form / 60 days</span>
                        <span>score {Math.round(r.score ?? 0)}</span>
                      </div>
                    </div>
                    <a href={r.profileUrl ? aboutUrl(r.profileUrl) : `https://www.youtube.com/channel/${channelId}/about`} target="_blank" rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                      Open channel <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="max-h-40 overflow-y-auto whitespace-pre-line rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {desc?.trim() || <span className="text-zinc-400">No channel description. Open the channel to decide.</span>}
                  </div>
                  {videosOf(r.id).length > 0 && (
                    <ul className="space-y-0.5 text-xs text-zinc-500">
                      {videosOf(r.id).map((v) => (
                        <li key={v.url ?? v.title} className="truncate">
                          <span className="tabular-nums">{v.at ? formatDate(v.at) : ""}</span> · {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="hover:underline">{v.title}</a> : v.title}
                        </li>
                      ))}
                    </ul>
                  )}
                  {mode === "both" && <Badge variant="warn">Also needs a business contact before it can qualify</Badge>}
                  <ReviewButtons leadId={r.id} />
                </CardContent>
              </Card>
            )
          })}
          {(mode === "entity" ? entityOnly : withContact).length > PAGE && (
            <p className="text-center text-xs text-zinc-500">Showing the {PAGE} highest-scoring. Decided ones drop off and the next ones appear.</p>
          )}
        </div>
      )}
    </div>
  )
}
