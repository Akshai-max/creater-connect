"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { addTag, removeTag } from "./actions"
import { X } from "lucide-react"

export function TagInput({ creatorId, tags }: { creatorId: string; tags: { id: string; name: string }[] }) {
  const [input, setInput] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs">
          #{t.name}
          <button
            onClick={() => startTransition(async () => {
              await removeTag(creatorId, t.name)
              router.refresh()
            })}
            disabled={pending}
            className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            const name = input
            setInput("")
            startTransition(async () => {
              await addTag(creatorId, name)
              router.refresh()
            })
          }
        }}
        placeholder="+ tag"
        className="text-xs bg-transparent outline-none placeholder:text-zinc-400 w-24"
      />
    </div>
  )
}
