import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function relativeDate(d: Date | string | null | undefined): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days < 0) {
    // Future dates (e.g. a task due date): count calendar days ahead.
    const ahead = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    if (ahead <= 0) return "today"
    if (ahead === 1) return "tomorrow"
    return `in ${ahead}d`
  }
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
