"use client"
import { useState } from "react"
import { Check, Copy } from "lucide-react"

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/60 px-2.5 py-1 font-mono text-xs hover:bg-amber-100 dark:border-amber-500/30 dark:hover:bg-amber-500/20"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  )
}
