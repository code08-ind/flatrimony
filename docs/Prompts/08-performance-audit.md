# Template 08 — Performance Audit

**Purpose:** Systematically identify and prioritize performance bottlenecks across bundle size, render performance, network, database queries, and caching.  
**Chain with:** `05-refactor-safely.md` (for safe implementation of performance fixes).

---

````text
## Performance Audit

### Application Context:
[REQUIRED: What type of application and what performance problems are you observing?]
Example: "DevLens Chrome extension DevTools panel — the panel takes 3-4 seconds to become interactive when a React app with 200+ components is loaded. Scrolling the component tree is janky at 15fps."

### Performance Targets:
[REQUIRED: What "good" looks like — define measurable goals]
- [e.g., Core Web Vitals at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1]
- [e.g., Panel responds to the first click within 1 s of opening]
- [e.g., Component tree scroll at stable 60fps]
- [e.g., API response time p50 < 50ms, p99 < 200ms]
- [e.g., Lighthouse Performance score ≥ 90]
- [e.g., Bundle size < 500KB gzipped]

### Current Metrics (if known):
[OPTIONAL: Paste existing profiler data, Lighthouse report, bundle analysis, etc.]

### Environment:
- Device: [REQUIRED: e.g., M3 MacBook / Pixel 7 / mid-range Android]
- Browser: [REQUIRED: exact version from chrome://version or equivalent]
- Network: [OPTIONAL: e.g., Throttled to Fast 3G]
- Data size: [OPTIONAL: e.g., 200 components, 10K data rows]

---

## Audit Dimensions

Work through each applicable dimension. Skip dimensions marked `[N/A]` with a reason.

---

### Dimension 1: Bundle Size Analysis

Identify what's contributing to bundle size:

1. Run: `pnpm build && npx vite-bundle-visualizer` (or equivalent)
2. List the top 10 largest modules by size
3. For each large module:
   - Is it used? Could it be tree-shaken?
   - Is there a smaller alternative?
   - Can it be lazy-loaded / code-split?
   - Is it duplicated (same package multiple versions)?

```
| Module | Size (gzipped) | Used? | Action |
|--------|---------------|-------|--------|
| [name] | [X KB] | [yes/no] | [remove/lazy-load/replace/keep] |
```

**Opportunities:**
- [ ] Dynamic imports for routes/heavy components (`React.lazy`)
- [ ] Replace heavy dependencies (e.g., `moment.js` → `date-fns`, `lodash` → native)
- [ ] Remove unused exports from index files
- [ ] Ensure dev-only dependencies are not bundled in production

---

### Dimension 2: Rendering Performance (UI)

**For React applications:**

1. Open React DevTools Profiler. Record an interaction that feels slow.
2. Identify components that render more than needed:
   - Components that render on every parent render without prop changes
   - Components with expensive render functions
   - Lists without virtualization

3. Check for these anti-patterns:
```
Anti-patterns to find:
[ ] Object/array literals created inline in JSX props (new ref every render)
[ ] Functions created inline in JSX (new ref every render)
[ ] useEffect with missing or overly broad dependency array
[ ] State that could be derived during render is instead synced with useEffect (extra render passes)
[ ] Synchronous expensive computation in render (should be memoized)
[ ] Large lists rendered without windowing (react-window / tanstack-virtual)
[ ] Context with high-frequency updates (splits consumers into separate contexts)
```

4. For each issue found, provide:
```
Issue: [description]
Component: [name]
Impact: [how many unnecessary renders per interaction]
Fix: [specific code change — useMemo / useCallback / memo / split context / virtualize]
Effort: [Low / Medium / High]
```

---

### Dimension 3: Network Performance

Audit network waterfall:

1. Open DevTools Network panel. Record the critical user flow.
2. Identify:
   - **Render-blocking requests**: resources that delay first paint
   - **Waterfall chains**: request B can only start after request A
   - **Over-fetching**: more data than needed is returned
   - **Under-fetching**: multiple requests needed to display one view
   - **Missing caching**: frequently-fetched resources with no cache headers

3. For each issue:
```
Issue: [description]
Request: [URL or description]
Current behaviour: [e.g., "3 sequential API calls before dashboard renders"]
Fix: [e.g., "Combine into a single /dashboard endpoint" or "Prefetch on hover"]
HTTP caching opportunity: [Cache-Control: max-age=X or s-maxage=X]
```

4. Check:
- [ ] Images are sized correctly (no 2x images for 1x contexts)
- [ ] Images use modern formats (WebP / AVIF)
- [ ] Static assets have long-lived cache headers with content hashing
- [ ] API responses include appropriate `Cache-Control` headers
- [ ] GraphQL queries request only needed fields

---

### Dimension 4: Database Query Performance

Audit database queries:

1. Enable query logging with execution times.
2. Run the most common user flows and capture all queries.
3. For each slow query (threshold: > 50ms):

```
Query: [SQL or ORM method]
Execution time: [Xms]
EXPLAIN ANALYZE output: [paste here if available]

Issues found:
[ ] Sequential scan on large table (missing index)
[ ] N+1 pattern (found in code at: [location])
[ ] Fetching more columns than needed (SELECT * anti-pattern)
[ ] Missing join condition (cartesian product)
[ ] Non-sargable WHERE clause (function applied to indexed column)

Fix: [index to add / query to rewrite / eager load to add]
Expected improvement: [estimate]
```

4. Check for N+1 patterns in ORM code:
```typescript
// N+1 PROBLEM: runs 1 query for users + N queries for each user's posts
const users = await db.user.findMany();
for (const user of users) {
  user.posts = await db.post.findMany({ where: { userId: user.id } });
}

// FIX: eager-load the relation (one extra query or a JOIN, depending on the ORM)
const users = await db.user.findMany({ include: { posts: true } });
```

---

### Dimension 5: Caching Opportunities

Identify data that is fetched repeatedly but changes infrequently:

```
Data: [description]
Fetch frequency: [e.g., every page load]
Change frequency: [e.g., changes once per hour]
Current caching: [none / browser cache / CDN / in-memory]
Recommended cache: [strategy + TTL]
Invalidation: [when should the cache be invalidated?]
```

Caching layers to consider:
- Browser memory (React Query / SWR `staleWhileRevalidate`)
- Browser storage (localStorage / IndexedDB for offline)
- Service worker cache
- CDN / edge cache (for public API responses)
- Application cache (Redis / in-memory for server-side)

---

## Output Format

```markdown
## Performance Audit Report

### Current State
| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| [metric] | [value] | [target] | [diff] |

### Priority Issues

#### 🔴 Critical (fix now — blocking targets)
1. [Issue]: [description]
   - Impact: [quantified]
   - Fix: [specific recommendation]
   - Effort: [hours/days]

#### 🟡 Major (fix this sprint)
1. [Issue]: [description]
   ...

#### 🟢 Minor (backlog)
1. [Issue]: [description]
   ...

### Recommended Fix Order
1. [Fix 1] — [expected improvement] — [effort]
2. [Fix 2] — [expected improvement] — [effort]
...

### Quick Wins (< 1 hour each)
- [Action that takes < 1 hour and has measurable impact]

### How to Verify Improvements
[Specific measurement steps to confirm each fix worked]
```

---

Begin with the dimensions most relevant to the performance problem described. State which dimensions you are auditing and why.
````

---

## Notes

- Always measure before and after each fix. Intuition about performance is often wrong.
- Fix the biggest impact items first, not the easiest ones.
- For render performance, the React DevTools Profiler is more reliable than `console.time` — it shows which specific components are slow.
- Lighthouse and DevTools are lab measurements. Confirm wins with real-user data (the `web-vitals` library or the Chrome UX Report) before declaring a Core Web Vitals target met.
