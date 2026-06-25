// Central brand configuration — this is the ONE place to describe your brand.
// Everything else (AI scoring, outreach drafts, UI labels) reads from here.
// Override any of these via environment variables; sensible neutral defaults
// keep the template working out of the box.

// Display name shown in the UI and used in outreach.
export const BRAND_NAME = process.env.BRAND_NAME?.trim() || "Acme"

// The kind of creators you want to work with. Used by the fit scorer and
// quality filters. e.g. "home fitness", "skincare", "pet products".
export const TARGET_NICHE = process.env.TARGET_NICHE?.trim() || "your product category"

// A short paragraph describing your brand, products, and positioning.
// The AI scoring + outreach prompts inject this verbatim, so be specific:
// what you sell, who it's for, price point, and what makes a creator a good fit.
// Set BRAND_CONTEXT in .env.local for best results.
export const BRAND_CONTEXT =
  process.env.BRAND_CONTEXT?.trim() ||
  `${BRAND_NAME} is a consumer brand that partners with content creators for paid social and UGC. ` +
    `We look for creators in the ${TARGET_NICHE} space with engaged, authentic audiences. ` +
    `(Set BRAND_CONTEXT in your environment to replace this with a real description of your brand and products.)`
