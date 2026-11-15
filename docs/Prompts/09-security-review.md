# Template 09 — Security Review

**Purpose:** Security audit against the OWASP Top 10:2025, plus secrets handling, dependency and supply-chain checks, and browser-extension specifics.  
**Chain with:** `04-code-review.md` (broader code quality review), `03-diagnosing-bugs.md` (if a finding needs root-causing).

---

````text
## Security Review

### Application Context:
[REQUIRED: What are we auditing?]
Example: "The DevLens backend API that handles user authentication, workspace management, and metrics data storage. Public-facing REST API on Node.js/Express."

### Change Scope:
[REQUIRED: Are we reviewing a specific change, or a full system audit?]
- [ ] New feature (paste code below)
- [ ] Existing system audit (describe scope)
- [ ] Dependency update
- [ ] Infrastructure change
- [ ] Pre-launch security check

### Threat Model:
[REQUIRED: Who are the potential attackers? What are they after?]
- Attacker type: [e.g., External internet users / Malicious insiders / Automated bots]
- High-value targets: [e.g., User PII, API keys, payment data, admin functionality]
- Trust boundaries: [e.g., Extension ↔ Background Worker ↔ Backend API ↔ Database]

### Code / System to Review:
[OPTIONAL: Paste code or describe the system]

```typescript
// [paste code here]
```

---

## Security Audit

Evaluate each section. Mark each control: ✅ Implemented correctly / ⚠️ Partial / ❌ Missing or broken / N/A Not applicable.
Report a finding only when you can describe how an attacker reaches it. Label anything you could not confirm from the code as "unverified".

---

### OWASP Top 10:2025 Checklist

#### A01: Broken Access Control
- [ ] Every endpoint/action enforces authorization, not just authentication
- [ ] Authorization cannot be bypassed by parameter tampering (e.g., changing `userId` in the request body)
- [ ] Users cannot reach other users' data by changing an ID (no IDOR / horizontal escalation)
- [ ] Regular users cannot call admin endpoints (no vertical escalation)
- [ ] File operations prevent path traversal
- [ ] CORS never combines `Access-Control-Allow-Origin: *` (or a reflected origin) with credentials
- [ ] Server-side requests to user-supplied URLs (SSRF) go through an allowlist; internal ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1) and cloud metadata endpoints are blocked, and redirects and DNS rebinding are handled

**Findings:**
[Describe any issues found, or "None found."]

---

