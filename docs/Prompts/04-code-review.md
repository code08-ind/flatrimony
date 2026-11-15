# Template 04 — Code Review

**Purpose:** Comprehensive, structured code review covering correctness, security, performance, accessibility, type safety, test coverage, naming, and architecture.  
**Use for:** PRs before merging, code you wrote yourself (self-review), inherited code you're taking ownership of.

---

````text
## Code Review Request

### Code to Review:
[REQUIRED: Paste the code OR specify file paths]

```typescript
// [paste code here]
```

### Context:
[REQUIRED: What does this code do? Why was it written?]

### Change Type:
[ ] New feature  [ ] Bug fix  [ ] Refactor  [ ] Performance  [ ] Security  [ ] Dependency update  [ ] Other: ___

### Review Focus:
[OPTIONAL: Is there a particular area you're most concerned about?]
Example: "I'm most worried about the async state management and whether there are race conditions."

### Codebase Context:
[OPTIONAL: Relevant conventions or patterns this code must follow]
- [e.g., We use Zod for all input validation]
- [e.g., Errors must be typed — no throwing bare strings]

---

## Review Criteria

Evaluate the code against each of the following dimensions. For each, provide:
- A rating: ✅ Good / ⚠️ Minor concern / ❌ Must fix
- Specific findings with line references where applicable

---

### 1. Correctness
- Does the code do what it claims to do?
- Are all edge cases handled? (empty arrays, null/undefined, empty strings, zero, negative numbers, concurrent calls)
- Are all error paths handled?
- Are there any off-by-one errors?
- Does async code handle rejection?
- Is cleanup performed (event listeners, timers, subscriptions)?

### 2. Security
Evaluate against the OWASP Top 10:2025:
- [ ] A01 Broken Access Control — Is authorization checked on every action? Are user-supplied URLs fetched server-side (SSRF)?
- [ ] A02 Security Misconfiguration — Are defaults safe? Are errors and debug output hidden in production?
- [ ] A03 Software Supply Chain Failures — Are new dependencies vetted? Is the lockfile updated deliberately?
- [ ] A04 Cryptographic Failures — Are secrets kept out of code and client bundles? Is sensitive data encrypted?
- [ ] A05 Injection — Are inputs parameterized or escaped before use in SQL, HTML, or shell?
- [ ] A06 Insecure Design — Does the design make security mistakes easy?
- [ ] A07 Authentication Failures — Are sessions, tokens, and credentials handled correctly?
- [ ] A08 Software or Data Integrity Failures — Is untrusted data validated before deserialization or use?
- [ ] A09 Security Logging and Alerting Failures — Are security events logged without exposing PII or secrets?
- [ ] A10 Mishandling of Exceptional Conditions — Do errors fail closed, without leaking internals?

### 3. Performance
- Are there N+1 query patterns?
- Are expensive operations memoized where appropriate?
- Are there unnecessary re-renders (in React code)?
- Are large data sets paginated or streamed?
- Are there blocking synchronous operations on a hot path?
- Is the bundle impact acceptable?

### 4. Accessibility (for UI code)
- [ ] All interactive elements are keyboard-reachable
- [ ] All interactive elements have accessible names (aria-label, aria-labelledby, or visible label)
- [ ] Focus management is correct (modals trap focus, focus returns after close)
- [ ] Color is not the only means of conveying information
- [ ] All images have alt text
- [ ] ARIA roles are used correctly (no `role="button"` on a non-interactive element)
- [ ] Error messages are announced to screen readers

### 5. Type Safety (TypeScript)
- [ ] No `any` — use `unknown` with type guards
- [ ] No type assertions (`as SomeType`) without explanation
- [ ] No non-null assertions (`!`) without explanation
- [ ] Return types are explicit on exported functions
- [ ] Discriminated unions used where appropriate
- [ ] Generics are constrained, not open-ended

### 6. Test Coverage
- Are happy paths tested?
- Are error paths tested?
- Are edge cases tested?
- Do tests cover behaviour, not implementation?
- Are tests independent (no shared mutable state between tests)?
- Are tests readable — does the test name describe the scenario?

### 7. Naming and Readability
- Do variable and function names convey intent?
- Are boolean variables named as predicates (`isLoading`, `hasError`)?
- Are functions named as actions (`fetchUser`, `calculateTotal`)?
- Is there unexplained "magic" (numbers, strings) that should be named constants?
- Is the code's intent clear without needing comments?
- Where comments DO exist, are they explaining WHY, not WHAT?

### 8. Architecture Alignment
- Does this code follow existing patterns in the codebase?
- Does it introduce a new pattern? If so, is it justified?
- Is there coupling that could be avoided?
- Does this belong in the right layer (UI / business logic / data access)?
- Is there code that should be extracted into a shared utility?
- Does this make the codebase harder to test or modify in the future?

---

## Output Format

Provide findings in this structure:

```markdown
## Code Review: [change description]

### Overall: [✅ Approve / ⚠️ Approve with suggestions / ❌ Request Changes]

---

### Critical Issues (must fix before merge)
[If none: "None"]
- **[Category]** `[file:line]`: [description] — [suggested fix]

### Major Issues (should fix, may block depending on context)
[If none: "None"]
- **[Category]** `[file:line]`: [description] — [suggested fix]

### Minor Issues (fix when convenient)
[If none: "None"]
- **[Category]** `[file:line]`: [description] — [suggested fix]

### Nits (optional polish)
[If none: "None"]
- `[file:line]`: [description]

---

### Dimension Ratings
| Dimension | Rating | Notes |
|-----------|--------|-------|
| Correctness | ✅/⚠️/❌ | |
| Security | ✅/⚠️/❌ | |
| Performance | ✅/⚠️/❌ | |
| Accessibility | ✅/⚠️/❌ | |
| Type Safety | ✅/⚠️/❌ | |
| Test Coverage | ✅/⚠️/❌ | |
| Naming/Readability | ✅/⚠️/❌ | |
| Architecture | ✅/⚠️/❌ | |

---

### What's Done Well
[2-5 specific things that are implemented correctly and worth calling out positively]
```

---

Now begin the review of the code provided above.
````

---

## Notes

- Always include "What's Done Well" — code review culture improves when positives are explicit.
- Critical vs. Major distinction: Critical means the code should not ship as-is (data loss, security vulnerability, incorrect behaviour). Major means it's a significant problem but context may determine urgency.
- Nits are optional — the reviewer should call them out but the author can choose to skip them.
