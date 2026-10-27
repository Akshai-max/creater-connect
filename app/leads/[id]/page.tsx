import { db } from "@/lib/db"
import { leadEvidence, leads, outreachMessages } from "@/lib/db/schema"
import { asc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ExternalLink, Star } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatNumber } from "@/lib/utils"
import { parseJson, statusVariant } from "@/lib/leads/ui"
import type { ChannelRecommendation, QualificationCheck, ScoreFactor } from "@/lib/leads/types"
import { MessageTabs } from "./message-tabs"
import { LeadActions } from "./lead-actions"

export const dynamic = "force-dynamic"

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

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      <Link href="/leads" className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4">
        <ChevronLeft className="h-3 w-3 mr-1" /> Back to leads
      </Link>
      <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
        <div>
          <div className="text-xs text-zinc-500 mb-1">{l.id} · {l.identityKey}{l.isFixture ? " · FIXTURE (fictional)" : ""}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{l.creatorName}</h1>
          <div className="mt-2 flex gap-2 flex-wrap items-center">
            <Badge variant={statusVariant(l.candidateStatus)}>{l.candidateStatus}</Badge>
            {l.priority === "A" ? <Badge variant="info"><Star className="h-3 w-3 mr-1" />Priority A</Badge> : <Badge variant="secondary">Priority {l.priority ?? "—"}</Badge>}
            <Badge variant="outline">score {l.leadScore?.toFixed(1) ?? "—"}/100</Badge>
            <Badge variant="secondary">{l.segment ?? "—"}</Badge>
            <Badge variant="secondary">{l.countryIso2 ?? "—"} · {l.primaryLanguage ?? "—"}</Badge>
            {l.profileUrl && <a href={l.profileUrl} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 text-zinc-500 hover:underline">{l.primaryPlatform} profile <ExternalLink className="h-3 w-3" /></a>}
            {l.creatorId && <Link href={`/creators/${l.creatorId}`} className="text-xs underline">In pipeline →</Link>}
          </div>
        </div>
        <LeadActions leadId={l.id} qualified={l.candidateStatus === "qualified"} hasCreator={!!l.creatorId} hasMessages={messages.length > 0} />
      </div>

      {l.rejectionReason && (
        <Card className="mb-6 border-amber-300 dark:border-amber-800">
          <CardContent className="p-4 text-sm"><span className="font-medium">Why not qualified: </span>{l.rejectionReason}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Outreach sequences</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-500 mb-3">Drafts only. Nothing is sent automatically. LinkedIn and Instagram must be sent by hand from your own account.</p>
              <MessageTabs leadId={l.id} messages={messages} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xs text-zinc-500 mb-3">Last checked: {l.checkedDate ? formatDate(l.checkedDate) : "never"} · Stored by run {l.lastRunId ?? "—"} · updated {l.updatedAt ? formatDate(l.updatedAt) : "—"}</div>
              <div className="space-y-1.5">
                {evidence.map((e) => (
                  <div key={e.id} className="text-sm flex gap-2 items-start">
                    <Badge variant="secondary" className="shrink-0 w-24 justify-center">{e.kind}{e.channel ? `:${e.channel}` : ""}</Badge>
                    <div className="min-w-0">
                      <div className="truncate">
                        {e.label ?? e.value ?? ""}
                        {e.isLongform ? <Badge variant="outline" className="ml-1">long-form</Badge> : null}
                        {e.publishedAt && <span className="text-xs text-zinc-500 ml-2">{e.publishedAt.slice(0, 10)}</span>}
                        {e.lastActiveAt && <span className="text-xs text-zinc-500 ml-2">active {e.lastActiveAt.slice(0, 10)}</span>}
                        {e.source && e.source !== "published" && <Badge variant="danger" className="ml-1">{e.source}</Badge>}
                      </div>
                      {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline break-all">{e.url}</a> : <span className="text-xs text-red-600">no evidence URL</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Qualification checks</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {checks.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <span className={c.pass ? "text-emerald-600" : c.severity === "reject" ? "text-red-600" : "text-amber-600"}>{c.pass ? "✓" : "✗"}</span>
                  <div>
                    <div>{c.label}</div>
                    {!c.pass && <div className="text-xs text-zinc-500">{c.severity === "reject" ? "Rejects: " : "Unverified: "}{c.reason}</div>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Channels</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              {rec ? (
                <>
                  <div><span className="font-medium">Best:</span> {rec.best ?? "none"} {rec.bestValue && <span className="text-zinc-500">({rec.bestValue})</span>}</div>
                  <p className="text-xs text-zinc-500">{rec.bestReason}</p>
                  <div><span className="font-medium">Backup:</span> {rec.backup ?? "none"}</div>
                  <p className="text-xs text-zinc-500">{rec.backupReason}</p>
                  <Badge variant={rec.verificationStatus === "verified" ? "success" : rec.verificationStatus === "partial" ? "warn" : "danger"}>{rec.verificationStatus}</Badge>
                  {rec.unavailable.length > 0 && (
                    <ul className="text-xs text-zinc-500 list-disc pl-4">{rec.unavailable.map((u) => <li key={u.channel}>{u.reason}</li>)}</ul>
                  )}
                </>
              ) : <p className="text-zinc-500">No recommendation.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Score breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {factors.map((f) => (
                <div key={f.key}>
                  <div className="flex justify-between"><span>{f.label}</span><span className="tabular-nums">{f.points}/{f.max}</span></div>
                  <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded"><div className="h-1.5 bg-zinc-900 dark:bg-zinc-100 rounded" style={{ width: `${(f.points / f.max) * 100}%` }} /></div>
                  <div className="text-[11px] text-zinc-500">{f.reason}</div>
                </div>
              ))}
              <div className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800">Priority A = top 25 qualified leads by this score. Unqualified leads are never Priority A.</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>{l.contentCount30d ?? 0} items in last 30 days</div>
              <div>{l.longformCount60d ?? 0} long-form in last 60 days</div>
              <div>Last content: {l.lastContentDate ?? "—"}</div>
              <div>Audience: {formatNumber(l.followers)}</div>
              {l.personalizationHook && <div className="text-xs text-zinc-500 pt-1">Hook: {l.personalizationHook}</div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
