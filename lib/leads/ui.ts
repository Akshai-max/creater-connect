export const statusVariant = (s: string) => (s === "qualified" ? "success" : s === "rejected" ? "danger" : "warn") as "success" | "danger" | "warn"

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
