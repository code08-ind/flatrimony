# Flatrimony — Product Requirements Document (PRD)

| Field | Value |
| --- | --- |
| Product | Flatrimony — verified flatmate matching for India ("Rishta pakka, rent split.") |
| Document version | 1.0 |
| Date | 12 Nov 2026 |
| Owner | Aryan Garg (founder, solo developer) |
| Status | Approved for build (name clearance pending) |
| Source documents | `01-product-spec.md` (product spec v0.3) |
| Related documents | `03-technical-stack.md`, `04-database-design.md`, `05-api-design.md`, `06-ui-ux-design-standards.md`, `07-project-progress.md` |

> **How to read this document.** This PRD turns the product spec into buildable requirements. Every requirement has an ID (for example `FR-DISC-03`). Code, tests, tickets and pull requests should reference these IDs. When this PRD and the spec disagree, this PRD wins; when this PRD and the founder's decisions table (spec section 2.1) disagree, raise it as an open question instead of guessing.

---

## Table of contents

1. Product summary
2. Problem statement
3. Goals, non-goals and success metrics
4. Users, categories and personas
5. Scope by release
6. User journeys
7. Functional requirements (by epic)
8. Non-functional requirements
9. Trust, safety and moderation policy
10. Monetisation requirements
11. Analytics and event tracking
12. Localisation requirements
13. Legal, privacy and compliance requirements
14. Release criteria (Definition of Done for a release)
15. Assumptions and dependencies
16. Risks
17. Open questions
18. Glossary

---

## 1. Product summary

Flatrimony helps young renters in Delhi NCR find a flatmate they can actually live with. People create a "Flat Biodata" (budget, area or office, sleep schedule, cleaning habits, smoking, pets, food and more), swipe or browse compatible people and rooms, verify their identity through DigiLocker before chatting, meet before moving in, and then use the app during the stay to record the flat's condition, split bills, rotate chores and build a portable reputation called the **Flatmate Passport**.

The product is inspired by a viral Instagram reel that asked for "Tinder for flatmates" in India. Competitors (FlatMate.in, FlatX, NoBroker) already offer listings, chat and some compatibility scoring. Flatrimony differentiates on **trust before and after the match**:

- verified identity before any message,
- in-app recorded video walkthroughs (no fake listings),
- broker detection,
- landlord rules and true monthly cost upfront,
- commute-time matching across NCR,
- women-only verified spaces with live safety tools,
- and after-move-in tools (move-in photo log, deposit record, replacement finder, chores, bill split) that feed a verified reputation.

## 2. Problem statement

Young renters in Indian metros choose a person to share an 11-month rent agreement and a security deposit with after one WhatsApp call. Existing platforms are built around listings; they rarely check whether two people can live together, whether the listing is real, whether the "flatmate" is a broker, or what the room really costs. After moving in, there is no structured way to handle chores, bills, deposits, or a flatmate leaving mid-lease. Women in particular face safety risks when visiting flats and meeting strangers.

## 3. Goals, non-goals and success metrics

### 3.1 Goals

| ID | Goal |
| --- | --- |
| G1 | Help users find a compatible, verified flatmate in Delhi NCR quickly and safely. |
| G2 | Make every person and every room on the platform verifiably real. |
| G3 | Reduce conflict during the stay (chores, bills, deposits, departures). |
| G4 | Build a portable trust record (Flatmate Passport) that users value across moves. |
| G5 | Run within a launch budget of under ₹5,000 per month until there is paying traction. |

### 3.2 Non-goals (for v1.x)

- Landlords and brokers as users. Only residents (tenants) list rooms.
- Property sales, PG/hostel aggregation, or co-living operator inventory.
- Rent collection or escrow of deposits (the app records shares; it does not hold money).
- Dating or romance features of any kind. The matchmaking language is a brand theme only.
- iOS app at v1.0 (planned for v1.2). The web app covers iPhone users at launch.
- Cities outside Delhi NCR before v2.

### 3.3 Success metrics

| Metric | Definition | Target (set by founder before launch) |
| --- | --- | --- |
| North star | Verified pairs who confirm "Rishta pakka" (moving in) per month | TBD |
| Activation rate | New sign-ups who complete Flat Biodata and DigiLocker within 7 days | TBD |
| Match rate | Mutual matches per weekly active user | TBD |
| Funnel conversion | Match → first message → Pehli Mulaqat → Rishta pakka | Track each step |
| Trust | Reports per 1,000 chats; % of active users verified | Reports trending down; ≥ 90% of chatting users verified (by design 100%) |
| Listing quality | % of active listings with a video walkthrough confirmed in the last 7 days | 100% by design |
| Retention during stay | Weekly active users among people in an active stay | TBD (v1.2) |
| Outcome | Pairs still living together 3 months after moving in | TBD (v1.1) |
| Revenue | Move Pass and boost purchases per month | TBD (v1.1) |

> The founder sets numeric targets during Phase 0 (validation). Do not invent targets in code or dashboards.

## 4. Users, categories and personas

### 4.1 Intents

Each user picks one **intent** at onboarding (changeable later):

