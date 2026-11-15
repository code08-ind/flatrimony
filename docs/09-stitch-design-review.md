# Flatrimony — Stitch Designs: Status and Review

| Field | Value |
| --- | --- |
| Date | 13 Nov 2026 |
| Generated from | `08-stitch-prompts.md` v2 (prompts sent in batches of 2–3 screens) |
| Android project | "Flatrimony Flatmate Matcher" — https://stitch.google.com/projects/5269230928866288787 |
| Web project | "Flatrimony Flatmate Matching Platform" — https://stitch.google.com/projects/17066120473464081325 |
| Stitch design system | "Urban Kinship" (Android) / "Flatrimony Design System" (Web): purple `#4A2FBD`, lime `#D7F26B`, lavender `#B9A4FF`, neutral dark |

## Coverage

| IDs | Screens | Project | Status |
| --- | --- | --- | --- |
| M01–M09 | Welcome, phone, OTP, onboarding 1–6 | Android | Generated |
| M10–M16 | Discover cards, locked room, like limit, empty deck, list, room detail, It's a Rishta! | Android | Generated |
| M17–M18 | Verification gate, result states | Android | Generated |
| M19–M24 | Rishtas, chat, report, Pehli Mulaqat planner, decision, Rishta pakka | Android | Generated |
| M25–M27 | Trusted contacts, safety session + SOS, SOS sent | Android | Generated |
| M28–M33 | Listing basics, money, rules, photos, video recorder, review + My Flat | Android | Generated |
| M34–M38 | Profile, Flat Biodata, scenario, Passport, settings | Android | Generated |
| W01–W06 | Landing + waitlist, Discover list+map, two-pane chat, continue-on-phone, safety share page, admin queue | Web | Generated |

44 of 44 screens generated. Stitch also produced a few extra frames on its own (e.g., a portrait image asset on the Android canvas).

## Issues found (fix before handing to build)

Checked from canvas thumbnails and zoomed views during generation, not pixel-by-pixel. Run the UI doc §17.3 QA checklist on each screen before build.

| # | Screen | Issue | Fix prompt / action |
| --- | --- | --- | --- |
| 1 | M01 Welcome | Badge said "100% Aadhaar & Work Verified" | **Fixed 13 Nov:** edited in place to "DigiLocker-verified members"; Stitch reports all Aadhaar mentions removed |
| 2 | M07–M09 | Wide (1280×1024) duplicates left on the Android canvas | **Fixed 13 Nov:** all three wide frames deleted; phone-size versions kept |
| 3 | M27 SOS sent | Invented "Flatrimony 24/7 Priority Emergency Desk" | **Fixed 13 Nov:** removed. The 1091 women's helpline shortcut stays next to 112 — founder to confirm before launch |
| 4 | M18 Verification success | Shows the user's own legal full name, age and gender. Fine for the user's own view; make sure no other screen shows another user's surname | None now; check during build |
| 5 | W01 Landing | Hero uses a stock-style photo of a person. UI doc §3.6 bans stock people in illustrations; a photo is acceptable only if licensed | Replace with a licensed photo or the bento illustration before publishing |
| 6 | All | Stitch adds invented copy and numbers (e.g., counts, "Verified Society", phone helpline text). Treat every number and claim as placeholder | Review copy against PRD; no business numbers are final (README rule 7) |
| 7 | All | Hindi versions not generated yet | Run the Hindi follow-up prompt from `08-stitch-prompts.md` tip 6 per screen once English is approved |

## Next steps

1. ~~Fix issues 1–3~~ (done 13 Nov). Re-check R6–R8 and fix R10–R12 from the polish pass below.
2. Run the §17.3 design QA checklist on each screen, starting with the ~30 not visually re-checked.
3. Export to Figma or code (Stitch "Export") and name frames by screen ID.
4. Generate Hindi variants for approved screens.

## Polish pass v2 (13 Nov 2026)

Requested: better font, better icons, consistent spacing, aligned images and components, a professional brand home page, a bigger and bolder logo, then a full review against the docs.

