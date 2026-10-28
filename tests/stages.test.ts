import { test } from "node:test"
import assert from "node:assert/strict"
import { stageAfterOutreach } from "../lib/stages"

test("outreach status moves the pipeline stage forward only", () => {
  assert.equal(stageAfterOutreach("Lead", "sent"), "Outreached")
  assert.equal(stageAfterOutreach("Outreached", "sent"), null)
  assert.equal(stageAfterOutreach("Outreached", "replied"), "Replied")
  assert.equal(stageAfterOutreach("Lead", "replied"), "Replied")
  assert.equal(stageAfterOutreach("Outreached", "cold"), "Cold")
  assert.equal(stageAfterOutreach("Replied", "cold"), "Cold")
  // Further along: an old pitch never pulls a creator back.
  for (const s of ["Negotiating", "Briefed", "Content In", "Live", "Paid", "Past Hire"]) {
    assert.equal(stageAfterOutreach(s, "cold"), null, s)
    assert.equal(stageAfterOutreach(s, "replied"), null, s)
  }
  assert.equal(stageAfterOutreach(null, "sent"), "Outreached") // missing stage = Lead
})