| Intent | Meaning |
| --- | --- |
| `have_room` | I live in a flat and have a room or bed to fill. I create a listing. |
| `need_room` | I need a room in an existing flat. |
| `pair_up` | I have no flat yet; I want to find a flatmate first and search together. |

### 4.2 Categories

Each user picks one **category** (changeable later, except that Women-only requires ID-confirmed female gender):

| Category | Who | What changes |
| --- | --- | --- |
| `professional` | Working professionals, typically 22–32 | Office anchor, work mode, commute ≤ 45 min default, work-email badge |
| `student` | College students | College anchor, lower budget band default, shorter leases, college-email badge |
| `women_only` | Women who want a women-only space | Visible only to ID-confirmed women; live location on visits; SOS |
| `relocating` | People moving to NCR from another city | New-office anchor, live video tours, "remote-ready" listing filter |

### 4.3 Personas

1. **Riya, 26, product analyst, moving from Pune to Gurugram (relocating).** Cannot visit flats before joining. Needs verified listings, a live video tour, and confidence the other person is real.
2. **Karan, 24, software engineer in Noida (professional, `need_room`).** Sleeps at 11 PM, cleans daily, hates parties on weeknights. Wants a short commute to Sector 62.
3. **Meera, 28, consultant in Cyber City (women_only, `have_room`).** Has a 3BHK with one room free. Wants only verified women to see her listing and wants to meet safely.
4. **Aman, 20, student at a Delhi University college (student, `pair_up`).** Budget ₹8–10K. Wants to find a flatmate first, then rent a 2BHK together.

## 5. Scope by release

| Release | Theme | Included epics (see section 7) |
| --- | --- | --- |
| Phase 0 | Validation | Landing page (EN/HI), waitlist form, analytics |
| **v1.0** | Launch: match safely | E1 Auth & onboarding · E2 Flat Biodata & lifestyle · E3 Verification · E4 Listings · E5 Discovery & matching · E6 Chat · E7 Meet & safety · E8 Moderation & admin · E9 Notifications · E10 Privacy & account · basic Flatmate Passport (verified identity + badges) |
| **v1.1** | Trust after the match | E11 Stays & Flatmate Passport (habit confirmations, references) · E12 Move-in log & deposit record · E13 Replacement finder · live video tours · meet-up spots & check-in · E14 Payments (Move Pass, listing boost) |
| **v1.2** | Living together | E15 Chores, bills & nudges · iOS app · house agreement |
| v2 | Scale | More cities, partner services, learned matching weights |

## 6. User journeys

### 6.1 Seeker journey (need_room / pair_up)

1. Opens the app → language choice (English/हिन्दी) → phone number → OTP.
2. Picks intent and category.
3. Quick Flat Biodata (under 3 minutes): budget, office/college or areas, move-in date, 5 lifestyle questions (bedtime, cleaning, smoking, pets, food).
4. Lands on the Discover deck immediately; can complete the rest of the biodata later (prompted by a progress ring).
5. Swipes right on people (and, for `need_room`, on rooms with their resident owners).
6. Mutual like → "It's a Rishta!" screen → **DigiLocker verification gate** before the first message.
7. Chats with phone number hidden. Can share number when both agree.
8. Proposes a Pehli Mulaqat (meet-up / flat visit). Women-only users get live location sharing and SOS during the visit.
9. After meeting, each person privately answers "Still interested?". If both say yes → status "Rishta pakka" (moving in).
10. (v1.1+) A Stay is created. Move-in photo log, deposit shares, later chores and bills. At move-out or every 6 months, habit confirmations and references feed the Flatmate Passport.

### 6.2 Room owner journey (have_room)

1. Same sign-up and quick biodata.
2. Creates a listing: area and exact location (kept private), rent per person, deposit, true monthly costs, landlord rules, photos, and a **video walkthrough recorded inside the app**.
3. Listing goes to review (automatic checks + moderation if flagged), then becomes active.
4. Every 7 days the owner confirms "still available" with one tap; otherwise the listing expires.
5. Receives likes from seekers, matches, and continues as in 6.1 from step 6.

### 6.3 Replacement journey (v1.1)

1. A member of an active stay taps "I'm leaving".
2. A replacement listing is pre-filled from the stay's listing.
3. Remaining flatmates see candidates who liked the listing and approve or reject together. A candidate needs approval from all remaining members.

## 7. Functional requirements

Priority key: **P0** = required for the release named, **P1** = should ship in that release if time allows, **P2** = later.

Each requirement lists acceptance criteria (AC) in Given / When / Then form where useful.

