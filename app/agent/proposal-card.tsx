"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Check, Copy, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { AgentProposal } from "@/lib/db/schema"
import { decide } from "./actions"

const KIND_LABEL: Record<string, string> = { pitch: "Pitch", candidate_decision: "Review-queue decision", next_step: "Next step" }

function subjectHref(p: AgentProposal) {
  if (p.subjectType === "lead") return `/leads/${p.subjectId}`
  if (p.subjectType === "creator") return `/creators/${p.subjectId}`
  return `/candidates`
}

function actionText(p: AgentProposal) {
  if (p.kind === "pitch") return `${p.action} → ${p.recipient}`
  if (p.kind === "candidate_decision") return p.action === "approve" ? "Approve into roster" : "Reject"
  if (p.action === "follow_up") return `Follow-up email → ${p.recipient}`
  if (p.action === "mark_cold") return "Mark cold"
  return `Move to ${p.toStage}`
}

export function ProposalCard({ proposal: p }: { proposal: AgentProposal }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [subject, setSubject] = useState(p.subject ?? "")
  const [body, setBody] = useState(p.body ?? "")
  const [note, setNote] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const hasMessage = p.body != null
  const evidence: string[] = p.evidenceUrls ? JSON.parse(p.evidenceUrls) : []

  const act = (decision: "approve" | "reject") =>
    start(async () => {
      const r = await decide(p.id, { decision, subject: hasMessage ? subject : undefined, body: hasMessage ? body : undefined, note: note || null })
      setMsg(r.result)
      if (r.ok) router.refresh()
    })

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">{KIND_LABEL[p.kind] ?? p.kind}</Badge>
        <Link href={subjectHref(p)} className="font-medium hover:underline">{p.subjectName}</Link>
        {p.confidence != null && <span className="ml-auto text-xs tabular-nums text-zinc-500">confidence {(p.confidence * 100).toFixed(0)}%</span>}
      </div>
      <div className="text-sm font-medium">{actionText(p)}</div>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400"><span className="font-medium text-zinc-800 dark:text-zinc-200">Why </span>{p.rationale}</p>

      {hasMessage && (
        <div className="space-y-2">
          {(p.action === "email" || p.action === "follow_up") && (
            <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject"
              className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
          )}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} aria-label="Message"
            className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 dark:border-zinc-800 dark:bg-zinc-900" />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{body.length} chars{body !== (p.body ?? "") || subject !== (p.subject ?? "") ? " · edited" : ""}</span>
            <button className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => navigator.clipboard.writeText(body)}>
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
        </div>
      )}

      {evidence.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">Evidence used ({evidence.length})</summary>
          <ul className="mt-1 space-y-0.5">{evidence.map((u) => <li key={u} className="truncate"><a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a></li>)}</ul>
        </details>
      )}

      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Review note"
        className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-900" />
      <div className="flex gap-2">
        <Button size="sm" variant="success" disabled={pending} onClick={() => act("approve")}>
          <Check className="h-3.5 w-3.5" /> {p.kind === "pitch" && p.action === "email" ? "Approve & send" : p.action === "follow_up" ? "Approve & send" : "Approve"}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("reject")}>
          <X className="h-3.5 w-3.5" /> Reject
        </Button>
      </div>
      {msg && <p className="text-xs text-zinc-600 dark:text-zinc-300">{msg}</p>}
    </div>
  )
}
