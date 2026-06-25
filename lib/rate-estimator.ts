// Estimated price band per creator, based on follower tier × persona type.
// Defaults reflect the 2026 UGC/influencer market — tune these to your own historical rates.

type Input = {
  followers?: number | null
  flagNotes?: string | null
  persona?: string | null
  platform?: string | null
}

export type RateEstimate = {
  low: number
  high: number
  band: string // "$50-$200"
  basis: string // "UGC creator, 5k-10k tier"
  confidence: "low" | "medium" | "high"
}

export function estimateRate(c: Input): RateEstimate {
  const fc = c.followers ?? 0
  const notes = (c.flagNotes ?? "").toLowerCase()
  const platform = (c.platform ?? "").toLowerCase()

  // Pull out the "Type: ..." tag your roster uses
  const typeMatch = (c.flagNotes ?? "").match(/Type:\s*([^|]+)/i)?.[1]?.trim() ?? ""
  const type = typeMatch.toLowerCase()

  // Authority/Expert: credentialed or notable voices — credential-priced, not follower-priced
  if (/authority|endorsement|expert/.test(type) || /expert|founder|md\b/.test(notes)) {
    if (fc >= 50_000) return { low: 500, high: 2000, band: "$500-$2,000", basis: "Authority/Endorsement, larger audience", confidence: "medium" }
    return { low: 200, high: 800, band: "$200-$800", basis: "Authority/Endorsement, credential-driven", confidence: "medium" }
  }

  // Long-form reviewers — integrated review/demo premium
  if (/youtube|long.?form|reviewer/.test(type) || platform === "youtube") {
    if (fc < 10_000) return { low: 200, high: 500, band: "$200-$500", basis: "Long-form reviewer, nano", confidence: "medium" }
    if (fc < 100_000) return { low: 500, high: 1500, band: "$500-$1,500", basis: "Long-form reviewer, micro", confidence: "high" }
    return { low: 1000, high: 3000, band: "$1,000-$3,000", basis: "Long-form reviewer, mid+", confidence: "medium" }
  }

  // Rockstar — actor/notable model, name carries
  if (/rockstar/.test(type)) {
    if (fc < 50_000) return { low: 300, high: 800, band: "$300-$800", basis: "Rockstar persona, micro", confidence: "low" }
    return { low: 800, high: 2500, band: "$800-$2,500", basis: "Rockstar persona, mid+", confidence: "low" }
  }

  // YT Review or Unboxing — slightly lower than a dedicated long-form reviewer
  if (/yt review|unboxing/.test(type)) {
    if (fc < 10_000) return { low: 150, high: 400, band: "$150-$400", basis: "YT review/unboxing", confidence: "medium" }
    return { low: 400, high: 1200, band: "$400-$1,200", basis: "YT review/unboxing, larger", confidence: "medium" }
  }

  // UGC Creator — the default for most of the roster. Pure follower-tier pricing.
  if (fc < 1_000)   return { low: 50,  high: 100,  band: "$50-$100",   basis: "Nano UGC (<1k followers)",    confidence: "low" }
  if (fc < 5_000)   return { low: 50,  high: 150,  band: "$50-$150",   basis: "Nano UGC (1k-5k)",            confidence: "high" }
  if (fc < 10_000)  return { low: 100, high: 250,  band: "$100-$250",  basis: "Nano UGC (5k-10k)",           confidence: "high" }
  if (fc < 30_000)  return { low: 150, high: 500,  band: "$150-$500",  basis: "Micro UGC (10k-30k)",         confidence: "high" }
  if (fc < 100_000) return { low: 300, high: 900,  band: "$300-$900",  basis: "Micro UGC (30k-100k)",        confidence: "high" }
  if (fc < 500_000) return { low: 800, high: 2500, band: "$800-$2,500", basis: "Mid-tier (100k-500k)",       confidence: "medium" }
  return { low: 2000, high: 5000, band: "$2,000-$5,000", basis: "Macro (500k+)", confidence: "low" }
}

// Format the estimate for the UI, picking actual rateCeiling over estimate when known.
export function displayPrice(c: Input & { rateCeiling?: number | null }): {
  primary: string
  secondary: string
  source: "actual" | "estimate"
} {
  if (c.rateCeiling && c.rateCeiling > 0) {
    return {
      primary: `$${c.rateCeiling.toLocaleString()}`,
      secondary: "actual ceiling",
      source: "actual",
    }
  }
  const est = estimateRate(c)
  return {
    primary: est.band,
    secondary: `est · ${est.basis}`,
    source: "estimate",
  }
}