### E1 — Authentication and onboarding (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-AUTH-01 | Users sign up and log in with an Indian mobile number and a 6-digit OTP. | P0 |
| FR-AUTH-02 | OTP requests are rate limited per phone, per device and per IP; after 5 failed OTP attempts the number is locked for 30 minutes. | P0 |
| FR-AUTH-03 | A new device requires OTP re-verification; changing the phone number requires OTP on both old and new numbers (or support review if the old number is lost). | P0 |
| FR-AUTH-04 | Users can log out of the current device or all devices. | P0 |
| FR-AUTH-05 | First screen offers English and हिन्दी; choice persists and can be changed in settings. | P0 |
| FR-AUTH-06 | Onboarding has exactly six steps: intent → category → budget → anchor (office/college) or areas → move-in date → "Your habits" (the 5 core lifestyle questions together on one screen). Every other step asks one decision. Users reach Discover in under 3 minutes (median). | P0 |
| FR-AUTH-07 | The first screen, store listing, and onboarding clearly say "Flatmates, not dating". | P0 |
| FR-AUTH-08 | Banned identities (phone hash, device hash, DigiLocker identity hash) cannot create a new account. | P0 |
| FR-AUTH-09 | Users must accept the Terms, Privacy Policy and data-processing consents (DPDP) before creating a profile; consents are versioned and stored. | P0 |

**AC (FR-AUTH-06):** Given a new user on Android, when they complete the six onboarding screens, then they land on Discover with a deck of at least one card (or a helpful empty state) and the biodata completion ring shows ≥ 40%.

### E2 — Flat Biodata and lifestyle (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-BIO-01 | Profile fields: display name, date of birth (age shown, not DOB), 1–6 photos, bio (≤ 300 chars), languages spoken, intent, category. | P0 |
| FR-BIO-02 | Preferences: budget range (₹ per person per month), move-in window, lease length (months), flatmate gender preference (`female_only`, `male_only`, `any`), up to 3 preferred areas. | P0 |
| FR-BIO-03 | Anchor: office or college location (map pin or search), travel mode (`car`, `two_wheeler`, `metro_transit`, `walk`), maximum commute minutes (15–90, default 45). | P0 |
| FR-BIO-04 | Lifestyle: bedtime, wake time, cleaning level, smoking, pets, food habit, cooks at home, drinking, guests, parties at home, work mode. | P0 (first five), P1 (rest) |
| FR-BIO-05 | Each lifestyle attribute has an importance setting: `dealbreaker`, `matters`, `dont_care` (default `matters`). | P0 |
| FR-BIO-06 | Scenario questions (minimum 5 at launch) measure real behaviour, e.g. "There are 5 dishes in the sink at 10 PM. What happens?" Answers map to the same lifestyle scales and are used in scoring alongside self-ratings. | P0 |
| FR-BIO-07 | Photos are checked: face present in the first photo, no explicit content, EXIF/GPS metadata stripped, perceptual hash stored. | P0 |
| FR-BIO-08 | Users can pause their profile (hidden from discovery, existing chats continue). | P0 |
| FR-BIO-09 | Category-specific fields appear only for that category (e.g., college and course end date for students). | P0 |
| FR-BIO-10 | A shareable "Flat Biodata" card (image) can be generated for Instagram/WhatsApp without exposing phone, exact location or surname. | P2 |

### E3 — Verification (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-VER-01 | DigiLocker identity verification through a licensed provider is required before a user can send their first message. Browsing and swiping are allowed without it. | P0 |
| FR-VER-02 | Store only the verification result: verified name, date of birth, gender, a hashed DigiLocker identifier, provider reference and timestamp. Never store document images or full Aadhaar numbers. | P0 |
| FR-VER-03 | The display name must reasonably match the verified name (first name match); age shown comes from the verified DOB once verified. | P0 |
| FR-VER-04 | Selfie liveness check matched against profile photos. | P1 (v1.0 if budget allows; otherwise v1.1) |
| FR-VER-05 | Optional work email or college email verification by one-time link; shows a "Works at a verified company" / "Verified student" badge without showing the employer unless the user opts in. | P1 |
| FR-VER-06 | Women-only category and the "Female-verified" badge require gender `female` from the DigiLocker result. Self-declared gender never unlocks women-only spaces. | P0 |
| FR-VER-07 | If DigiLocker verification fails or the user does not have DigiLocker, show a clear message and a support path; (later) offer a vendor fallback. | P0 |
| FR-VER-08 | Each profile card and chat header shows verification state; unverified users are visibly marked. | P0 |

**AC (FR-VER-01):** Given a matched but unverified user, when they tap the message box, then a bottom sheet explains "Verify with DigiLocker to start chatting (takes ~1 minute)" and no message is sent until verification succeeds.

