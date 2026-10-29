import { db } from "@/lib/db"
import { leadEvidence, leads, outreachMessages } from "@/lib/db/schema"
import { asc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ChevronLeft, CircleAlert, ExternalLink, ShieldCheck, Star, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatNumber } from "@/lib/utils"
import { parseJson, statusVariant } from "@/lib/leads/ui"
import type { ChannelRecommendation, QualificationCheck, ScoreFactor } from "@/lib/leads/types"
import { MessageTabs } from "./message-tabs"
import { LeadActions } from "./lead-actions"
import { EvidenceSections, nameOf } from "./evidence"

export const dynamic = "force-dynamic"

const LANG: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", hi: "Hindi" }
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "link" } }

function SourceLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-xs text-red-600 dark:text-red-400">No source link</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url} className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
      {host(url)} <ExternalLink className="h-3 w-3" />
    </a>
  )
}

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const l = (await db.select().from(leads).where(eq(leads.id, id)))[0]
  if (!l) notFound()
  const [evidence, messages] = await Promise.all([
    db.select().from(leadEvidence).where(eq(leadEvidence.leadId, id)).orderBy(asc(leadEvidence.kind), asc(leadEvidence.publishedAt)),
    db.select().from(outreachMessages).where(eq(outreachMessages.leadId, id)),
  ])
  const checks = parseJson<QualificationCheck[]>(l.qualificationChecks, [])
  const factors = parseJson<ScoreFactor[]>(l.scoreFactors, [])
  const rec = parseJson<ChannelRecommendation | null>(l.channelRecommendation, null)
  const failing = checks.filter((c) => !c.pass)
  const passed = checks.length - failing.length
  const sortedChecks = [...failing, ...checks.filter((c) => c.pass)]

  const subtitle = [
    nameOf(l.primaryPlatform),
    l.segment && l.segment !== l.primaryPlatform && l.segment !== `${l.primaryPlatform}r` && l.segment !== "youtuber" ? l.segment : null,
    l.countryIso2,
    l.primaryLanguage ? LANG[l.primaryLanguage] ?? l.primaryLanguage : null,
  ].filter(Boolean).join(" · ")

  const stats = [
    { label: "Lead score", value: l.leadScore != null ? `${Math.round(l.leadScore)}` : "—", suffix: l.leadScore != null ? "/100" : "" },
    { label: "Audience", value: formatNumber(l.followers), suffix: l.followers != null ? " followers" : "" },
    { label: "Uploads", value: `${l.contentCount30d ?? 0}`, suffix: " in 30 days" },
    { label: "Long-form", value: `${l.longformCount60d ?? 0}`, suffix: " in 60 days" },
    { label: "Last upload", value: l.lastContentDate ? formatDate(l.lastContentDate) : "—", suffix: "" },
  ]

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <Link href="/leads" className="mb-5 inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ChevronLeft className="mr-1 h-3 w-3" /> Back to leads
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{l.creatorName}</h1>
            <Badge variant={statusVariant(l.candidateStatus)} className="capitalize">{l.candidateStatus}</Badge>
            {l.priority === "A" && <Badge variant="info"><Star className="mr-1 h-3 w-3" />Priority A</Badge>}
            {l.isFixture && <Badge variant="danger">Fictional test data</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
            <span>{subtitle}</span>
            {l.profileUrl && (
              <a href={l.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100">
                View on {nameOf(l.primaryPlatform)} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {l.creatorId && <Link href={`/creators/${l.creatorId}`} className="text-emerald-700 hover:underline dark:text-emerald-400">In pipeline →</Link>}
          </div>
          <div className="mt-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-600" title={l.identityKey ?? ""}>{l.id}</div>
        </div>
        <LeadActions leadId={l.id} qualified={l.candidateStatus === "qualified"} hasCreator={!!l.creatorId} hasMessages={messages.length > 0} />
      </div>

      {l.rejectionReason && (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div><div className="font-medium">Why this lead isn&apos;t qualified</div><div className="mt-0.5 text-zinc-600 dark:text-zinc-400">{l.rejectionReason}</div></div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-xs text-zinc-500">{s.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{s.value}<span className="text-xs font-normal text-zinc-500">{s.suffix}</span></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Outreach drafts</CardTitle>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <ShieldCheck className="h-3.5 w-3.5" /> Nothing is sent automatically. Review, edit and approve each step; LinkedIn and Instagram are sent by hand from your own account.
              </p>
            </CardHeader>
            <CardContent>
              {l.personalizationHook && (
                <div className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <span className="font-medium text-zinc-900 dark:text-zinc-200">Personal hook: </span>{l.personalizationHook}
                </div>
              )}
              <MessageTabs leadId={l.id} messages={messages} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
              <p className="text-xs text-zinc-500">Last checked {l.checkedDate ? formatDate(l.checkedDate) : "never"}{l.lastRunId ? ` · run ${l.lastRunId}` : ""}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <EvidenceSections evidence={evidence} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Qualification</CardTitle>
                <span className={`text-xs font-medium tabular-nums ${failing.length ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{passed}/{checks.length} passed</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div className={`h-full rounded-full ${failing.length ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${checks.length ? (passed / checks.length) * 100 : 0}%` }} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sortedChecks.map((c) => {
                const Icon = c.pass ? CheckCircle2 : c.severity === "reject" ? XCircle : CircleAlert
                return (
                  <div key={c.id} className="flex gap-2">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.pass ? "text-emerald-600 dark:text-emerald-500" : c.severity === "reject" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`} />
                    <div className="min-w-0">
                      <div className={c.pass ? "text-zinc-700 dark:text-zinc-300" : "font-medium"}>{c.label}</div>
                      {!c.pass && <div className="text-xs text-zinc-500">{c.severity === "reject" ? "Rejects: " : "Unverified: "}{c.reason}</div>}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>How to reach them</CardTitle>
                {rec && <Badge variant={rec.verificationStatus === "verified" ? "success" : rec.verificationStatus === "partial" ? "warn" : "danger"} className="capitalize">{rec.verificationStatus === "none" ? "Unverified" : rec.verificationStatus}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {rec ? (
                <>
                  <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="text-xs text-zinc-500">Best route</div>
                    <div className="mt-0.5 font-medium">{rec.best ? nameOf(rec.best) : "None found"}</div>
                    {rec.bestValue && <div className="truncate text-zinc-600 dark:text-zinc-400" title={rec.bestValue}>{rec.bestValue}</div>}
                    {rec.bestEvidenceUrl && <div className="mt-1"><SourceLink url={rec.bestEvidenceUrl} /></div>}
                  </div>
                  <div className="rounded-lg border border-dashed border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="text-xs text-zinc-500">Backup route</div>
                    <div className="mt-0.5">{rec.backup ? nameOf(rec.backup) : "None"}</div>
                    {rec.backupReason && <div className="mt-0.5 text-xs text-zinc-500">{rec.backupReason}</div>}
                  </div>
                  {(rec.bestReason || rec.unavailable.length > 0) && (
                    <details className="text-xs text-zinc-500">
                      <summary className="cursor-pointer select-none hover:text-zinc-900 dark:hover:text-zinc-100">Why this route</summary>
                      <p className="mt-2">{rec.bestReason}</p>
                      {rec.unavailable.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{rec.unavailable.map((u) => <li key={u.channel}><span className="font-medium">{nameOf(u.channel)}:</span> {u.reason}</li>)}</ul>}
                    </details>
                  )}
                </>
              ) : <p className="text-zinc-500">No contact route found yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Score breakdown</CardTitle>
                <span className="text-sm font-semibold tabular-nums">{l.leadScore?.toFixed(1) ?? "—"}<span className="text-xs font-normal text-zinc-500">/100</span></span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {factors.map((f) => (
                <div key={f.key} title={f.reason}>
                  <div className="flex justify-between text-xs"><span>{f.label}</span><span className="tabular-nums text-zinc-500">{f.points}/{f.max}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-sky-500" style={{ width: `${f.max ? (f.points / f.max) * 100 : 0}%` }} /></div>
                </div>
              ))}
              <p className="border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800">Hover a bar for its reason. Priority A is the top 25 qualified leads by score.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
