import { db } from "@/lib/db"
import { candidates, leads } from "@/lib/db/schema"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { eq, desc, isNotNull } from "drizzle-orm"
import { statusVariant } from "@/lib/leads/ui"
import Link from "next/link"
import { ExternalLink, Mail, MapPin, Info } from "lucide-react"
import { formatNumber, relativeDate } from "@/lib/utils"
import { CleanupButton } from "./cleanup-button"
import { Avatar } from "@/components/avatar"
import { ReviewActions } from "./review-actions"
import { RestoreButton } from "./restore-button"

export const dynamic = "force-dynamic"

const TABS = ["pending", "approved", "rejected"] as const

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams
  const tab = (TABS.includes(params.tab as any) ? params.tab : "pending") as (typeof TABS)[number]

  const pending = await db.select().from(candidates).where(eq(candidates.status, "pending")).orderBy(desc(candidates.fitScore))
  const approved = await db.select().from(candidates).where(eq(candidates.status, "approved")).orderBy(desc(candidates.reviewedAt))
  const rejected = await db.select().from(candidates).where(eq(candidates.status, "rejected")).orderBy(desc(candidates.reviewedAt))

  const list = tab === "pending" ? pending : tab === "approved" ? approved : rejected
  // Evidence-based qualification, when the engine has evaluated this candidate
  // (npm run engine -- --provider candidates). Separate from the AI fit score.
  const linked = await db.select({ id: leads.id, candidateId: leads.candidateId, status: leads.candidateStatus, reason: leads.rejectionReason }).from(leads).where(isNotNull(leads.candidateId))
  const qualByCandidate = new Map(linked.map((l) => [l.candidateId!, l]))

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {pending.length} pending · {approved.length} approved · {rejected.length} rejected
          </p>
        </div>
        <CleanupButton />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/candidates" : `/candidates?tab=${s}`}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
              tab === s
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            {s} <span className="opacity-60">({(s === "pending" ? pending : s === "approved" ? approved : rejected).length})</span>
          </Link>
        ))}
        {tab === "rejected" && (
          <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1 ml-2">
            <Info className="h-3 w-3" />
            Rejected creators are skipped on future Apify runs. Click Restore to send them back to pending.
          </span>
        )}
      </div>

      <div className="space-y-3">
        {list.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-zinc-500">
              {tab === "pending"
                ? "No pending candidates. The Apify daily scrape will drop new ones here."
                : tab === "approved"
                ? "No approved candidates yet."
                : "No rejected candidates."}
            </CardContent>
          </Card>
        )}
        {list.map((c) => (
          <Card key={c.id}>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Avatar name={c.fullName ?? c.handle} url={c.avatarUrl} candidateId={c.id} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Link href={`/candidates/${c.id}`} className="font-semibold text-zinc-900 dark:text-zinc-50 hover:underline">
                      {c.handle}
                    </Link>
                    <span className="text-sm text-zinc-500">{c.fullName}</span>
                    {c.isUS && <Badge variant="info">🇺🇸 US</Badge>}
                    {c.nicheRelevant && <Badge variant="success">on-niche</Badge>}
                    {c.fitScore != null && <Badge variant="outline">fit {c.fitScore.toFixed(1)}/10</Badge>}
                    {c.rateBand && <Badge variant="secondary">{c.rateBand}</Badge>}
                    {c.personaMatch && <Badge variant="secondary">{c.personaMatch}</Badge>}
                    {c.aiScored && <Badge variant="info" title="AI-scored by Claude">🤖</Badge>}
                  </div>
                  <div className="text-xs text-zinc-500 mb-3 flex items-center gap-3 flex-wrap">
                    <span>{formatNumber(c.followers)} followers · {c.engagementRate?.toFixed(1)}% ER</span>
                    {c.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.location}</span>}
                    {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                    <span>· source: {c.sourceDetail ?? c.source}</span>
                    {c.reviewedAt && tab !== "pending" && <span className="text-zinc-400">· {tab} {relativeDate(c.reviewedAt)}</span>}
                  </div>
                  {(() => {
                    const q = qualByCandidate.get(c.id)
                    if (!q) return <div className="text-xs text-zinc-400 mb-2">Qualification: not evaluated yet</div>
                    return (
                      <div className="text-xs mb-2 flex items-start gap-2">
                        <Link href={`/leads/${q.id}`}><Badge variant={statusVariant(q.status)}>{q.status}</Badge></Link>
                        {q.reason && <span className="text-zinc-600 dark:text-zinc-400 line-clamp-2" title={q.reason}>{q.reason}</span>}
                      </div>
                    )
                  })()}
                  {c.fitReasoning && <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">{c.fitReasoning}</p>}
                  {c.outreachAngle && tab === "pending" && (
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 mb-2">
                      <span className="font-medium">→ Angle:</span> {c.outreachAngle}
                    </div>
                  )}
                  {c.redFlags && tab === "pending" && (
                    <div className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                      <span className="font-medium">⚠ Flags:</span> {c.redFlags.replace(/\n/g, " · ")}
                    </div>
                  )}
                  {c.bio && <p className="text-xs text-zinc-500 italic line-clamp-2">{c.bio}</p>}
                  <div className="mt-3 flex items-center gap-3">
                    {c.externalUrl && (
                      <a href={c.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1">
                        Portfolio <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <a href={`https://instagram.com/${c.handle?.replace("@","")}`} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1">
                      Instagram <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <div className="shrink-0">
                  {tab === "pending" && <ReviewActions candidateId={c.id} />}
                  {tab === "rejected" && <RestoreButton candidateId={c.id} />}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