### E4 — Listings (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-LST-01 | Only `have_room` users can create listings. A listing must come from a person living in the flat; landlords and brokers are prohibited. | P0 |
| FR-LST-02 | Listing fields: area, exact location (private), BHK, room type (`private`, `shared`), furnishing, available from, minimum lease, total flatmates, current flatmates, rent per person, deposit per person. | P0 |
| FR-LST-03 | True monthly cost: maintenance, electricity estimate, Wi-Fi, help (maid/cook), other recurring; one-time costs (e.g., brokerage = must be 0, setup). The app computes and shows the per-person monthly total. | P0 |
| FR-LST-04 | Landlord rules (required): bachelors allowed, food rule (`any`, `veg_only`, `eggetarian_ok`), guests rule (`allowed`, `day_only`, `not_allowed`), pets allowed, smoking allowed, gender rule (`female_only`, `male_only`, `any`). Rules act as hard filters. | P0 |
| FR-LST-05 | 3–12 photos plus one video walkthrough (30–90 s) recorded with the in-app camera. Gallery uploads are not accepted for the video. The app attaches a device-integrity attestation and capture timestamp. Web (and iPhone, until v1.2) users can create and fill a draft listing on the web; the video step shows a "Continue on your Android phone" screen (QR code + link) that opens the same draft in the Android app to record the video and submit. | P0 |
| FR-LST-06 | The exact address and pin are hidden until both sides agree to share; discovery shows the area and a location rounded to ~500 m. | P0 |
| FR-LST-07 | Listings expire if the owner does not confirm "still available" every 7 days. Reminder at day 6. Expired listings are hidden; one tap reactivates (no new review unless content changed). | P0 |
| FR-LST-08 | New and edited listings pass automatic checks (duplicate photo hash, banned words such as "brokerage", phone numbers in text, price anomalies). Flagged listings go to the moderation queue; others go live immediately. | P0 |
| FR-LST-09 | Owner can pause, edit, and delete a listing. | P0 |
| FR-LST-10 | "Remote-ready" badge for listings that offer live video tours (v1.1). | P1 |