#### A02: Security Misconfiguration
- [ ] Error responses expose no stack traces or internal details
- [ ] Security headers are set: `Content-Security-Policy` (including `frame-ancestors`, which replaces `X-Frame-Options`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- [ ] Debug, admin, and documentation endpoints are not exposed in production
- [ ] No default credentials; unnecessary features and services are disabled
- [ ] Cloud storage buckets and databases are not publicly reachable

**Check security headers:**
```bash
curl -sI https://your-app.example.com/ | grep -iE "content-security|strict-transport|x-content-type|referrer-policy|access-control"
```

**Findings:**
[Describe any issues found, or "None found."]

---

#### A03: Software Supply Chain Failures
- [ ] `npm audit --omit=dev` (or `pnpm audit --prod` / `yarn npm audit`) shows no unresolved CRITICAL or HIGH issues in production dependencies
- [ ] The lockfile is committed, and CI installs with `npm ci` (or `pnpm install --frozen-lockfile`)
- [ ] New dependencies are vetted: maintained, widely used, no unexpected install scripts, name not typosquatted
- [ ] Automated updates are configured (Dependabot or Renovate)
- [ ] CI actions are pinned (full commit SHA for third-party actions), workflows use least-privilege `permissions`, and untrusted PR code never runs with secrets

**Audit results:**
[Paste the audit summary, or "Audit not yet run."]

**Findings:**
[List unfixed HIGH/CRITICAL vulnerabilities, or "None found."]

---

#### A04: Cryptographic Failures
- [ ] Passwords are hashed with Argon2id, scrypt, or bcrypt (never MD5/SHA-1/plain SHA-256)
- [ ] No secrets in source code or client bundles (any `VITE_*`, `NEXT_PUBLIC_*`, or `REACT_APP_*` value is public)
- [ ] No secrets in git history (see Secrets Management below)
- [ ] HTTPS everywhere; HSTS enabled
- [ ] Tokens and session IDs come from a cryptographically secure random source
- [ ] Sensitive data is encrypted at rest where required, and PII is not logged in plaintext
- [ ] Browser storage (`localStorage`, IndexedDB) holds no long-lived secrets or session tokens unless that trade-off is deliberate and documented

**Findings:**
[Describe any issues found, or "None found."]

---

#### A05: Injection
- [ ] All database queries use parameterized queries / prepared statements (no string concatenation)
- [ ] User input is validated against a schema before use
- [ ] HTML output is escaped: no `innerHTML`, `dangerouslySetInnerHTML`, or `href="javascript:..."` with user data unless sanitized (e.g., DOMPurify)
- [ ] No shell commands built from user input (`exec(userInput)`); use argument arrays
- [ ] Template, LDAP, XML, and NoSQL injection prevented where those are used

**Query examples to verify:**
```typescript
// VULNERABLE — never do this:
db.query(`SELECT * FROM users WHERE email = '${email}'`);

// SAFE:
db.query('SELECT * FROM users WHERE email = $1', [email]);
// or ORM:
prisma.user.findUnique({ where: { email } });
```

**Findings:**
[Describe any issues found, or "None found."]

---

#### A06: Insecure Design
- [ ] Business logic cannot be abused (negative quantities, replayed requests, races on limited resources)
- [ ] Rate limiting protects login, password reset, OTP, and other expensive operations
- [ ] Login, signup, and reset give the same response whether or not the account exists (no account enumeration)
- [ ] Multi-step flows validate state at every step, not only the last one
- [ ] Rules enforced in the UI are also enforced on the server

**Findings:**
[Describe any issues found, or "None found."]

---

#### A07: Authentication Failures
- [ ] Password rules follow NIST SP 800-63B: at least 15 characters when the password is the only factor (8 with MFA), maximum at least 64, no forced composition rules or periodic resets, and new passwords checked against breached-password lists
- [ ] Brute-force protection: rate limiting or progressive delays on login
- [ ] MFA is available (passkeys/WebAuthn preferred) and required for admin accounts
- [ ] Sessions are rotated on login and invalidated on logout and password change
- [ ] Session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax` or `Strict`
- [ ] JWTs: algorithm pinned (no `alg: none`), signature, expiry, issuer, and audience verified
- [ ] OAuth/OIDC: PKCE used, `state` checked, redirect URIs exactly allowlisted

**Findings:**
[Describe any issues found, or "None found."]

---

#### A08: Software or Data Integrity Failures
- [ ] Untrusted data is validated before deserialization or use
- [ ] Webhooks verify payload signatures (and timestamps, to stop replays) before processing
- [ ] Third-party scripts loaded from CDNs use Subresource Integrity (`integrity=`) or are self-hosted
- [ ] Updates and plugins are verified before being applied

**Findings:**
[Describe any issues found, or "None found."]

---

#### A09: Security Logging and Alerting Failures
- [ ] Authentication events are logged (login, logout, failures, MFA changes)
- [ ] Authorization failures (403s) are logged
- [ ] Logs contain no passwords, tokens, `Authorization`/`Cookie` headers, or unmasked PII
- [ ] Logs are structured, centralized, and retained per a defined policy
- [ ] Alerts fire on anomalies (spikes in 401/403, many failed logins from one source) and reach a person

**Findings:**
[Describe any issues found, or "None found."]

---

#### A10: Mishandling of Exceptional Conditions
- [ ] Failures fail closed: an exception during an authorization or validation check denies the request
- [ ] Every promise rejection and thrown error is handled; nothing is silently swallowed
- [ ] Resources (locks, transactions, file handles, connections) are released on every error path
- [ ] Timeouts and limits exist for external calls, uploads, and request bodies
- [ ] Error messages shown to users are generic; details go to logs only

**Findings:**
[Describe any issues found, or "None found."]

---

### Additional Checks (Beyond OWASP Top 10)

#### Chrome Extension Specific (if applicable):
- [ ] Manifest `content_security_policy` is not loosened; no remote code, `eval()`, or `new Function()`
- [ ] `externally_connectable` only allows trusted origins
- [ ] `chrome.runtime.onMessage` / `onMessageExternal` handlers check `sender` and validate the message shape
- [ ] Content scripts never expose extension APIs or privileged data to page scripts
- [ ] Host permissions are minimal; per-site access is requested at runtime (`optional_host_permissions`) instead of `<all_urls>` at install
- [ ] Secrets are not stored where content scripts or web pages can read them

#### Secrets Management:
```bash
# Full git history and the working tree (a key deleted later is still leaked):
gitleaks git -v
gitleaks dir . -v
# Alternative: trufflehog git file://. --results=verified,unknown
```
Any leaked secret must be rotated at the provider. Removing it from the code or rewriting history is not enough.

---

## Output Format

```markdown
## Security Review Report

### Overall Risk Level: [Critical / High / Medium / Low]

### Executive Summary
[2-3 sentences: overall security posture and most urgent findings]

---

### Critical Issues (fix before deploying)
1. **[A0X / Category]**: [description]
   - Risk: [what could an attacker do, and how do they reach it?]
   - Fix: [specific remediation]
   - Verification: [test or check that proves it's fixed]

### High Issues (fix this sprint)
...

### Medium Issues (fix next sprint)
...

### Low Issues (track in backlog)
...

---

### OWASP Top 10:2025 Summary
| Control | Status | Priority |
|---------|--------|----------|
| A01: Broken Access Control | ✅/⚠️/❌ | [P1-P4] |
| A02: Security Misconfiguration | ✅/⚠️/❌ | |
| A03: Software Supply Chain Failures | ✅/⚠️/❌ | |
| A04: Cryptographic Failures | ✅/⚠️/❌ | |
| A05: Injection | ✅/⚠️/❌ | |
| A06: Insecure Design | ✅/⚠️/❌ | |
| A07: Authentication Failures | ✅/⚠️/❌ | |
| A08: Software or Data Integrity Failures | ✅/⚠️/❌ | |
| A09: Security Logging and Alerting Failures | ✅/⚠️/❌ | |
| A10: Mishandling of Exceptional Conditions | ✅/⚠️/❌ | |

### Dependency Vulnerabilities
| Package | Current | Severity | Fixed In | Action |
|---------|---------|----------|----------|--------|
| [name] | [ver] | [HIGH] | [ver] | [update/no-fix] |
```

---

Begin the audit now, starting with the highest-risk controls for the application type described.
````

---

## Notes

- This template assumes a web/API context. For mobile apps, desktop apps, or embedded systems, some sections need adaptation.
- For a pre-launch audit, work through all 10 controls. For a targeted review, focus on the controls most relevant to the change.
- OWASP Top 10:2025 moved SSRF into A01 and added A03 (Software Supply Chain Failures) and A10 (Mishandling of Exceptional Conditions). If a compliance document still references the 2021 list, map findings to both.
- Never ship code with CRITICAL or HIGH findings unaddressed. Escalate to a senior engineer or security team if you cannot fix them.
