// Small circular avatar with initials fallback. Instagram CDN blocks direct browser
// loads, so when we have a creatorId/candidateId we proxy through /api/avatar/...
"use client"
import { useState } from "react"
import { cn } from "@/lib/utils"

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?"
}

const PALETTE = [
  "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
  "bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-200",
  "bg-pink-100 text-pink-900 dark:bg-pink-900/30 dark:text-pink-200",
]

function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

type Props = {
  name: string
  url?: string | null
  /** Set this OR creatorId/candidateId. When `creatorId`/`candidateId` is set,
   *  we proxy through /api/avatar/... to bypass IG CDN browser blocks. */
  creatorId?: string
  candidateId?: string
  size?: "xs" | "sm" | "md" | "lg"
  className?: string
}

const SIZE: Record<NonNullable<Props["size"]>, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-base",
}

export function Avatar({ name, url, creatorId, candidateId, size = "sm", className }: Props) {
  const [errored, setErrored] = useState(false)
  const sizeCls = SIZE[size]

  // Pick the source: prefer the proxy when we have an id + a stored url
  let src: string | null = null
  if (url) {
    if (creatorId) src = `/api/avatar/creator/${creatorId}`
    else if (candidateId) src = `/api/avatar/candidate/${candidateId}`
    else src = url
  }

  if (!src || errored) {
    return (
      <div className={cn("rounded-full flex items-center justify-center font-semibold shrink-0 select-none", sizeCls, colorFor(name), className)}>
        {initials(name)}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setErrored(true)}
      className={cn("rounded-full object-cover shrink-0", sizeCls, className)}
      loading="lazy"
    />
  )
}