### E5 — Discovery and matching (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-DISC-01 | Two views with a toggle: **Swipe deck** (default on mobile) and **List/Map** (default on web). Both use the same ranking. | P0 |
| FR-DISC-02 | Hard filters before scoring: budget overlap; move-in windows within 30 days; flatmate gender preference both ways; listing rules vs seeker lifestyle (food, smoking, pets, guests, bachelors); any `dealbreaker` attribute conflict; blocked users; women-only visibility rules; commute (listing location inside the seeker's commute zone, or the two seekers' commute zones overlap for `pair_up`). | P0 |
| FR-DISC-03 | Compatibility score 0–100 as specified in spec section 5.1 (weighted average of per-attribute similarity; weights from both users' importance; higher weight wins). Scenario answers count alongside self-ratings (blend 50/50 for attributes with both). | P0 |
| FR-DISC-04 | Card shows: photo, name, age, verification badges, match %, budget, area or commute minutes, top 3 shared habits, and (for rooms) true monthly cost. | P0 |
| FR-DISC-05 | Profile detail shows all habits, the **Rishta report** (top agreements + biggest gap), badges, and room details if any. | P0 |
| FR-DISC-06 | Like / pass / (Move Pass) super like with a note. Mutual like creates a match and shows "It's a Rishta!". Room cards are swiped per room: if an owner has several listings, a seeker likes each room separately, and a room match is tied to that listing (the match screen and chat header show which room). | P0 |
| FR-DISC-12 | Unverified viewers (no DigiLocker gender yet) see `female_only` and `male_only` rooms in the deck and list, marked with a lock: "Verify to like this room". Liking such a room opens the verification gate. After verification, rooms whose gender rule does not match are removed. Women-only *owners and profiles* (FR-SAFE-04) stay invisible to unverified viewers. | P0 |
| FR-DISC-07 | Ranking = score, plus small boosts for verified, recently active (≤ 7 days), and under-exposed new profiles; boosted listings (paid) get priority among cards with similar scores but never bypass hard filters. | P0 |
| FR-DISC-08 | Free users have a daily like limit (initial value 50, configurable remotely). | P0 |
| FR-DISC-09 | Passed profiles do not reappear for 30 days unless the user's preferences change. | P0 |
| FR-DISC-10 | Deck responses return within the performance budget (section 8) and are pre-fetched so swiping never waits. | P0 |
| FR-DISC-11 | Empty states explain why (e.g., "Few people match a 20-minute commute — try 35 minutes?") with a one-tap fix. | P0 |

### E6 — Chat (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-CHAT-01 | One-to-one chat per match; available only when both users are DigiLocker-verified. | P0 |
| FR-CHAT-02 | Text messages (≤ 2,000 chars) and images (P1). Delivery and read receipts. Real-time updates. | P0 |
| FR-CHAT-03 | Phone numbers stay hidden; "Share my number" reveals numbers only when both users have tapped it. | P0 |
| FR-CHAT-04 | New accounts (< 3 days old or < 2 replies received) can start at most 10 new conversations per day. | P0 |
| FR-CHAT-05 | Scam and broker keyword detection ("advance token", "pay to reserve", "brokerage", "visit charges", UPI IDs in the first messages) shows an in-app warning to the recipient and records a broker signal. | P0 |
| FR-CHAT-06 | Report and block from the chat header; blocking hides both users from each other everywhere. | P0 |
| FR-CHAT-07 | Unmatch ends the chat for both; history is retained for moderation for 90 days, then deleted. | P0 |
| FR-CHAT-08 | Screenshots are blocked on chat and profile screens on Android. | P0 |
| FR-CHAT-09 | Icebreaker prompts and a short "house rules" quiz both users answer in chat. | P1 |
| FR-CHAT-10 | Group chat for 3+ people sharing a flat. | P2 |

### E7 — Pehli Mulaqat (meet) and safety (v1.0, with v1.1 additions)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-MEET-01 | Propose a meet-up or flat visit from chat: date, time, place (public place or the flat). The other user accepts, declines or proposes another time. | P0 |
| FR-MEET-02 | Reminders 24 h and 1 h before. | P0 |
| FR-MEET-03 | After the meet-up time, both users privately answer "Still interested?". Both yes → match status `moving_in` ("Rishta pakka"). Either no → match closes politely (no reason shown). | P0 |
| FR-SAFE-01 | Trusted contacts (up to 3) with name and phone. | P0 |
| FR-SAFE-02 | Live location sharing during a visit: starts manually or automatically at meet-up time; shared via SMS/WhatsApp link to trusted contacts; auto-ends after 3 hours or on "I'm safe"; location points are deleted when the session ends. | P0 for `women_only`, P1 for others |
| FR-SAFE-03 | SOS button: one long-press sends the user's current location and meet-up details to trusted contacts and shows emergency number 112. | P0 for `women_only`, P1 for others |
| FR-SAFE-04 | Women-only visibility: profiles and listings of `women_only` users are never returned to users whose verified gender is not female — in search, deck, deep links and API. | P0 |
| FR-SAFE-05 | Suggested public meeting spots near the flat; "check in" button at the meeting. | P1 (v1.1) |
| FR-SAFE-06 | Live video tour inside chat for relocating users. | P1 (v1.1) |

### E8 — Moderation and admin (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-ADM-01 | Separate admin web app with role-based access (`admin`, `moderator`), 2FA, and IP allow-list. | P0 |
| FR-ADM-02 | Queues: reports (sorted by priority), listings pending review, broker signals, failed verifications. | P0 |
| FR-ADM-03 | Actions: warn, remove content, suspend (time-boxed), ban (by phone hash, device hash and DigiLocker hash), restore. Every action requires a reason and is written to the audit log. | P0 |
| FR-ADM-04 | Moderators never see raw phone numbers or exact addresses unless a safety report requires it; such access is logged with a reason. | P0 |
| FR-ADM-05 | Report SLAs: safety reports (harassment, threats, SOS-related) reviewed within 2 hours during 9 AM–11 PM IST; others within 24 hours. | P0 |
| FR-ADM-06 | Dashboard with daily sign-ups, verifications, matches, reports, active listings. | P1 |
| FR-ADM-07 | Remote configuration (daily like limit, feature flags, scenario questions) editable from admin. | P1 |

### E9 — Notifications (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-NOTIF-01 | Push notifications for: new match, new message, meet-up proposed/accepted/reminder, listing expiry reminder, verification result, report outcome. | P0 |
| FR-NOTIF-02 | In-app notification centre with unread count. | P0 |
| FR-NOTIF-03 | Per-type notification settings; quiet hours (default 11 PM–8 AM) except safety notifications. | P1 |
| FR-NOTIF-04 | Notification text never contains message content for chats from unverified or newly matched users (privacy on lock screens): "New message from Karan". | P0 |

### E10 — Privacy and account (v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PRIV-01 | Users can download their data (JSON + photos) within 7 days of request. | P0 |
| FR-PRIV-02 | Users can delete their account; data is deleted within 30 days except what the law requires to keep (audit and ban records, minimal). | P0 |
| FR-PRIV-03 | Users can withdraw individual consents (e.g., marketing). | P0 |
| FR-PRIV-04 | Privacy settings: hide age, hide employer badge details, pause profile. | P1 |

### E11 — Stays and Flatmate Passport (basic at v1.0, full at v1.1)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PASS-01 | (v1.0) Passport shows verified identity status, verification badges and member-since date. | P0 |
| FR-PASS-02 | (v1.1) When a match reaches `moving_in`, either user can create a **Stay**; all members confirm. A stay links to the listing if there is one. | P0 |
| FR-PASS-03 | (v1.1) After 30 days in a stay, at move-out, and every 6 months, each member is prompted to confirm or dispute habit tags for each other member (e.g., "Tidy", "Quiet after 11 PM", "Pays on time", "Respects guests rule") and may write a private reference (≤ 500 chars). | P0 |
| FR-PASS-04 | (v1.1) Double-blind reveal: inputs are hidden until all parties submit or 14 days pass. | P0 |
| FR-PASS-05 | (v1.1) Passport displays counts ("Tidy — confirmed by 3 past flatmates"), never star ratings. References are visible only to users the person has matched with. | P0 |
| FR-PASS-06 | (v1.1) Users can flag a confirmation or reference as unfair; moderators review. Abusive text is removed. | P0 |

### E12 — Move-in log and deposit record (v1.1)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-MOVE-01 | Create a move-in log for a stay: photos per room/item with capture timestamp and location, short notes. | P0 |
| FR-MOVE-02 | All members sign the log; once signed it is locked (read-only, tamper-evident hash). | P0 |
| FR-MOVE-03 | Record each member's deposit share and to whom it was paid. | P0 |
| FR-MOVE-04 | Export the log as a PDF for disputes. | P1 |

### E13 — Replacement finder (v1.1)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-REPL-01 | A stay member can start a replacement request; a listing is pre-filled from the stay. | P0 |
| FR-REPL-02 | Candidates who like the listing are shown to all remaining members; each approves or rejects. A candidate is accepted only when all remaining members approve. | P0 |
| FR-REPL-03 | Accepted candidate joins the stay; leaving member's membership ends on their move-out date. | P0 |

### E14 — Payments (v1.1)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PAY-01 | Products: `move_pass_30d` (see who liked you, unlimited likes, super likes with a note, rewind, priority in deck) and `listing_boost_7d` (listing shown higher for matching seekers for 7 days). Prices are remote-configurable. | P0 |
| FR-PAY-02 | Payment through Razorpay (UPI, cards, netbanking). Entitlements are granted only after a server-verified payment webhook. | P0 |
| FR-PAY-03 | Purchase history and GST-compliant invoices (once the business is registered). | P1 |
| FR-PAY-04 | Refund policy shown before purchase; refunds handled from admin. | P0 |

> Note: Google Play's billing policy may require Play Billing for digital goods sold inside the Android app. Confirm the policy before launch; if required, sell Move Pass on Android via Play Billing and keep Razorpay for web. (Open question OQ-04.)

### E15 — Living together (v1.2)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-HOME-01 | Chore rota with recurrence and fair rotation; skipped members are moved to the end. | P0 |
| FR-HOME-02 | Bills: amount, payer, split (equal or custom), due date; each member's share has a UPI payment deep link; "mark as settled" by payer and receiver. | P0 |
| FR-HOME-03 | Anonymous nudges from templates ("Dishes are pending", "Bill due tomorrow"); limited to 3 per member per day; sender is never revealed. | P0 |
| FR-HOME-04 | House agreement template (quiet hours, cleaning rota, guests, bills, notice period, deposit shares) signed in-app by all members; versioned. | P0 |

## 8. Non-functional requirements

### 8.1 Performance

| ID | Requirement |
| --- | --- |
| NFR-PERF-01 | API p95 latency ≤ 300 ms and p99 ≤ 800 ms for read endpoints; ≤ 500 ms p95 for writes (excluding third-party calls), measured from the Mumbai region. |
| NFR-PERF-02 | Discover deck endpoint p95 ≤ 400 ms for a page of 20 cards. |
| NFR-PERF-03 | Android cold start to interactive ≤ 2.5 s on a mid-range device (e.g., 4 GB RAM, 2021-era chipset); warm start ≤ 1 s. |
| NFR-PERF-04 | Swipe animations at 60 fps; no dropped frames during card transitions on the reference device. |
| NFR-PERF-05 | Web: Largest Contentful Paint ≤ 2.5 s, Interaction to Next Paint ≤ 200 ms, Cumulative Layout Shift ≤ 0.1 on a 4G connection (Core Web Vitals "good"). |
| NFR-PERF-06 | Chat message delivered to an online recipient in ≤ 1 s (p95). |
| NFR-PERF-07 | Images served as WebP/AVIF, sized for the device; video walkthroughs ≤ 720p, ≤ 25 MB. |
| NFR-PERF-08 | Android release APK/AAB download size ≤ 40 MB. |

### 8.2 Availability and reliability

| ID | Requirement |
| --- | --- |
| NFR-REL-01 | Monthly availability target 99.5% for API and web. |
| NFR-REL-02 | Daily database backups retained for 7 days minimum; documented restore procedure tested once per quarter. |
| NFR-REL-03 | All background jobs are idempotent and retried with exponential backoff; failures alert. |
| NFR-REL-04 | The mobile app works offline for reading cached matches and chats; queued messages send when online. |
| NFR-REL-05 | Zero-downtime deploys (rolling revisions) and backward-compatible database migrations (expand → migrate → contract). |

### 8.3 Security (summary; full controls in spec section 7 and `03-technical-stack.md`)

| ID | Requirement |
| --- | --- |
| NFR-SEC-01 | Every API request is authenticated (except public health, webhooks with signature verification, and public safety share links with unguessable tokens) and authorised at the object level. |
| NFR-SEC-02 | Postgres Row Level Security enabled on every table in exposed schemas; private schema not exposed. |
| NFR-SEC-03 | Sensitive fields (phone numbers of trusted contacts, exact addresses, DigiLocker hashes) encrypted or hashed; keys outside the database. |
| NFR-SEC-04 | OWASP ASVS Level 2 and OWASP MASVS L1 + resilience basics as the verification baseline. |
| NFR-SEC-05 | No secrets in the repository or app bundle; secret scanning in CI. |
| NFR-SEC-06 | Independent penetration test before passing 10,000 users or raising money. |

### 8.4 Privacy

| ID | Requirement |
| --- | --- |
| NFR-PRIV-01 | Data stored in India (Mumbai region). One documented exception: pseudonymous product-analytics events sent to PostHog cloud (section 11), which never contain names, phone numbers, locations, message content or identity data. Confirm with a lawyer. |
| NFR-PRIV-02 | Data minimisation: collect only fields listed in this PRD; no contact-list upload; no background location except during an active safety session. |
| NFR-PRIV-03 | Retention: chats deleted 12 months after a match closes (90 days for unmatched); safety location points deleted when the session ends; deleted accounts purged within 30 days. |

### 8.5 Accessibility

| ID | Requirement |
| --- | --- |
| NFR-A11Y-01 | WCAG 2.2 AA for web; equivalent for mobile (screen reader labels, 44×44 pt touch targets, dynamic type up to 200%). |
| NFR-A11Y-02 | Swipe actions always have visible button alternatives. |
| NFR-A11Y-03 | Respect reduce-motion settings. |

### 8.6 Scalability (design targets, not launch requirements)

| ID | Requirement |
| --- | --- |
| NFR-SCALE-01 | Architecture supports 100,000 registered users and 10,000 daily actives in NCR without redesign (vertical scaling of Postgres, horizontal scaling of stateless API). |
| NFR-SCALE-02 | Candidate generation uses indexed geo and filter queries; no full-table scans in the deck path. |

### 8.7 Maintainability

| ID | Requirement |
| --- | --- |
| NFR-MAINT-01 | TypeScript strict mode across the monorepo; shared Zod schemas are the single source of truth for API contracts. |
| NFR-MAINT-02 | Unit test coverage ≥ 70% for business logic packages (scoring, filters, payments); every API endpoint has at least one integration test. |
| NFR-MAINT-03 | Every architectural decision recorded as an ADR in `docs/adr/`. |

## 9. Trust, safety and moderation policy

1. **Community rules** (shown at onboarding, linked everywhere): real identity; no brokers or landlords; no advance payments before a visit; no dating or sexual content; no discrimination beyond the explicit housing preferences the product supports (gender preference, food rules set by the landlord); no harassment.
2. **Enforcement ladder:** warning → content removal → 7-day suspension → permanent ban. Safety threats skip directly to ban.
3. **Broker detection signals:** same photo hash across listings from different users; one device or phone hash across many accounts; brokerage words; asking for visit fees; many listings in short time; payment details in chat. A risk score above a threshold auto-pauses the account pending review.
4. **Appeals:** users can appeal any action once from the app; reviewed by a different moderator (or the founder) within 72 hours.

## 10. Monetisation requirements

- Core experience is free after verification: browsing, matching, chat, meet-ups, safety tools, basic Passport.
- Paid: Move Pass (seekers) and listing boost (residents) from v1.1. Prices are A/B tested; not hard-coded.
- No ads in v1.x.
- Verification is paid by the platform at launch; revisit if costs or fraud grow.

## 11. Analytics and event tracking

Use PostHog cloud (decided 13 Nov 2026; this is the documented exception in NFR-PRIV-01). Never send phone numbers, names, exact locations, message content or DigiLocker data to analytics. User IDs are pseudonymous UUIDs.

| Event | Properties | Purpose |
| --- | --- | --- |
| `onboarding_step_completed` | step, intent, category, duration_ms | Onboarding funnel |
| `biodata_completed` | completion_pct | Activation |
| `verification_started` / `verification_completed` / `verification_failed` | type, failure_reason_code | Verification funnel |
| `deck_viewed` | mode (deck/list/map), cards_returned | Liquidity |
| `swipe` | action, has_listing, score_bucket | Matching quality |
| `match_created` | score_bucket, category_pair | North star funnel |
| `message_sent` | is_first_message | Engagement |
| `contact_shared` | — | Funnel |
| `meetup_proposed` / `meetup_accepted` / `meetup_completed` | — | Funnel |
| `decision_submitted` | still_interested | Funnel |
| `moving_in_confirmed` | days_since_match | North star |
| `listing_created` / `listing_activated` / `listing_expired` | has_video | Supply |
| `report_submitted` | target_type, reason | Trust |
| `safety_session_started` / `sos_triggered` | type | Safety (also alert ops) |
| `purchase_completed` | product, amount_bucket | Revenue |

## 12. Localisation requirements

- Launch languages: English (`en`) and Hindi (`hi`). All user-facing strings live in translation files from day one; no hard-coded text.
- Hindi uses Devanagari; layouts tolerate up to 40% text expansion.
- Numbers use Indian grouping (₹1,50,000); dates as "12 Nov 2026"; times in 12-hour format with AM/PM; timezone IST for display, UTC for storage.
- Brand terms (Flat Biodata, Rishta, Pehli Mulaqat) appear in both languages consistently (see `06-ui-ux-design-standards.md` glossary).

## 13. Legal, privacy and compliance requirements

| Area | Requirement |
| --- | --- |
| DPDP Act (India) | Notice and consent screens, purpose-wise consent, withdrawal, data principal rights (access, correction, erasure), grievance officer contact. Confirm obligations with a lawyer. |
| CERT-In | Incident reporting process and log retention as required; confirm the current rules with a lawyer. |
| DigiLocker provider terms | Use only for identity verification with explicit user consent; data minimisation as per provider and DigiLocker terms. |
| Payments | Razorpay merchant onboarding; invoices; refund policy. |
| App stores | Google Play policies on user-generated content (reporting and blocking required), safety, data safety form, and billing. |
| Trademark | "Flatrimony" name clearance and filing (pending). |
| Terms | Terms of Service, Privacy Policy, Community Guidelines, Refund Policy, Grievance Redressal page. |

> This document is not legal advice. Every compliance item must be confirmed by a qualified lawyer before launch.

## 14. Release criteria (Definition of Done for v1.0)

- [ ] All P0 requirements for v1.0 implemented and covered by tests.
- [ ] No open Severity-1 or Severity-2 bugs.
- [ ] Performance targets in section 8.1 met on the reference Android device and on web.
- [ ] Security checklist in spec section 7.7 complete; OWASP ZAP scan has no high findings.
- [ ] RLS tests pass for every table.
- [ ] Privacy policy, terms and consent flows reviewed by a lawyer.
- [ ] Moderation runbook written; admin accounts provisioned with 2FA.
- [ ] Backups verified with a test restore.
- [ ] Play Store listing approved in closed testing with at least 20 testers for at least 14 days (confirm Play's current testing requirement for new personal developer accounts).
- [ ] Monitoring, alerting and on-call (founder) set up.

## 15. Assumptions and dependencies

| Type | Item |
| --- | --- |
| Dependency | DigiLocker access through a provider (e.g., Cashfree) with per-check pricing. |
| Dependency | SMS OTP provider with Indian DLT registration (sender ID and templates). |
| Dependency | Razorpay merchant account (needs business KYC; may require a registered business). |
| Dependency | Google Play developer account. |
| Assumption | Users in NCR are willing to verify with DigiLocker before chatting. To be validated in Phase 0. |
| Assumption | A free self-hosted routing engine gives acceptable commute estimates without live traffic. |
| Assumption | Residents with rooms will record a 30–90 s video walkthrough. |

## 16. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cold start (empty decks) | High | Launch with supply-first outreach; NCR flat groups; show "people looking in your area" counts; commute matching widens the pool. |
| Verification friction reduces sign-ups | Medium | Verify only at first message; explain the benefit; fast flow. |
| Brokers and scams | High | Section 9 controls; video-only listings; payment warnings. |
| Women's safety incident | Very high | Women-only verified spaces, live location, SOS, fast moderation, clear guidelines. |
| Play billing policy conflicts with Razorpay | Medium | Confirm policy; use Play Billing on Android if required. |
| Solo developer bandwidth | High | Strict release scoping; managed services; automation in CI/CD. |
| Name or trademark conflict | Medium | Clear "Flatrimony" before brand spend. |

## 17. Open questions

| ID | Question | Owner |
| --- | --- | --- |
| OQ-01 | Numeric targets for success metrics. | Founder |
| OQ-02 | Which DigiLocker provider and its price per check. | Founder |
| OQ-03 | SMS OTP provider and DLT registration path (individual vs business). | Founder |
| OQ-04 | Does Google Play require Play Billing for Move Pass on Android? | Founder (verify policy) |
| OQ-05 | Move Pass and boost prices to test. | Founder |
| OQ-06 | When to register a company (needed for DigiLocker direct, Razorpay, fund-raising). | Founder |
| OQ-07 | Name clearance results for Flatrimony. | Founder |

### 17.1 Resolved questions

| ID | Question | Decision (13 Nov 2026) |
| --- | --- | --- |
| RQ-01 | Onboarding: six screens or one screen per habit question? | Six steps; the 5 habit questions share one "Your habits" screen (FR-AUTH-06). |
| RQ-02 | Which gendered rooms do unverified users see? | All, with a "Verify to like this room" lock (FR-DISC-12). |
| RQ-03 | How do web/iPhone users list a room when video needs the Android app? | Draft on web, record video on Android via "Continue on your phone" (FR-LST-05). |
| RQ-04 | Swipe per room or per person when an owner has several listings? | Per room; a room match is tied to its listing (FR-DISC-06). |
| RQ-05 | Analytics hosting vs India-only storage? | PostHog cloud with pseudonymous events only (NFR-PRIV-01, section 11). |
| RQ-06 | Selfie liveness: P0 (spec) or P1 (PRD)? | P1, as in FR-VER-04 (PRD takes precedence). |

## 18. Glossary

| Term | Meaning |
| --- | --- |
| Flat Biodata | The user's profile (brand term). |
| Rishta | A mutual match. "It's a Rishta!" is the match screen. |
| Rishta report | The match breakdown: top agreements and biggest gap. |
| Pehli Mulaqat | The first meet-up or flat visit. |
| Rishta pakka | Both users confirmed they are moving in together. |
| Flatmate Passport | A user's portable verified record: identity, badges, habit confirmations, references. |
| Stay | A period of living together, with its members. |
| Anchor | The office or college location used for commute matching. |
| Commute zone | The area reachable from the anchor within the user's maximum commute time. |
| Move Pass | 30-day paid upgrade for seekers. |
