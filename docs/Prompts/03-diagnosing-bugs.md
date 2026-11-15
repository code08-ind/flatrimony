# Template 03 — Diagnosing Bugs

**Purpose:** Structured root-cause analysis that prevents random code thrashing.  
**Chain with:** `02-tdd-implementation.md` (write the regression test first, then the fix), `04-code-review.md` (review the fix).

---

````text
## Bug Report

### Description:
[REQUIRED: What is broken? What is the observable symptom?]
Example: "The DevTools panel shows stale render counts after navigating to a new page without reloading the extension."

### Environment:
- OS: [REQUIRED: e.g., macOS 14.4 / Windows 11 / Ubuntu 22]
- Browser: [REQUIRED: e.g., Chrome 124.0.6367.62]
- App version / commit: [OPTIONAL: e.g., v0.3.1 / abc1234]
- Node/runtime version: [OPTIONAL]

### Steps to Reproduce:
[REQUIRED: Numbered steps that reliably trigger the bug]
1. [Step 1]
2. [Step 2]
3. [Step 3]
→ Expected: [what should happen]
→ Actual: [what actually happens]

### Frequency:
[REQUIRED: e.g., 100% reproducible / intermittent ~30% / only in production]

### Error Messages / Logs:
[OPTIONAL: Paste any console errors, stack traces, or logs]
```
[paste here]
```

### Relevant Code:
[OPTIONAL: Paste the code you suspect is involved]
```typescript
// [paste code here]
```

---

## Debugging Protocol

Work through this protocol in order. Do NOT skip phases.

---

### Phase 1: Reproduce

Your first job is to **reliably reproduce** the bug.

1. Review the steps to reproduce above.
2. Identify the **minimal scenario** that triggers the bug.
3. Confirm: Can this bug be reproduced with a minimal test case? (e.g., a single failing test)
4. If the bug is not yet reproducible with a test, write a test that SHOULD pass but DOESN'T.

Output:
```typescript
// Failing test that captures the bug
it('should [expected behaviour]', () => {
  // ...
});
// Error when run: [paste the actual error]
```

**Gate: Do not proceed to Phase 2 until there is a reproducible test or reproducible manual steps.**

---

### Phase 2: Minimize

**Remove every variable that is not essential to reproducing the bug.**

Questions to answer:
- What is the simplest code path that triggers this?
- Does it happen with a single component or require multiple?
- Does it happen without the database / API / external service?
- Does it happen on `main` or only on this branch?

Output: A minimal reproduction — the fewest lines of code / steps that still trigger the bug.

---

### Phase 3: Hypotheses

**Form 3 to 5 falsifiable hypotheses** for the root cause.

Rules for good hypotheses:
- Each must be FALSIFIABLE (there must be an experiment that could prove it wrong)
- Each must be SPECIFIC (not "something is wrong with state management" — name the mechanism)
- Rank by probability (most likely first)

Format:
```
Hypothesis 1 (Most likely): [Specific claim about root cause]
  - Evidence for: [what makes you think this]
  - Evidence against: [what contradicts this]
  - Test: [exactly how to confirm or refute this hypothesis]

Hypothesis 2: [...]
  - Evidence for: [...]
  - Evidence against: [...]
  - Test: [...]

[...up to 5]
```

**Gate: Do not begin testing until all hypotheses are written.**

---

### Phase 4: Probe (One Variable at a Time)

Test hypotheses starting with the most likely. **Change exactly ONE thing per probe.**

For each probe:
1. State which hypothesis you are testing
2. Describe the change you are making
3. Add a debug log tagged `[DEBUG-XXXX]` (use a random 4-letter code) at the exact point of interest
4. Describe the expected result if this hypothesis IS the root cause
5. Describe the expected result if this hypothesis IS NOT the root cause
6. Run the probe and report the actual result

```typescript
// Example debug log:
console.log('[DEBUG-MRTZ] storeState at navigation:', JSON.stringify(state));
```

**Gate: Do not commit or ship any `[DEBUG-XXXX]` tags. They must be removed in Phase 5.**

---

### Phase 5: Fix, Verify, and Clean Up

Once the root cause is confirmed:

1. **Explain the root cause** in plain language (2-4 sentences)
2. **Propose a fix**: Show the exact code change. Explain WHY it fixes the root cause (not just what it changes).
3. **Regression test**: Write or update the test from Phase 1 so it passes with the fix and would fail without it.
4. **Check for related issues**: Is this root cause present anywhere else in the codebase? List any other affected locations.
5. **Remove all `[DEBUG-XXXX]` tags** before finalizing.
6. **Verify**: All tests pass, no new failures.

---

## Output Format

```markdown
## Bug Investigation Report

### Root Cause
[Plain language explanation of what was actually wrong]

### Fix
[Code change with explanation of why it works]

### Hypotheses Tested
| Hypothesis | Result |
|------------|--------|
| [H1] | ❌ Ruled out — [reason] |
| [H2] | ✅ Confirmed — [evidence] |

### Regression Test Added
`[path/to/test.ts]` — `[test description]`

### Related Locations
- [file:line] — [same issue exists here, fix: ...]

### Root Cause Category
[ ] Logic error  [ ] Race condition  [ ] Off-by-one  [ ] Missing cleanup
[ ] Wrong assumption about external API  [ ] State management  [ ] Other: ___
```

---

Begin Phase 1 now. Attempt to reproduce the bug with a minimal test or a minimal set of steps.
````

---

## Notes

- The most common debugging mistake is jumping to a fix before understanding the root cause. This template prevents that.
- If you're 3 hypotheses in and none have panned out, add more hypotheses — don't start guessing with code changes.
- `[DEBUG-XXXX]` tags are intentionally weird-looking so they're easy to grep and remove.
