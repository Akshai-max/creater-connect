"use client"
import { useState, useTransition, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { addTag, removeTag } from "./[id]/actions"
import { Plus, X } from "lucide-react"

export function RosterTagsCell({ creatorId, tags, suggestions }: { creatorId: string; tags: string[]; suggestions: string[] }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const filteredSuggestions = suggestions
    .filter((s) => !tags.includes(s))
    .filter((s) => s.includes(input.toLowerCase()))
    .slice(0, 8)

  const submit = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    startTransition(async () => {
      await addTag(creatorId, trimmed)
      setInput("")
      router.refresh()
    })
  }

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1 flex-wrap">
      {tags.slice(0, 3).map((t) => (
        <span key={t} className="group/tag inline-flex items-center gap-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] hover:bg-zinc-200 dark:hover:bg-zinc-700">
          #{t}
          <button
            disabled={pending}
            onClick={(e) => {
              e.stopPropagation()
              startTransition(async () => {
                await removeTag(creatorId, t)
                router.refresh()
              })
            }}
            className="opacity-0 group-hover/tag:opacity-100 ml-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {tags.length > 3 && <span className="text-zinc-400 text-[10px]">+{tags.length - 3}</span>}
      <button
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        title="Add tag"
      >
        <Plus className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 w-48 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-2">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value.toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(input); setOpen(false) }
              if (e.key === "Escape") setOpen(false)
            }}
            placeholder="Add tag…"
            className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-zinc-400"
          />
          {filteredSuggestions.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto">
              {filteredSuggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { submit(s); setOpen(false) }}
                  className="block w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
          {input && !filteredSuggestions.includes(input) && (
            <div className="text-[10px] text-zinc-400 mt-1 px-1">Press Enter to create #{input}</div>
          )}
        </div>
      )}
    </div>
  )
}
