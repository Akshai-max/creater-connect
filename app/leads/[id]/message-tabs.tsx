"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, Copy, ExternalLink, Save } from "lucide-react"
import { approveMessage, saveMessage } from "../actions"

type Msg = { channel: string; sequence: number; subject: string | null; body: string | null; status: string; unavailableReason: string | null; edited: boolean | null; evidenceRefs: string | null }
const CHANNELS = ["email", "linkedin", "instagram"] as const
const NAME: Record<(typeof CHANNELS)[number], string> = { email: "Email", linkedin: "LinkedIn", instagram: "Instagram" }
const label = (seq: number) => (seq === 1 ? "First message" : `Follow-up ${seq - 1}`)
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "source" } }

export function MessageTabs({ leadId, messages }: { leadId: string; messages: Msg[] }) {
  const [tab, setTab] = useState<(typeof CHANNELS)[number]>("email")
  const list = messages.filter((m) => m.channel === tab).sort((a, b) => a.sequence - b.sequence)
  return (
    <div>
      <div role="tablist" className="mb-4 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
        {CHANNELS.map((c) => {
          const ms = messages.filter((m) => m.channel === c)
          const unavailable = ms.length === 0 || ms.every((m) => m.status === "unavailable")
          const approved = ms.filter((m) => m.status === "approved").length
          return (
            <button key={c} role="tab" aria-selected={tab === c} onClick={() => setTab(c)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === c ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"}`}>
              {NAME[c]}
              <span className={`rounded px-1.5 py-px text-[10px] tabular-nums ${unavailable ? "text-zinc-400 dark:text-zinc-600" : approved === ms.length ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-zinc-200/70 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300"}`}>
                {unavailable ? "Not available" : `${approved}/${ms.length} approved`}
              </span>
            </button>
          )
        })}
      </div>
      {list.length === 0 && <p className="text-sm text-zinc-500">No drafts for {NAME[tab]} yet.</p>}
      <ol className="space-y-4">
        {list.map((m, i) => <MessageCard key={`${m.channel}-${m.sequence}`} leadId={leadId} m={m} step={i + 1} last={i === list.length - 1} />)}
      </ol>
    </div>
  )
}

function MessageCard({ leadId, m, step, last }: { leadId: string; m: Msg; step: number; last: boolean }) {
  const [subject, setSubject] = useState(m.subject ?? "")
  const [body, setBody] = useState(m.body ?? "")
  const [problems, setProblems] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()
  const router = useRouter()
  const dirty = body !== (m.body ?? "") || subject !== (m.subject ?? "")
  const approved = m.status === "approved"

  const marker = (
    <div className="flex flex-col items-center">
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${approved ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
        {approved ? <Check className="h-3.5 w-3.5" /> : step}
      </div>
      {!last && <div className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />}
    </div>
  )

  if (m.status === "unavailable") {
    return (
      <li className="flex gap-3">
        {marker}
        <div className="flex-1 rounded-lg border border-dashed border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <div className="font-medium">{label(m.sequence)}</div>
          <div className="mt-0.5 text-zinc-500">Not available: {m.unavailableReason}</div>
        </div>
      </li>
    )
  }
  const refs: string[] = (() => { try { return JSON.parse(m.evidenceRefs ?? "[]") } catch { return [] } })()
  const lines = body.split("\n").length + Math.ceil(body.length / 90)

  return (
    <li className="flex gap-3">
      {marker}
      <div className={`min-w-0 flex-1 rounded-lg border p-4 ${approved ? "border-emerald-200 dark:border-emerald-900/50" : "border-zinc-200 dark:border-zinc-800"}`}>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-medium">{label(m.sequence)}</span>
          <Badge variant={approved ? "success" : "secondary"}>{approved ? "Approved" : "Draft"}</Badge>
          {m.edited && <span className="text-[11px] text-zinc-500">Edited</span>}
          <span className="ml-auto text-[11px] tabular-nums text-zinc-400">{body.length} characters</span>
        </div>
        {m.channel === "email" && (
          <label className="mb-2 block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-500">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:focus:border-zinc-600" placeholder="Subject" />
          </label>
        )}
        <label className="block">
          {m.channel === "email" && <span className="mb-1 block text-[11px] font-medium text-zinc-500">Message</span>}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(Math.max(lines, 5), 16)}
            className="w-full resize-y rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm leading-relaxed focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:focus:border-zinc-600" />
        </label>
        {problems.length > 0 && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Can&apos;t approve yet: {problems.join("; ")}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {refs.length > 0 && (
            <div className="mr-auto flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              Based on
              {refs.map((r) => (
                <a key={r} href={r} target="_blank" rel="noreferrer" title={r} className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100">
                  {host(r)} <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-[11px] text-amber-600 dark:text-amber-400">Unsaved changes</span>}
            <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(m.channel === "email" ? `Subject: ${subject}\n\n${body}` : body); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
              <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
            </Button>
            {dirty ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await saveMessage(leadId, m.channel, m.sequence, m.channel === "email" ? subject : null, body); router.refresh() })}>
                <Save className="h-3.5 w-3.5" /> Save changes
              </Button>
            ) : (
              <Button size="sm" variant="success" disabled={pending || approved} onClick={() => start(async () => { const r = await approveMessage(leadId, m.channel, m.sequence); setProblems(r.problems); router.refresh() })}>
                <Check className="h-3.5 w-3.5" /> {approved ? "Approved" : "Approve"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}