### What changed

| Area | Change | Where defined |
| --- | --- | --- |
| Font | Plus Jakarta Sans for all Latin text (Noto Sans Devanagari for Hindi), replacing Stitch's Epilogue + Noto Sans; set in both Stitch design systems | UI §3.2 |
| Icons | Phosphor Icons (Regular / Fill / Duotone) replacing Lucide; inline SVG where icon fonts failed | UI §3.6 |
| Spacing | Fixed rules: 20 px screen padding, 32 between sections, 20 inside cards, 12 between cards, 8 label-to-input, 56 px primary button, 96 px clear above the dock | UI §3.3 |
| Layout / images | One left edge, centred rows, right-aligned values, equal-height cards; fixed photo ratios (4:5 deck, 4:3 grids, 1:1 avatars), cover-cropped | UI §3.3 |
| Logo | New mark (lime house + two linked rings on Jamun purple) and ExtraBold wordmark; SVGs in `assets/logo/` | UI §2.2 |
| Home page | Web landing rebuilt as a brand home page: sticky header with logo lockup, 64 px hero, trust row, sectioned layout, CTA band, footer | `08-stitch-prompts.md` |

All 38 Android and 6 web screens were edited in place with these rules (batches of 3–5 screens).

### Review findings and fixes

| # | Finding | Screens | Status |
| --- | --- | --- | --- |
| R1 | Text fell back to a **serif font** (Plus Jakarta not loaded) | Listing Basics (and other listing screens), It's a Rishta! top pill, Verification Gate background, likely others | **Fixed** — font link + global sans-serif rule forced into every Android screen; It's a Rishta! verified visually |
| R2 | **Icon names rendered as text** ("expand_more", "groups", "lock", "tune"…) | Web Discover (filter bar, map controls, legend); others reported by Stitch | **Fixed** — replaced with inline SVG icons; web Discover verified visually |
| R3 | Listing stepper said "Step 1 of 4" | Listing screens | **Fixed** — "Step X of 6" |
| R4 | Employer name "Google India" shown on a profile | Room Detail | **Fixed** — "Verified company" (FR-VER-05) |
| R5 | Odd label "94% RHYTHM"; invented rule "Working Professionals Only" | Room Detail | **Fixed** — "94% match"; "Bachelors allowed" |
| R6 | Banner text truncated ("Verify with DigiLocker to U…") | Discover Locked Room | **Fixed** — banner wraps in full (verified 13 Nov) |
| R7 | Active nav icon rendered as a solid block | Discover screens | **Fixed** — active tab is a lime pill with icon + label (seen on Empty Deck, 13 Nov) |
| R8 | Double plus on "+ Widen to 35 min" | Empty Deck | **Fixed** — single "+" icon (verified 13 Nov) |
| R9 | Invented legal claim about stamp registry | Onboarding Move-in | **Fixed** — "Most NCR flats use an 11-month agreement." |
| R10 | Names and areas truncated in list rows ("Rohan…", "Golf Co…") | Discover List View | **Fixed** — names and areas wrap to two lines (verified 13 Nov) |
| R11 | Stitch keeps inventing copy (e.g., "Serious Flatmate Hunt", "Verified Society", "Mutual reassurance", helpline text) | Many | Open — copy pass needed before build |
| R12 | Stitch's design-system card now shows different primary tones (e.g., #3204A7) after the font update | Android design system | **Fixed** — wrong-token cards deleted in both projects (Pass v4) |

### How the review was done

