"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, Copy, Save } from "lucide-react"
import { approveMessage, saveMessage } from "../actions"

type Msg = { channel: string; sequence: number; subject: string | null; body: string | null; status: string; unavailableReason: string | null; edited: boolean | null; evidenceRefs: string | null }
const CHANNELS = ["email", "linkedin", "instagram"] as const
const label = (seq: number) => (seq === 1 ? "Initial" : `Follow-up ${seq - 1}`)

export function MessageTabs({ leadId, messages }: { leadId: string; messages: Msg[] }) {
  const [tab, setTab] = useState<(typeof CHANNELS)[number]>("email")
  const list = messages.filter((m) => m.channel === tab).sort((a, b) => a.sequence - b.sequence)
  return (
    <div>
      <div className="flex gap-2 mb-4">
        {CHANNELS.map((c) => {
          const ms = messages.filter((m) => m.channel === c)
          const unavailable = ms.length > 0 && ms.every((m) => m.status === "unavailable")
          return (
            <button key={c} onClick={() => setTab(c)} className={`px-3 py-1 rounded-md text-xs font-medium capitalize ${tab === c ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
              {c} {unavailable ? "· n/a" : `· ${ms.filter((m) => m.status === "approved").length}/${ms.length} approved`}
            </button>
          )
        })}
      </div>
      {list.length === 0 && <p className="text-sm text-zinc-500">No sequence drafted for this channel yet.</p>}
      <div className="space-y-4">
        {list.map((m) => <MessageCard key={`${m.channel}-${m.sequence}`} leadId={leadId} m={m} />)}
      </div>
    </div>
  )
}

function MessageCard({ leadId, m }: { leadId: string; m: Msg }) {
  const [subject, setSubject] = useState(m.subject ?? "")
  const [body, setBody] = useState(m.body ?? "")
  const [problems, setProblems] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()
  const router = useRouter()
  const dirty = body !== (m.body ?? "") || subject !== (m.subject ?? "")

  if (m.status === "unavailable") {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-sm">
        <div className="font-medium mb-1">{label(m.sequence)}</div>
        <div className="text-zinc-500">Unavailable: {m.unavailableReason}</div>
      </div>
    )
  }
  const refs: string[] = (() => { try { return JSON.parse(m.evidenceRefs ?? "[]") } catch { return [] } })()

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium text-sm">{label(m.sequence)}</span>
        <Badge variant={m.status === "approved" ? "success" : "secondary"}>{m.status}</Badge>
        {m.edited && <Badge variant="outline">edited</Badge>}
        <span className="text-[11px] text-zinc-500 ml-auto tabular-nums">{body.length} chars</span>
      </div>
      {m.channel === "email" && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full mb-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm" placeholder="Subject" />
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={m.channel === "email" ? 10 : 6} className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm font-mono" />
      {refs.length > 0 && <div className="text-[11px] text-zinc-500 mt-1">Evidence: {refs.map((r) => <a key={r} href={r} target="_blank" rel="noreferrer" className="underline mr-2">{r}</a>)}</div>}
      {problems.length > 0 && <div className="text-xs text-red-600 mt-1">Cannot approve: {problems.join("; ")}</div>}
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => start(async () => { await saveMessage(leadId, m.channel, m.sequence, m.channel === "email" ? subject : null, body); router.refresh() })}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
        <Button size="sm" variant="success" disabled={dirty || pending || m.status === "approved"} onClick={() => start(async () => { const r = await approveMessage(leadId, m.channel, m.sequence); setProblems(r.problems); router.refresh() })}>
          <Check className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(m.channel === "email" ? `Subject: ${subject}\n\n${body}` : body); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}
