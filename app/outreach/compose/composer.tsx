"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Sparkles, Send, Save, Mail, AlertCircle } from "lucide-react"
import { draftOutreach, sendOutreach } from "../actions"

type Creator = { id: string; name: string; handle: string | null; email: string | null }

export function Composer({ creators, initialCreatorId }: { creators: Creator[]; initialCreatorId: string }) {
  const router = useRouter()
  const [creatorId, setCreatorId] = useState(initialCreatorId)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [campaignBrief, setCampaignBrief] = useState("")
  const [drafting, startDrafting] = useTransition()
  const [sending, startSending] = useTransition()
  const [draftSource, setDraftSource] = useState<"ai" | "template" | null>(null)
  const [draftModel, setDraftModel] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; sent: boolean; error?: string } | null>(null)

  const selected = creators.find((c) => c.id === creatorId)
  const [recipientEmail, setRecipientEmail] = useState(creators.find((c) => c.id === initialCreatorId)?.email ?? "")

  function handleCreatorChange(id: string) {
    setCreatorId(id)
    setResult(null)
    const c = creators.find((cr) => cr.id === id)
    setRecipientEmail(c?.email ?? "")
  }

  function generate() {
    if (!creatorId) return
    setResult(null)
    startDrafting(async () => {
      const draft = await draftOutreach(creatorId, campaignBrief || undefined)
      setSubject(draft.subject)
      setBody(draft.body)
      setDraftSource(draft.source)
      setDraftModel(draft.model ?? null)
    })
  }

  function send(saveDraftOnly: boolean) {
    if (!creatorId || !subject.trim() || !body.trim()) return
    setResult(null)
    startSending(async () => {
      const r = await sendOutreach({ creatorId, subject, body, toEmail: recipientEmail.trim() || undefined, saveDraftOnly })
      setResult({ ok: r.ok, sent: r.sent, error: r.error })
      if (r.sent) {
        setTimeout(() => router.push("/outreach"), 800)
      }
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Recipient</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select
            value={creatorId}
            onChange={(e) => handleCreatorChange(e.target.value)}
            className="w-full h-9 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 text-sm"
          >
            <option value="">— select a creator —</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.handle ? `(${c.handle})` : ""} {c.email ? "📧" : ""}
              </option>
            ))}
          </select>
          {selected && (
            <div className="space-y-1.5 pt-1">
              <div className="text-xs text-zinc-500 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                <span>Recipient Email</span>
              </div>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="creator@example.com"
                className="h-8 text-sm"
              />
              {!recipientEmail && (
                <div className="text-xs text-amber-600">No email on file — will save as draft</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Optional: campaign brief</CardTitle></CardHeader>
        <CardContent>
          <textarea
            value={campaignBrief}
            onChange={(e) => setCampaignBrief(e.target.value)}
            rows={2}
            placeholder="e.g. Spring launch — looking for 2 short demos + 4 stills, 90-day usage, $200 + product…"
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
          />
          <Button
            onClick={generate}
            disabled={!creatorId || drafting}
            variant="secondary"
            className="mt-3"
          >
            <Sparkles className="h-4 w-4" /> {drafting ? "Drafting…" : "Generate with AI"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Pitch</span>
            {draftSource && (
              <span className={`text-xs font-normal ${draftSource === "ai" ? "text-emerald-600" : "text-amber-600"}`}>
                drafted via {draftSource === "ai" ? (draftModel ?? "AI") : "template (no API key)"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Subject</div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line…" />
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Body</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Email body — write or use 'Generate with AI' above"
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm resize-y font-sans focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
            />
            <div className="text-[10px] text-zinc-400 mt-1">{body.split(/\s+/).filter(Boolean).length} words · {body.length} chars</div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className={result.ok && result.sent ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"}>
          <CardContent className="p-4 text-sm flex items-start gap-2">
            {result.sent ? (
              <>✅ Sent! Redirecting to outreach list…</>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  Saved as draft.{result.error && <> Reason: <span className="font-mono">{result.error}</span></>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button onClick={() => send(false)} disabled={sending || !creatorId || !subject.trim() || !body.trim()}>
          <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send pitch"}
        </Button>
        <Button onClick={() => send(true)} disabled={sending || !creatorId || !subject.trim() || !body.trim()} variant="outline">
          <Save className="h-4 w-4" /> Save as draft
        </Button>
      </div>
    </div>
  )
}
