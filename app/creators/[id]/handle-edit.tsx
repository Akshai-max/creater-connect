"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateHandle, enrichOne } from "./actions"
import { Pencil, Check, X, Sparkles, ExternalLink } from "lucide-react"

export function HandleEdit({
  creatorId,
  currentHandle,
  currentPlatform,
  profileUrl,
}: {
  creatorId: string
  currentHandle: string | null
  currentPlatform: string | null
  profileUrl: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [handle, setHandle] = useState(currentHandle?.replace("@", "") ?? "")
  const [platform, setPlatform] = useState(currentPlatform ?? "IG")
  const [pending, startTransition] = useTransition()
  const [enrichResult, setEnrichResult] = useState<string | null>(null)
  const router = useRouter()

  const save = () => {
    startTransition(async () => {
      await updateHandle(creatorId, handle, platform)
      setEditing(false)
      router.refresh()
    })
  }

  const reEnrich = () => {
    setEnrichResult(null)
    startTransition(async () => {
      const r = await enrichOne(creatorId)
      setEnrichResult(r.ok ? `✓ Filled: ${r.filled.join(", ")}` : `× ${r.reason}`)
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs"
        >
          <option value="IG">IG</option>
          <option value="TikTok">TikTok</option>
          <option value="YouTube">YouTube</option>
        </select>
        <span className="text-sm text-zinc-500">@</span>
        <input
          autoFocus
          value={handle}
          onChange={(e) => setHandle(e.target.value.replace("@", "").trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") save()
            if (e.key === "Escape") setEditing(false)
          }}
          placeholder="handle"
          className="h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-sm w-40"
        />
        <button onClick={save} disabled={pending} className="h-7 px-2 rounded bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 text-xs hover:bg-zinc-800 dark:hover:bg-zinc-200">
          <Check className="h-3 w-3" />
        </button>
        <button onClick={() => setEditing(false)} disabled={pending} className="h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {currentHandle && (
        <span className="text-sm text-zinc-500">{currentHandle}</span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        title="Edit handle"
      >
        <Pencil className="h-3 w-3" />
      </button>
      {profileUrl && (
        <a href={profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          profile <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {currentHandle && currentPlatform?.toLowerCase() === "ig" && (
        <button
          onClick={reEnrich}
          disabled={pending}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          title="Pull fresh data from Apify"
        >
          <Sparkles className={`h-3 w-3 ${pending ? "animate-pulse" : ""}`} />
          {pending ? "enriching…" : "re-enrich"}
        </button>
      )}
      {enrichResult && (
        <span className={`text-[10px] ${enrichResult.startsWith("✓") ? "text-emerald-600" : "text-amber-600"}`}>
          {enrichResult}
        </span>
      )}
    </div>
  )
}
