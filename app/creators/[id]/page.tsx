import { db } from "@/lib/db"
import { creators, activities, tasks, tags, leads } from "@/lib/db/schema"
import { eq, desc, asc, and } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronDown, ChevronLeft, ExternalLink, Mail, Phone, MapPin, MessageSquare, ListTodo, Sparkles } from "lucide-react"
import { Avatar } from "@/components/avatar"
import { HandleEdit } from "./handle-edit"
import { formatNumber, formatDate, relativeDate } from "@/lib/utils"
import { StageMover } from "@/app/pipeline/stage-mover"
import { STAGE_COLORS, type Stage } from "@/lib/stages"
import { estimateRate } from "@/lib/rate-estimator"
import { NoteForm } from "./note-form"
import { NewTaskForm, TaskItem } from "./task-form"
import { TagInput } from "./tag-input"
import { ActivityIcon } from "@/components/activity-icon"
import { statusVariant } from "@/lib/leads/ui"

export const dynamic = "force-dynamic"

export default async function CreatorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = (await db.select().from(creators).where(eq(creators.id, id)))[0]
  if (!c) notFound()

  const [creatorActivities, openTasks, doneTasks, creatorTags, linkedLeads] = await Promise.all([
    db.select().from(activities).where(eq(activities.creatorId, id)).orderBy(desc(activities.createdAt)).limit(50),
    db.select().from(tasks).where(and(eq(tasks.creatorId, id), eq(tasks.completed, false))).orderBy(asc(tasks.dueDate)),
    db.select().from(tasks).where(and(eq(tasks.creatorId, id), eq(tasks.completed, true))).orderBy(desc(tasks.completedAt)).limit(5),
    db.select().from(tags).where(eq(tags.creatorId, id)).orderBy(asc(tags.name)),
    db.select().from(leads).where(eq(leads.creatorId, id)),
  ])
  const lead = linkedLeads[0]

  const type = (c.flagNotes ?? "").match(/Type:\s*([^|]+)/i)?.[1]?.trim()
  const cleanedNotes = (c.flagNotes ?? "").replace(/Type:\s*[^|]+/i, "").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim()

  // Evidence rows that point at the same page are shown once, with every label it supports.
  const evidence = new Map<string, string[]>()
  if (lead) {
    for (const [label, url] of [
      ["Recent content", lead.recentContentUrl], ["Monetization", lead.monetizationEvidenceUrl],
      ["Need", lead.needEvidenceUrl], ["Channel", lead.channelEvidenceUrl],
    ] as const) if (url) evidence.set(url, [...(evidence.get(url) ?? []), label])
  }

  // Empty profile fields collapse into one line instead of a wall of dashes.
  const profileFields: [string, string | null | undefined][] = [
    ["Niche", c.niche], ["Engagement rate", c.engagementRate ? `${c.engagementRate.toFixed(2)}%` : null],
    ["Audience", c.audience], ["Age bracket", c.ageBracket], ["Languages", c.languages],
    ["Persona", c.persona], ["Content style", c.contentStyle],
  ]
  const profileSet = profileFields.filter(([, v]) => v)
  const profileUnset = profileFields.filter(([, v]) => !v).map(([k]) => k)
  const est = estimateRate(c)

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      <Link href="/creators" className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4">
        <ChevronLeft className="h-3 w-3 mr-1" /> Back to roster
      </Link>

      <div className="flex items-start justify-between mb-5 gap-6 flex-wrap">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="lg" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="capitalize">{c.platform ?? "—"}</Badge>
              {type && <Badge variant="info">{type}</Badge>}
              {lead && <Badge variant={statusVariant(lead.candidateStatus)}>{lead.candidateStatus}</Badge>}
              {lead?.priority === "A" && <Badge variant="info">Priority A</Badge>}
              <span className="font-mono text-[11px] text-zinc-400">{c.id}</span>
            </div>
            <div className="mt-2">
              <HandleEdit
                creatorId={c.id}
                currentHandle={c.handle}
                currentPlatform={c.platform}
                profileUrl={c.profileUrl}
              />
            </div>
            <div className="mt-2">
              <TagInput creatorId={c.id} tags={creatorTags} />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-xs text-zinc-500">Pipeline stage <span className="text-zinc-400">· since {relativeDate(c.stageChangedAt)}</span></div>
          <div className={`inline-block rounded-md border px-2.5 py-1.5 ${STAGE_COLORS[(c.stage as Stage) ?? "Lead"]}`}>
            <StageMover creatorId={c.id} currentStage={c.stage ?? "Lead"} />
          </div>
          <Link href={`/outreach/compose?creatorId=${c.id}`} className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 text-xs font-medium h-8 px-3 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">
            <Sparkles className="h-3.5 w-3.5" /> Compose pitch
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Followers" value={formatNumber(c.followers)} />
        <Stat label="Country" value={lead?.countryIso2 ?? c.location} />
        <Stat label="Lead score" value={lead?.leadScore != null ? lead.leadScore.toFixed(1) : null} sub={lead ? `Best channel: ${lead.bestChannel ?? "—"}` : undefined} />
        <Stat label="Recent activity" value={lead ? `${lead.contentCount30d ?? 0} posts / 30d` : null} sub={lead ? `${lead.longformCount60d ?? 0} long-form / 60d` : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: what to do and what happened */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <MessageSquare className="h-4 w-4" /> Notes &amp; timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NoteForm creatorId={c.id} />
              {cleanedNotes && (
                <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  <div className="text-xs text-zinc-500 mb-2">Imported notes (from CSV):</div>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{cleanedNotes}</p>
                </div>
              )}
              <div className="mt-5 pt-5 border-t border-zinc-100 dark:border-zinc-800">
                {creatorActivities.length === 0 ? (
                  <p className="text-sm text-zinc-500">No activity yet. Add a note or move stages to start the timeline.</p>
                ) : (
                  <div className="space-y-4">
                    {creatorActivities.map((a) => (
                      <div key={a.id} className="flex gap-3">
                        <div className="shrink-0 mt-0.5 h-6 w-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                          <ActivityIcon type={a.type} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{a.title}</div>
                          {a.body && <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                          <div className="text-[10px] text-zinc-400 mt-1">{a.actor} · {relativeDate(a.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Collapsible title="Profile details" hint={profileSet.length ? `${profileSet.length} of ${profileFields.length} set` : "nothing set yet"}>
            {profileSet.length > 0 && <div className="grid grid-cols-2 gap-4">{profileSet.map(([k, v]) => <Field key={k} label={k} value={v} />)}</div>}
            {profileUnset.length > 0 && <p className="mt-3 text-xs text-zinc-500">Not set: {profileUnset.join(", ")}</p>}
          </Collapsible>

          <Collapsible title="Commercials" hint={est.band}>
            <div className="space-y-3">
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-medium mb-0.5">Estimated price · {est.confidence} confidence</div>
                <div className="text-base font-semibold tabular-nums">{est.band}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{est.basis}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {c.rateCeiling ? <Field label="Actual rate ceiling" value={`$${c.rateCeiling.toLocaleString()}`} /> : null}
                <Field label="Rate paid to date" value={c.ratePaid ? `$${c.ratePaid.toLocaleString()}` : "—"} />
                <Field label="Usage rights" value={c.usageRights} />
                <Field label="Exclusivity" value={c.exclusivity} />
                <Field label="Active campaigns" value={String(c.campaignsActive ?? 0)} />
                <Field label="Completed campaigns" value={String(c.campaignsCompleted ?? 0)} />
                <Field label="Avg grade" value={c.avgGrade} />
                <Field label="Repurpose eligible" value={c.repurposeEligible ? "Yes" : c.repurposeEligible === false ? "No" : "—"} />
              </div>
            </div>
          </Collapsible>

          <Collapsible title="Meta">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Last contact" value={formatDate(c.lastContactDate)} />
              <Field label="Created" value={formatDate(c.createdAt)} />
              <Field label="Owner" value={c.owner} />
              <Field label="Source" value={c.source} />
            </div>
          </Collapsible>
        </div>

        {/* Right column: who to reach, what's next, why they qualify */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {c.email && <div className="flex items-center gap-2 min-w-0"><Mail className="h-3.5 w-3.5 shrink-0 text-zinc-400" /><a href={`mailto:${c.email}`} className="text-zinc-900 dark:text-zinc-50 hover:underline truncate">{c.email}</a></div>}
              {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-zinc-400" /><span>{c.phone}</span></div>}
              {c.location && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-zinc-400" /><span>{c.location}</span></div>}
              {!c.email && !c.phone && <p className="text-zinc-500">No email or phone stored. Reach out by DM{lead?.bestChannel ? ` (best channel: ${lead.bestChannel})` : ""}.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <ListTodo className="h-4 w-4" /> Tasks
                {openTasks.length > 0 && <Badge variant="warn">{openTasks.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NewTaskForm creatorId={c.id} />
              <div className="space-y-1">
                {openTasks.map((t) => <TaskItem key={t.id} task={t as any} />)}
                {openTasks.length === 0 && <p className="text-xs text-zinc-500 px-2 py-3">No open tasks.</p>}
              </div>
              {doneTasks.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Recently done ({doneTasks.length})</summary>
                  <div className="space-y-1 mt-2">
                    {doneTasks.map((t) => <TaskItem key={t.id} task={t as any} />)}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          {lead && (
            <Card>
              <CardHeader><CardTitle>Why they qualify</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="text-xs text-zinc-500">Evidence last checked {lead.checkedDate ?? "never"}</div>
                {evidence.size === 0 && <p className="text-xs text-zinc-500">No evidence links stored.</p>}
                <ul className="space-y-2">
                  {[...evidence].map(([url, labels]) => (
                    <li key={url} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5">
                      <div className="flex flex-wrap gap-1">{labels.map((l) => <Badge key={l} variant="secondary">{l}</Badge>)}</div>
                      <a href={url} target="_blank" rel="noreferrer" title={url} className="mt-1.5 inline-flex max-w-full items-center gap-1 text-xs underline">
                        <span className="truncate">{shortUrl(url)}</span><ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
                {evidence.size === 1 && evidence.values().next().value!.length > 1 && (
                  <p className="text-xs text-zinc-500">All of this evidence comes from one page. Add a second source to make it stronger.</p>
                )}
                <Link href={`/leads/${lead.id}`} className="inline-block text-xs underline">Full evidence &amp; sequences →</Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value?: string | null; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value || "—"}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{sub}</div>}
    </Card>
  )
}

// Secondary information stays one click away instead of lengthening the page.
function Collapsible({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
          {title}
          {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
          <ChevronDown className="ml-auto h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-6 pb-6 text-sm">{children}</div>
      </details>
    </Card>
  )
}

// "https://www.youtube.com/watch?v=abc" → "youtube.com/watch?v=abc"
function shortUrl(u: string) {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-zinc-900 dark:text-zinc-50">{value || "—"}</div>
    </div>
  )
}
