import { db } from "@/lib/db"
import { creators, activities, tasks, tags } from "@/lib/db/schema"
import { eq, desc, asc, and } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ExternalLink, Mail, Phone, MapPin, MessageSquare, ListTodo, Activity as ActivityIco, Sparkles } from "lucide-react"
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

export const dynamic = "force-dynamic"

export default async function CreatorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = (await db.select().from(creators).where(eq(creators.id, id)))[0]
  if (!c) notFound()

  const [creatorActivities, openTasks, doneTasks, creatorTags] = await Promise.all([
    db.select().from(activities).where(eq(activities.creatorId, id)).orderBy(desc(activities.createdAt)).limit(50),
    db.select().from(tasks).where(and(eq(tasks.creatorId, id), eq(tasks.completed, false))).orderBy(asc(tasks.dueDate)),
    db.select().from(tasks).where(and(eq(tasks.creatorId, id), eq(tasks.completed, true))).orderBy(desc(tasks.completedAt)).limit(5),
    db.select().from(tags).where(eq(tags.creatorId, id)).orderBy(asc(tags.name)),
  ])

  const type = (c.flagNotes ?? "").match(/Type:\s*([^|]+)/i)?.[1]?.trim()
  const cleanedNotes = (c.flagNotes ?? "").replace(/Type:\s*[^|]+/i, "").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim()

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      <Link href="/creators" className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4">
        <ChevronLeft className="h-3 w-3 mr-1" /> Back to roster
      </Link>

      <div className="flex items-start justify-between mb-6 gap-6">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="lg" />
          <div className="min-w-0">
            <div className="text-xs text-zinc-500 mb-1">{c.id}</div>
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{c.platform ?? "—"}</Badge>
              {type && <Badge variant="info">{type}</Badge>}
            </div>
            <div className="mt-2">
              <HandleEdit
                creatorId={c.id}
                currentHandle={c.handle}
                currentPlatform={c.platform}
                profileUrl={c.profileUrl}
              />
            </div>
            <div className="mt-3">
              <TagInput creatorId={c.id} tags={creatorTags} />
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-zinc-500 mb-1">Pipeline stage</div>
          <div className={`inline-block rounded-md border px-2.5 py-1.5 ${STAGE_COLORS[(c.stage as Stage) ?? "Lead"]}`}>
            <StageMover creatorId={c.id} currentStage={c.stage ?? "Lead"} />
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">since {relativeDate(c.stageChangedAt)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Profile + Notes + Activity timeline */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Followers" value={formatNumber(c.followers)} />
              <Field label="Engagement rate" value={c.engagementRate ? `${c.engagementRate.toFixed(2)}%` : "—"} />
              <Field label="Niche" value={c.niche} />
              <Field label="Audience" value={c.audience} />
              <Field label="Age bracket" value={c.ageBracket} />
              <Field label="Languages" value={c.languages} />
              <Field label="Persona" value={c.persona} />
              <Field label="Content style" value={c.contentStyle} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <MessageSquare className="h-4 w-4" /> Add note
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <ActivityIco className="h-4 w-4" /> Activity timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {creatorActivities.length === 0 ? (
                <p className="text-sm text-zinc-500">No activity yet. Add a note or move stages to start the timeline.</p>
              ) : (
                <div className="space-y-3">
                  {creatorActivities.map((a) => (
                    <div key={a.id} className="flex gap-3">
                      <div className="shrink-0 mt-0.5 h-6 w-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                        <ActivityIcon type={a.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{a.title}</div>
                        {a.body && <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                        <div className="text-[10px] text-zinc-400 mt-1">
                          {a.actor} · {relativeDate(a.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Tasks + Contact + Commercials + Meta */}
        <div className="space-y-6">
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

          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-col items-center text-center pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="lg" className="mb-2" />
                <div className="font-medium text-zinc-900 dark:text-zinc-50">{c.name}</div>
                {c.handle && <div className="text-xs text-zinc-500">{c.handle}</div>}
              </div>
              {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-zinc-400" /><a href={`mailto:${c.email}`} className="text-zinc-900 dark:text-zinc-50 hover:underline truncate">{c.email}</a></div>}
              {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-zinc-400" /><span>{c.phone}</span></div>}
              {c.location && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-zinc-400" /><span>{c.location}</span></div>}
              {!c.email && !c.phone && <p className="text-zinc-500">No contact info — DM only</p>}
              <Link href={`/outreach/compose?creatorId=${c.id}`} className="block pt-2">
                <button className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 text-xs font-medium h-8 px-3 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">
                  <Sparkles className="h-3.5 w-3.5" /> Compose pitch
                </button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Commercials</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(() => {
                const est = estimateRate(c)
                return (
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 -mx-1">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-medium mb-0.5">
                      Estimated price · {est.confidence} confidence
                    </div>
                    <div className="text-base font-semibold tabular-nums">{est.band}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{est.basis}</div>
                  </div>
                )
              })()}
              {c.rateCeiling ? (
                <Field label="Actual rate ceiling" value={`$${c.rateCeiling.toLocaleString()}`} />
              ) : null}
              <Field label="Rate paid to date" value={c.ratePaid ? `$${c.ratePaid.toLocaleString()}` : "—"} />
              <Field label="Usage rights" value={c.usageRights} />
              <Field label="Exclusivity" value={c.exclusivity} />
              <Field label="Active campaigns" value={String(c.campaignsActive ?? 0)} />
              <Field label="Completed campaigns" value={String(c.campaignsCompleted ?? 0)} />
              <Field label="Avg grade" value={c.avgGrade} />
              <Field label="Repurpose eligible" value={c.repurposeEligible ? "Yes" : c.repurposeEligible === false ? "No" : "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Meta</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="Last contact" value={formatDate(c.lastContactDate)} />
              <Field label="Created" value={formatDate(c.createdAt)} />
              <Field label="Owner" value={c.owner} />
              <Field label="Source" value={c.source} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-zinc-900 dark:text-zinc-50">{value || "—"}</div>
    </div>
  )
}