- Stitch was asked to audit every screen for the two rendering bugs; its "already correct" answers proved unreliable (It's a Rishta! and Verification Gate were still serif), so the fix was then forced into every screen.
- I visually checked these screens at 60–80 % zoom: Welcome, Onboarding Commute, Move-in, Habits, Discover Room Card, Discover Locked Room, Empty Deck, Discover List View, Room Detail, It's a Rishta!, Verification Result States, web Home, web Discover.
- **Not visually re-checked** after the final fix: the remaining ~30 screens (chat, safety, listing photos/video/review, profile, settings, web chat/listing/safety/admin). Run the §17.3 checklist on them before build.

## Pass v3 (13 Nov 2026, later) — logo, admin, legal pages, overlap fixes

Done:
- One logo everywhere: the exact SVG mark from `assets/logo/` (`flatrimony-mark.inline.txt`) pasted verbatim into every Android and web screen that shows the brand.
- Admin console rebuilt (single sidebar, 5-column table, clean right panel: conversation list, key-value user summary, contact, 2x2 actions); bottom buttons no longer cut off.
- New web screens: Terms of Service, Privacy Policy, Community Standards, Tenancy Guidelines (shared legal template, "Draft — pending legal review" banner, grievance-officer placeholders).
- New "Flatrimony" design system in both projects with exact tokens (#4A2FBD, #D7F26B, #C2185B, #F5F2EA, Plus Jakarta Sans). Old "Urban Kinship" card still on the Android canvas.
- Overlap/clipping pass on all web screens and all Android screens (3 batches), plus 16 targeted Android fixes: Discover card fills the screen, locked-room address wraps, Like Limit is a real bottom sheet, Rishtas title, Chat/Trusted Contacts/Passport/Profile invented claims and every Aadhaar mention removed, real café brands removed, Listing Photos no longer offers an optional uploaded video, broken biodata photo replaced, SOS shows only 112.

Verified on screen after the fixes: Discover Room Card, Discover Locked Room, Like Limit Sheet, Discover List View, Empty Deck, It's a Rishta!, Room Detail, Verification Gate + Results, Report Sheet, SOS Sent, listing screens, Settings, Scenario, admin console.

Later on 13 Nov:
- Onboarding Move-in calendar: overlapping range highlight fixed (solid purple circles on the start and end dates, lavender strip between, row gaps). The first edit did not apply; re-sent with the screen attached and checked on the canvas.
- Web Chat & Rishta Report recreated (it had been overwritten by Stitch). Stitch made two copies; the one with empty avatar placeholders was deleted. The 5 portrait/room images it generated stay on the canvas because the kept screen uses them.
- Web logo consistency: one prompt sent to all web screens to replace every header, rail, sidebar and footer logo with the exact SVG lockup (40 px in headers, 32 px in footers, ExtraBold wordmark), with no tagline inside the lockup (e.g., "DELHI NCR CO-LIVING" removed). The Terms "Last updated" date is now a `[DD Month YYYY]` placeholder. Checked after the change: Home, Discover, Chat, Listing hand-off, Safety page, Terms, Privacy, Community Standards and Tenancy Guidelines all show the same mark + wordmark.
- Follow-up fixes sent after that check: Admin console showed a second logo at the top of its right panel and clipped Suspend/Ban buttons; Listing hand-off had two-line nav labels and invented copy ("iOS capture engine launches next month", "Curated Shared Living"); Safety page had a crowded header with a clipped DigiLocker badge and invented claims ("Zero-Knowledge Public Broadcast", log-retention promise). All three were re-checked on the canvas after the fix and are clean. The Listing hand-off footer's "© 2025" was then changed to "© [YYYY] Flatrimony".
- Re-checked on the Android canvas at 72 %: the Move-in calendar fix holds (1 and 20 Dec as solid purple circles, one lavender strip per week row with gaps between rows, nothing overlapping). Empty Deck now shows a single "+" (R8), and Discover List names wrap instead of truncating (R10).

## Pass v4 (13 Nov 2026, evening) — full Android re-check, copy pass, design-system cleanup

Every Android screen that had not been re-checked was viewed on the canvas. Findings and what was done:

| Screen | Found | Status |
| --- | --- | --- |
| Welcome, Phone, OTP, Onboarding Category, Passport | Clean | Verified |
| Discover Locked Room (R6) | DigiLocker banner now wraps in full | **Fixed**, verified |
| Onboarding Intent | Invented "Popular" badge | Fix sent |
| Onboarding Budget | Big value ₹15–20K did not match the selected ₹10–20K chip | Fix sent |
| Onboarding Commute | "~1,240 rooms & people in reach" | Fix sent (number removed) |
| Empty Deck | "42 more verified rooms", "42 potential" | Fix sent (numbers removed) |
| Chat | Two headers; bottom nav dock under the composer | **Fixed**, verified |
| Decision Card | "Chats And Intros" bar + duplicated header; "Your ideal flatmate match is ready" | **Fixed**, verified |
| Rishta pakka | "Phone number shared via DigiLocker KYC" | **Fixed**, verified ("Phone numbers shared with each other") |
| Pehli Mulaqat Planner | Other user's surname; invented "Background & Gov ID Verified"; "verified cafes" | **Fixed**, verified |
| Trusted Contacts | Extra header row | **Fixed**, verified |
| Active Safety | Other user's surname; session pill overlapping the title | **Fixed**, verified (title may still shorten with "…" at narrow widths — check in build) |
| Flat Biodata Editor | Broken profile, header and gallery images (alt text showing); surname; truncated subtitle | **Fixed**, verified (real photos, "My Flat Biodata") |
| Profile Tab | Invented footer tagline | Fix sent |
| Scenario Question | Wrong title "Flatmate Profile"; "Lifestyle Sync" | Fix sent |
| Listing Money | "Zero-Brokerage Guarantee · VERIFIED" | Fix sent ("No brokerage") |
| Listing Rules | "(from your landlord)", "Landlord Guidelines", "Zero Conflict Mode" | **Fixed**, verified |

Web, same pass:
- Privacy Policy still had an "Aadhaar Privacy Notice" box — removed; the page now says DigiLocker only (verified on the canvas).
- Web Chat named real café brands ("Blue Tokai", "Chaayos") — replaced with generic wording.

Design systems (R12):
- Android: deleted "Urban Kinship" (#3204A7 primary, wrong tokens). Kept "Flatrimony" (#4A2FBD, Plus Jakarta Sans).
- Web: the card named **"Warm Editorial Modernism" is the correct one** (#4A2FBD / #D7F26B / #C2185B / #F5F2EA, Plus Jakarta Sans), so it was kept. Deleted "Flatrimony Design System" instead — it used Space Grotesk + Noto Sans and a lavender tertiary. Rename "Warm Editorial Modernism" to "Flatrimony" in Stitch when convenient.

## Hindi pass (13 Nov 2026) — core flow first

Founder's choice: Hindi for the core flow first, the rest later. Each Hindi screen is a new copy next to its English original (English unchanged), generated in 4 batches with one shared rule set:
- Same layout, colours, logo, photos and spacing; only the text changes.
- Noto Sans Devanagari (headings 700), line-height ≥ 1.6, no all-caps on Hindi.
- Glossary terms from UI doc §11.1 exactly (रिश्ता, रिश्ता मिल गया!, रिश्ता रिपोर्ट, पहली मुलाक़ात, रिश्ता पक्का, फ़्लैट बायोडाटा, फ़्लैटमेट पासपोर्ट, DigiLocker से वेरिफ़ाई करें, कुल मासिक ख़र्च, आपके ऑफ़िस तक मिनट).
- "Flatrimony", "DigiLocker" and people's first names stay in Latin script; Western digits; ₹ with Indian grouping.
- Text wraps instead of truncating (40 % expansion allowance, UI doc §13).

| Batch | Screens | Status |
| --- | --- | --- |
| 1 | Welcome, Phone Number, OTP, Onboarding Intent, Onboarding Category | Created; checked on the canvas — text wraps, no clipping |
| 2 | Onboarding Budget, Commute, Move-in, Habits, Discover Room Card | Created; checked — wraps cleanly, Move-in calendar matches English |
| 3 | Discover Locked Room, It's a Rishta!, Verification Gate, Rishtas Tab, Chat | Created; checked Locked Room, Verification Gate, Chat, Rishtas (It's a Rishta! not opened) |
| 4 | Pehli Mulaqat Planner, Trusted Contacts, Active Safety & SOS, SOS Sent | Created; checked — calm tone, 112 only, text wraps |

Notes:
- Stitch added claims in Hindi that the English screens do not have (e.g., "Flatrimony पर सभी मकान मालिक DigiLocker सत्यापित हैं" on Move-in, "100%" lines on Budget and Discover, "94% कम्पैटिबिलिटी मैच" and "वेरिफ़ाइड सोसाइटी" on Welcome, "48 नए उपलब्ध" on Commute). A cleanup prompt removed them and set every Hindi frame name to end in "(Hindi)"; Move-in, Budget and Discover were re-checked. Leftover "साझा 2BHK / 3BHK में सर्वाधिक लोकप्रिय" (most popular) on Budget (Hindi) was then removed and verified.
- Chat (Hindi) had a phone status bar ("9:41") that the English screens do not have — removed and verified.
- All Hindi strings must be reviewed by a fluent Hindi speaker before launch (UI doc §11.1).
- Web Hindi (13 Nov): Home, Discover, Chat & Rishta Report, Listing hand-off and Public Safety page now have Hindi copies (Chat checked on the canvas — clean). Admin console stays English (internal tool). The 4 legal pages are translated only after legal sign-off (task T0.15).
- Remaining Android screens — **done (13 Nov)** in 4 more batches: (A) Like Limit, Empty Deck, Discover List View, Room Detail & Rishta Report, Verification Result States; (B) Report Sheet, Decision Card, Rishta Pakka!, Listing Basics, Listing Money; (C) Listing Rules, Listing Photos, In-app Video Walkthrough, Review & My Flat, Flat Biodata Editor; (D) Profile Tab, Flatmate Passport, Scenario Question, Settings. Every Android screen now has a Hindi copy.
- Room Detail "You vs Meera" card (founder request, 13 Nov): every row now has its own icon — Bedtime (moon), Clean (sparkle), Smoke (no-smoking), Pets (paw), Food (fork and knife), Guests (two people) — as inline SVGs in a lavender circle with the label underneath, on both the English and Hindi screens. Verified on the English screen at 100 %. While doing this Stitch copied the comparison rows into the "All-In Monthly Cost" card; the cost list was restored (Base rent ₹18,000, maintenance ₹1,500, electricity ₹1,200, Wi-Fi ₹300, maid & cook ₹500 = ₹21,500, the same figures as Listing Money).
- Font fix side-effect (14 Nov): forcing a sans-serif font on Room Detail (Hindi) broke its Material Symbols icons (icon names shown as text, e.g. "check_circle"), and two repair attempts made it worse (an oversized padlock, then the comparison rows replaced by copies of the deposit note). The broken frames were deleted and **Room Detail & Rishta Report (Hindi) was regenerated** from the current English screen: inline-SVG icons only, the 6 "आप vs Meera" rows with icons, the 5-line cost card with one deposit note, and a room photo hero (Stitch first used a man's portrait — replaced). Verified on the canvas. Verification Result States (Hindi) headings set to Noto Sans Devanagari; Profile Tab (Hindi) broken photo replaced. Other Hindi screens were not affected by the font rule, but scan every Hindi screen for icon names shown as text before export.
- Stitch recreated the old "Urban Kinship" design-system card (with Epilogue/Noto Sans fonts) during the Hindi runs; it was deleted again on 14 Nov. Check for it again after any new generation — it tends to come back.

## Still pending (as of 13 Nov 2026, after Pass v4)

Design work in Stitch:
1. **Look once at the 7 "Fix sent" screens** above (Intent, Budget, Commute, Empty Deck, Profile Tab, Scenario, Listing Money). Stitch reported them done; they were not opened again.
2. ~~Copy pass, remaining~~ **Done (13 Nov):** web Discover count removed ("Verified flatmates near …"); Listing hand-off "This code expires after a short time"; Terms GST rate and named markets removed ("Prices shown include applicable taxes where required", "busy public places"); Privacy "Where Your Data Lives" now matches `03-technical-stack.md` (Supabase Mumbai + Google Cloud Mumbai, no AWS/Equinix). Stitch reported all 4 done; not re-opened.
3. **Hindi versions** — core flow done (19 screens, see "Hindi pass"); remaining Android screens and all web screens still English-only.
4. **§17.3 QA checklist + export.** Most checklist items (states, analytics, reduce-motion, tokens-only) apply to the build; the design-time items are Hindi overflow, trust rules and 360 dp spacing. Stitch's Export menu offers: AI Studio, Figma, MCP, Netlify, Lovable, Bolt, **.zip** (HTML + images download), Code to Clipboard, Project Brief. Waiting on the founder's choice; .zip into `docs/designs/` is the simplest hand-off for the build.

Needs the founder (not design work):
- Licensed hero photo for the web Home page (issue 5) and licences for the generated portrait images.
- Confirm whether the 1091 women's helpline stays next to 112 on SOS (issue 3).
- Legal review of the 4 legal pages; fill in the grievance-officer details and the `[DD Month YYYY]` / `[YYYY]` placeholders.

## Final review and export (14–15 Nov 2026)

Every screen was exported from Stitch and checked outside Stitch, because the canvas is too slow and unreliable to review by eye:
- **Automated checks on all 95 screens** (76 Android, 19 web), rendered in headless Chrome at real size: broken images, icon names showing as text, serif/fallback fonts, clipped or truncated text, horizontal overflow; plus a text scan for Aadhaar, landlord claims, hosting claims, guarantees, invented percentages and counts, surnames, other emergency numbers, café brands, "most popular", stray dates and status bars.
- **Visual review of every screen** at full size, English and Hindi side by side.

Issues found and fixed in Stitch in this round (all re-checked after the fix):
- Hindi screens: Epilogue/fallback fonts → Plus Jakarta Sans + Noto Sans Devanagari; lavender backgrounds → #F5F2EA; small headings → same size as English; text-only labels repaired on Report Sheet (Hindi).
- Karan's photo broken on Profile, Biodata Editor, Passport and It's a Rishta! (EN + HI) → one working portrait everywhere.
- Surnames removed (Meera Sharma, Priya Sharma, Rahul Mehra, "MS" initials).
- Frame names shown as page headers ("… (Hindi) Flatrimony") on Decision Card, Listing Basics, Listing Money (Hindi) → real headers.
- Non-standard logos and nav docks → the standard logo lockup and the 4-tab labelled dock.
- ~20 truncated/overlapping elements, chip rows running off-screen, a sticky button hiding Scenario option D, the Habits button covering a card, the OTP keypad gap.
- Invented content removed: landlord claims and "verified network" taglines (Hindi onboarding), photos with another app's UI baked in (Welcome, Video Walkthrough), "100% authentic", "Save ₹25,000–50,000", "24/7 gated communities", made-up grievance officer ("Sonalika Mehra"), "Pvt Ltd" and 2024/2025 dates → placeholders, real café brands, "SafeMeet".
- Web Safety share page constrained to a phone-width column; web Home hero overlap removed; web Chat (Hindi) rebuilt from the English page with working photos; duplicate Chat frames deleted.
- **Hindi versions of the 4 legal pages** (Terms, Privacy, Community Standards, Tenancy Guidelines) created, with the draft banner and a note that the English version prevails.

A few final text fixes were applied to the exported HTML only (listed in `designs/README.md`).

**Result:** all 95 screens pass the automated checks; the only remaining "landlord" mentions are legitimate (the no-landlords policy and normal tenancy advice). Final export with HTML, 2× PNGs and all images stored locally: **`docs/designs/`**.

Open items (founder, not design): Hindi copy review (T0.12), photo licences (T0.13), 1091 helpline decision (T0.14), legal review and placeholders (T0.15).
