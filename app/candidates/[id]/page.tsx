import { db } from "@/lib/db"
import { candidates } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ExternalLink, Mail, MapPin } from "lucide-react"
import { formatNumber } from "@/lib/utils"
import { ReviewActions } from "../review-actions"
import { Avatar } from "@/components/avatar"

export const dynamic = "force-dynamic"

export default async function CandidateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = (await db.select().from(candidates).where(eq(candidates.id, id)))[0]
  if (!c) notFound()

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto">
      <Link href="/candidates" className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4">
        <ChevronLeft className="h-3 w-3 mr-1" /> Back to review queue
      </Link>

      <div className="flex items-start justify-between mb-8 gap-6">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar name={c.fullName ?? c.handle} url={c.avatarUrl} candidateId={c.id} size="lg" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{c.handle}</h1>
            <p className="text-sm text-zinc-500 mt-1">{c.fullName}</p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{c.platform}</Badge>
              {c.isUS && <Badge variant="info">🇺🇸 US</Badge>}
              {c.nicheRelevant && <Badge variant="success">on-niche</Badge>}
              {c.fitScore != null && <Badge variant="outline">fit {c.fitScore.toFixed(1)}/10</Badge>}
              {c.rateBand && <Badge>{c.rateBand}</Badge>}
              {c.personaMatch && <Badge variant="secondary">{c.personaMatch}</Badge>}
              {c.aiScored && <Badge variant="info">🤖 AI-scored</Badge>}
              <Badge variant={c.status === "pending" ? "warn" : c.status === "approved" ? "success" : "danger"}>
                {c.status}
              </Badge>
            </div>
          </div>
        </div>
        {c.status === "pending" && <ReviewActions candidateId={c.id} />}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Followers" value={formatNumber(c.followers)} />
            <Field label="Engagement rate" value={c.engagementRate ? `${c.engagementRate.toFixed(2)}%` : "—"} />
            <Field label="Location" value={c.location} />
            <Field label="Source" value={c.sourceDetail ?? c.source} />
          </CardContent>
        </Card>

        {c.fitReasoning && (
          <Card>
            <CardHeader><CardTitle>Why this candidate fits</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{c.fitReasoning}</p>
              {c.outreachAngle && (
                <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 font-medium mb-1">Suggested outreach angle</div>
                  <p className="text-sm text-emerald-900 dark:text-emerald-100">{c.outreachAngle}</p>
                </div>
              )}
              {c.nicheGuess && (
                <div className="text-xs text-zinc-500">Niche observed: <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.nicheGuess}</span></div>
              )}
              {c.redFlags && (
                <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300 font-medium mb-1">Red flags</div>
                  <ul className="text-sm text-amber-900 dark:text-amber-100 space-y-0.5">
                    {c.redFlags.split("\n").filter(Boolean).map((f, i) => <li key={i}>· {f}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Bio</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{c.bio ?? "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.email ? (
              <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-zinc-400" /><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></div>
            ) : (
              <p className="text-zinc-500">No email — DM only on Instagram</p>
            )}
            {c.location && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-zinc-400" /><span>{c.location}</span></div>}
            {c.externalUrl && (
              <div>
                <a href={c.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300 hover:underline">
                  Portfolio <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div>
              <a href={`https://instagram.com/${c.handle.replace("@","")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300 hover:underline">
                Instagram profile <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div>{value || "—"}</div>
    </div>
  )
}
