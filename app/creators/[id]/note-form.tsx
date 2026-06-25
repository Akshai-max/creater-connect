"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { addNote } from "./actions"
import { Button } from "@/components/ui/button"
import { Send } from "lucide-react"

export function NoteForm({ creatorId }: { creatorId: string }) {
  const [body, setBody] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const submit = () => {
    if (!body.trim()) return
    startTransition(async () => {
      await addNote(creatorId, body)
      setBody("")
      router.refresh()
    })
  }

  return (
    <div className="flex gap-2 items-end">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note (timestamped, logged to timeline)…"
        rows={2}
        className="flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 resize-none"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit()
        }}
      />
      <Button onClick={submit} disabled={pending || !body.trim()} size="sm">
        <Send className="h-3.5 w-3.5" /> Add note
      </Button>
    </div>
  )
}
