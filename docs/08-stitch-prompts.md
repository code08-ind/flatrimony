# Flatrimony — Google Stitch Prompt Pack (v1.0 screens)

| Field | Value |
| --- | --- |
| Version | 3 (13 Nov 2026): v2 look + polish — Plus Jakarta Sans, Phosphor icons, spacing/layout/image rules, new logo |
| Source of truth | `06-ui-ux-design-standards.md` §3 (tokens), §8 (screens); `02-prd.md` (FR-IDs) |
| Scope | v1.0 Android screens + key web screens + Phase 0 landing page |

## The look in one paragraph

A mix of two Dribbble references, used as inspiration only (no assets copied). From **Matcha** (Korsa): photo-first full-bleed cards, a dark gradient at the bottom of photos, frosted-glass chips and a floating glass dock with round icon buttons, a calm earthy base. From the **Ronas IT dating UI kit**: deep purple with neon lime, pill-shaped everything, outlined vs filled chips, sticker-like rotated photo frames, sparkle stars, a lime "94%" pill and bento tiles. Kept from our docs: light and playful, Rishta pink for likes, green for verified, and plain calm screens for ID, safety and money.

| Role | Colour | Where |
| --- | --- | --- |
| Background | `#F5F2EA` matcha milk | All light screens |
| Surface | `#FFFFFF` | Cards, sheets, inputs |
| Primary | `#4A2FBD` Jamun purple | Buttons, active states, bento tiles, sent chat bubbles tint `#ECE6FF` |
| Selection / highlight | `#D7F26B` Matcha lime | Selected chips, match % pill, active dock icon — fill only, dark text |
| Decorative | `#B9A4FF` lavender | Bento tiles and illustrations, dark text only |
| Like | `#C2185B` Rishta pink | Heart button and heart icons only |
| Verified | `#1B7F4B` on `#E6F5EC` | Verified badges |
| Pending / warning | `#FFC53D` / text `#8A5A00` on `#FFF4D6` | Pending, Move Pass, scam warnings |
| Danger | `#C62828` on `#FDECEC` | SOS, report, delete |
| Immersive dark | `#17131F` | Behind photos, glass tint |
| Text | `#17141F`, secondary `#5E584A` | |

## How to use this

1. **Create one Stitch project per platform**: "Flatrimony — Android" (mobile mode) and "Flatrimony — Web" (web mode).
2. **Paste the Base style block first** and generate one throwaway screen with it, so Stitch locks the theme.
3. **Paste one screen prompt at a time.** Each starts with "Same style as before". Each prompt is tagged **[Light]**, **[Immersive]** or **[Serious]** so Stitch picks the right mode.
4. **Optional:** upload screenshots of the two Dribbble shots as image references in Stitch with the note "use only the mood, colours and component shapes, not the layout or photos". Don't publish anything that copies them.
5. **Keep sample data consistent**: Meera (28, room owner, Cyber City), Karan (24, seeker, Noida Sector 62), Priya (trusted contact).
6. **Hindi pass:** once a screen is right in English, ask Stitch: "Make a Hindi version of this screen. Use Devanagari, keep brand terms from the glossary, allow text to wrap."
7. **Check against the UI doc**, not Stitch's taste:
   - Lime is never used as text or thin lines on light backgrounds (contrast 1.25:1).
   - White text on lavender is never allowed.
   - White text on photos only sits on the dark gradient or dark glass.
   - Serious screens have no sparkles, stickers or glass.
   - 48 dp touch targets, and an icon + label on every status.
8. Export to Figma or HTML; name frames with the screen ID (e.g. `M10 Discover deck`).

---

## Base style block (paste first, both projects)

```text
Design system for "Flatrimony", an Indian flatmate-matching app (flatmates, NOT dating). Mood: playful, fresh and calm — a light, warm app with bright purple and neon-lime accents, plus immersive full-bleed photo cards with frosted glass. Desi matchmaking theme (wedding-card scallops, chai, rangoli dots) only in illustrations and celebrations. Identity, safety and money screens are plain, calm and serious.

Three screen modes:
1) LIGHT (most screens): background #F5F2EA (warm "matcha milk"), white cards #FFFFFF with radius 16–24 and very soft shadows, text #17141F, secondary text #5E584A, borders #E4DFD2.
2) IMMERSIVE (discover cards, profile header, match celebration): full-bleed photo with radius 32, dark gradient at the bottom (transparent to #17131F at 85%), white text, frosted dark-glass chips and buttons (fill #17131F at 45% opacity, background blur, thin white 18% border).
3) SERIOUS (verification, safety, SOS, report, payments): light mode, plain, no stickers, no sparkles, no glass.

Colours: primary "Jamun purple" #4A2FBD (pressed #3A2496, soft tint #ECE6FF); highlight "Matcha lime" #D7F26B used only as a FILL with dark text (selected chips, "94%" match pill, active nav icon) — never as text on light backgrounds; lavender #B9A4FF for decorative bento tiles with dark text; "Rishta pink" #C2185B only for the Like/heart button; verified green #1B7F4B (text #166B40 on #E6F5EC); yellow #FFC53D for pending/warnings with dark text (#8A5A00 on #FFF4D6); danger red #C62828 on #FDECEC.

Spacing: 20 px screen padding, 32 between sections, 20 inside cards, 8 label-to-input, 20 between fields, 12 between list cards; everything aligned to one left edge; 56 px full-width primary button; reserve 96 px above the floating dock. Images: deck photos 4:5, room grids 4:3, avatars 1:1, always cover-cropped, never stretched. Logo: lime house with two linked purple rings on a purple rounded square + "Flatrimony" wordmark in Plus Jakarta Sans ExtraBold, big and bold. Shapes: everything is pill-shaped — buttons, chips, inputs (radius full), 48–56 px tall buttons. Chips: unselected = outlined (1 px #8C8676) on white; selected = filled lime with dark text and a check. Cards radius 24, photo cards radius 32. Navigation is a floating pill dock 16 px above the bottom edge (frosted white glass on light screens, dark glass on photo screens) with 4 round icon buttons; the active one is a lime circle with a dark icon. Playful accents allowed only on onboarding, match moments and marketing: 4-point sparkle stars, sticker-like slightly rotated photo frames with white borders, bento tiles in purple and lavender.

Type: Plus Jakarta Sans for everything (Hindi in Noto Sans Devanagari). Sizes: display 32 ExtraBold, h1 26 Bold, h2 20 Bold, h3 17 SemiBold, body 15 Regular, label 14 SemiBold, caption 13 Medium. Max 3 weights per screen. Headings slightly tight letter-spacing. On photo cards the name is ExtraBold with the age Regular: "Meera 28". Prices and % use tabular numbers.

Icons: Phosphor Icons — Regular weight for UI, Fill for active/selected and the Like heart, Duotone for feature tiles; feature icons sit in 44 px tinted circles. Rules: every status has an icon + label, never colour alone. Verified people show a green "Verified" badge. Currency ₹21,500 (Indian grouping). First names only. No stock-photo people in illustrations; flat rounded illustrations with simple Indian home details.
```

---

## Android screens (mobile, 360 dp wide)

### Sign-up and onboarding

**M01 Welcome + language** [Light] (FR-AUTH-05, 07)
```text
Same style as before. LIGHT mode welcome screen. Top half: a bento collage of three rounded tiles — a purple #4A2FBD tile with a white house-with-wedding-card-scallop icon, a lavender tile with a flat illustration of two keys on a ring, and a sticker-like rotated photo frame of a bright, empty, sunlit room — plus two small lime sparkle stars. Below: wordmark "Flatrimony" in Poppins SemiBold, tagline "Rishta pakka, rent split." Bold line "Flatmates, not dating." and secondary "Verified people. Real rooms." Two pill buttons side by side: "English" (filled purple) and "हिन्दी" (outlined). Fine print: "By continuing you agree to our Terms and Privacy Policy" with links in purple.
```

**M02 Phone number** [Light] (FR-AUTH-01)
```text
Same style as before. LIGHT mode. Round back button top-left. Heading "What's your phone number?" Helper "We'll send a 6-digit code. Your number is never shown to other users." Pill-shaped input with a "+91" prefix segment and number "98123 45678", numeric keyboard at the bottom. Full-width purple pill button "Send code" above the keyboard. Small caption with lock icon: "Every member is ID-verified before chatting."
```

**M03 OTP** [Light] (FR-AUTH-01, 02)
```text
Same style as before. LIGHT mode. Heading "Enter the code", subtext "Sent to +91 98123 45678 · Wrong number?" (link in purple). Six rounded square boxes on white, the active box with a purple 2 px border, three filled. Caption "Reading SMS automatically…" with a small spinner. "Resend code in 0:24" in grey. Inline error variant below the boxes in red with icon: "That code didn't match. 4 tries left."
```

**M04 Onboarding 1/6 — Intent** [Light] (FR-AUTH-06)
```text
Same style as before. LIGHT mode. Top: round back button and a 6-segment pill progress bar (segment 1 purple). Heading "What are you looking for?" Three large white option cards (radius 24), each with an icon in a lavender circle, title and description: "I have a room to fill" — "List a room in your flat"; "I need a room" — "Find a room in an existing flat"; "Find a flatmate first" — "Team up, then search together". Second card selected: lime #D7F26B fill, dark text, a dark check circle in the corner. Bottom: full-width purple pill "Continue".
```

**M05 Onboarding 2/6 — Category** [Light] (FR-AUTH-06, FR-VER-06)
```text
Same style as before. LIGHT mode, progress 2/6. Heading "Which describes you best?" 2x2 bento grid of option tiles with icons: "Working professional" (briefcase), "Student" (graduation cap), "Women-only space" (shield), "Relocating to NCR" (suitcase). "Women-only space" selected with lime fill and dark check. Below, a calm white info card with a blue info icon: "Only women verified with DigiLocker can see you and your room. Your gender is confirmed by your ID, not by what you type." Purple pill "Continue".
```

**M06 Onboarding 3/6 — Budget** [Light] (FR-BIO-02)
```text
Same style as before. LIGHT mode, progress 3/6. Heading "What's your budget per month?" Subtext "Your share of the rent". A purple bento tile showing the value "₹15,000 – ₹20,000" in large white Poppins. Below, a range slider with a purple track and two white handles with purple borders, ₹5,000 to ₹50,000. Quick-pick outlined pill chips: "Under ₹10K", "₹10–20K" (selected, lime), "₹20–30K". Caption with info icon: "Every room shows its all-in cost: rent + maintenance + bills." Purple pill "Continue".
```

**M07 Onboarding 4/6 — Office or college + commute** [Light] (FR-BIO-03)
```text
Same style as before. LIGHT mode, progress 4/6. Heading "Where do you go every day?" Segmented pill "Office | College" (Office active in purple). Pill search field "DLF Cyber City, Gurugram". Map card (radius 24, light muted map style) with a purple pin and a translucent purple polygon for the 45-minute area. Travel-mode pill chips with icons: Metro (selected lime), Car, Two-wheeler, Walk. Slider "Max commute: 45 min". Small lime pill on the map: "~1,240 rooms & people in reach". Text link "No office? Pick areas instead". Purple pill "Continue".
```

**M08 Onboarding 5/6 — Move-in date** [Light] (FR-BIO-02)
```text
Same style as before. LIGHT mode, progress 5/6. Heading "When do you want to move in?" Outlined pill chips: "ASAP", "This month", "Next month" (selected lime), "Flexible". White calendar card (radius 24) with the range 1–20 Dec 2026 highlighted as a purple pill band with white dates. Row "Lease length" with round minus/plus buttons and "11 months". Purple pill "Continue".
```

**M09 Onboarding 6/6 — Your habits** [Light] (FR-AUTH-06, FR-BIO-04)
```text
Same style as before. LIGHT mode, progress bar full. Heading "Your habits", subtext "Be honest — it's how we find someone you can actually live with." Small lime sparkle next to the heading. Five white cards stacked, each with an icon in a lavender circle, a label and a wrap of pill chips (outlined when unselected, lime-filled with dark check when selected): Bedtime: "By 10 PM", "By 11 PM"✓, "By 12 AM", "After 1 AM". Cleaning: "Daily"✓, "Few times a week", "Weekly", "Rarely". Smoking: "No"✓, "Outside only", "Yes". Pets: "Have one", "Love them"✓, "OK", "No pets". Food: "Veg", "Eggetarian", "Non-veg"✓, "Vegan". Bottom: purple pill "Start swiping".
```

### Discover

**M10 Discover — room card** [Immersive] (FR-DISC-01, 04)
```text
Same style as before. IMMERSIVE Discover screen on #F5F2EA. Top bar: round avatar button, title "Discover", glass segmented pill "Deck | List", round filter button. One huge photo card (radius 32) filling most of the screen: full-bleed photo of a bright furnished bedroom, story-style progress dashes at the top (1 of 5), a lime pill top-right "94% match" with dark text. Bottom of the photo has a dark gradient; on it in white: "Meera 28" (age lighter) with a small green "Verified" badge; location row with pin icon "Room in 3BHK · Cyber City"; large "₹21,500/mo all-in"; row of dark-glass pill chips: "🚇 28 min to office", "By 11 PM", "Cleans daily", "Non-smoker"; small caption "Video tour recorded 3 days ago". Overlapping the bottom edge of the card: a dark-glass dock with three round buttons — Pass (white X on glass), Super like (yellow star, tiny "Move Pass" label), Like (larger, solid Rishta pink #C2185B with white heart). Floating light-glass navigation dock at the bottom: Discover (active, lime circle), Rishtas, My Flat, Profile (avatar with a thin progress ring).
```

**M11 Discover — person card + locked room** [Immersive] (FR-DISC-04, FR-DISC-12)
```text
Same style as before. Two IMMERSIVE cards side by side, same layout as the Discover room card. Left: PERSON card — portrait photo of a young Indian man in a casual shirt, lime "94%" pill, white "Karan 24" + green Verified badge, "Looking for a flatmate first", glass chips "Budget ₹15–20K", "22 min from you", "Early riser", "Veg", "No parties". Right: ROOM card seen by an unverified user — same room design but a yellow #FFC53D pill with dark lock icon and text "Verify to like this room" above the dock; the pink Like button shows a small lock badge. Pass still active.
```

**M12 Like limit sheet** [Light] (FR-DISC-08)
```text
Same style as before. LIGHT bottom sheet (radius 24 top) over a dimmed Discover deck. Lavender bento tile with a flat illustration of a chai cup and steam and two lime sparkles. Title "You've used today's 50 likes". Body "New likes unlock at midnight. Meanwhile, finish your Flat Biodata — complete profiles get more matches." Purple pill "Complete my biodata", text button "Come back tomorrow". Leave space for a future Move Pass card but don't show prices.
```

**M13 Empty deck** [Light] (FR-DISC-11)
```text
Same style as before. LIGHT Discover screen with no cards. Centre: a large lavender tile (radius 32) with a flat illustration of an empty room, a window and rangoli dots. Title "Only 3 rooms within 20 min". Body "Widen your commute to 35 minutes to see about 42 more rooms and people." Purple pill "Widen to 35 min", text link "Change my filters". Keep the top bar and floating glass dock.
```

**M14 Discover — list view** [Light] (FR-DISC-01)
```text
Same style as before. LIGHT Discover in List mode. Segmented pill "Deck | List" (List active). Horizontal pill filter chips: "Rooms" (lime selected), "People", "Max ₹25K", "≤ 45 min", "Furnished". Vertical list of white cards (radius 24): left a rounded photo (radius 16), middle "Meera, 28" + green Verified badge, "Room in 3BHK · Cyber City", three small outlined habit chips; right a lime "94%" pill, "₹21.5K/mo" and "28 min". Five rows with varied data; one with a yellow "Boosted" pill. Floating glass dock at bottom.
```

**M15 Room detail + Rishta report** [Immersive header, Light body] (FR-DISC-05)
```text
Same style as before. Scrollable detail. Header IMMERSIVE: full-bleed photo (top 55% of screen) with round glass back and overflow buttons, a glass "▶ Video tour · 1:04" pill, and on the gradient "Meera 28" + badges "Verified", "Verified company". Body LIGHT on #F5F2EA as bento tiles: (1) Purple tile "Rishta report": big lime "94%" pill, three agreements with lime check circles in white text ("Both asleep by 11 PM", "Both clean daily", "Both non-smokers"), one neutral row "Different on pets — you're OK with pets, Meera loves dogs". (2) White tile "You vs Meera": compare rows with two columns for Bedtime, Cleaning, Smoking, Pets, Food, Guests and a small similarity dot. (3) White tile "All-in monthly cost": rent ₹18,000, maintenance ₹1,500, electricity ~₹1,200, Wi-Fi ₹300, maid ₹500, bold total "₹21,500 per month"; deposit ₹36,000 separate; green pill "Brokerage ₹0". (4) Lavender tile "House rules" with icon rows. (5) Small map tile with an approximate circle: "Exact address shared after you both agree". Sticky dark-glass dock at the bottom with Pass and pink Like.
```

**M16 It's a Rishta!** [Immersive] (FR-DISC-06)
```text
Same style as before. IMMERSIVE full-screen celebration on deep purple #4A2FBD with soft confetti, lime sparkle stars and a subtle scalloped wedding-card border. Two sticker-like photo frames (white borders, rotated −6° and +6°) overlapping in the centre, with a lime "94%" pill badge between them. Heading in white Poppins: "It's a Rishta!" Subtext "You and Meera both sleep by 11 and clean daily." A white rounded room chip: thumbnail + "Room in 3BHK · Cyber City · ₹21,500/mo". Lime pill button with dark text "Say hi", ghost white button "Keep swiping". Variant note: if unverified, the main button reads "Verify to say hi".
```

### Verification

**M17 Verification gate** [Serious] (FR-VER-01, 02)
```text
Same style as before. SERIOUS mode: no sparkles, no glass. White bottom sheet over a chat screen. Lock icon in a green-tint circle. Title "Verify to start chatting". Body "Everyone you chat with on Flatrimony is verified with DigiLocker." Three rows with green check icons: "Takes about a minute", "We keep only your name, age and gender — never your documents", "Unlocks the Verified badge". Purple pill "Verify with DigiLocker". Text button "Not now". Caption "Powered by a licensed DigiLocker partner".
```

**M18 Verification result states** [Serious] (FR-VER-07, 08)
```text
Same style as before. SERIOUS mode. Three phone frames of the same LIGHT screen. 1) Checking: spinner, "Checking your details with DigiLocker…" 2) Success: large green check in a green-tint circle, "You're verified", badge preview "Verified · Name, age, gender confirmed", purple pill "Start chatting". 3) Failure (name mismatch): yellow-tint card with icon "Your display name doesn't match your ID", explanation "Your ID says 'Karan Mehta'. Use your first name so people know you're real.", pill input prefilled "Karan", purple pill "Update and retry", link "Get help". No humour.
```

### Rishtas and chat

**M19 Rishtas tab** [Light] (FR-CHAT-01, FR-NOTIF-02)
```text
Same style as before. LIGHT mode, Rishtas active in the floating glass dock. Header "Rishtas". "New Rishtas": horizontal row of circular avatars with green verified rings and names; the first is a lavender "+3 more" circle. "Upcoming Pehli Mulaqat": purple bento card with a chai-cups icon, white text "Sat, 16 Nov · 5:00 PM · Flat visit with Meera". "Likes you": lavender tile with blurred avatars "12 people like you" and a yellow "Move Pass" pill. "Chats": white list rows with avatar, name, status pill (Chatting = lavender, Met = purple tint, Rishta pakka = green with check), last message, time, unread purple dot.
```

**M20 Chat** [Light] (FR-CHAT-01..03, 05)
```text
Same style as before. LIGHT one-to-one chat. Header: round back button, avatar with green ring, "Meera" + lime "94%" pill + status pill "Chatting", round overflow button. A thin step timeline under the header: "Chat ✓ → Verify ✓ → Meet first". Received bubbles white, sent bubbles Jamun purple with white text and read ticks (radius 20, pill-like). One yellow warning bubble from the system with alert icon: "Never pay a token or deposit before visiting the flat. Report if someone asks." A centred system pill "You shared your number · waiting for Meera". Composer: white pill text field "Message", round purple send button, and a lime pill above it "📅 Plan Pehli Mulaqat".
```

**M21 Report sheet** [Serious] (FR-CHAT-06, PRD §9)
```text
Same style as before. SERIOUS mode. White bottom sheet "Report Meera". Radio list with icons: "Fake profile", "Broker or agent", "Asked for money before visit", "Harassment", "Threat or safety concern" (small red pill "Reviewed first"), "Sexual content", "Spam", "Something else". Text area "Tell us more (optional)". Checkbox "Also block Meera". Red pill "Send report". Caption "Meera won't know who reported."
```

### Pehli Mulaqat and safety

**M22 Pehli Mulaqat planner** [Light] (FR-MEET-01, FR-SAFE-02)
```text
Same style as before. LIGHT bottom sheet "Plan Pehli Mulaqat" with a chai-cups icon in a lavender circle. Pill rows: Date "Sat, 16 Nov", Time "5:00 PM" (15-minute steps), Place chips "The flat" (lime selected) / "A public place", pill search field. Toggle row (purple when on) "Share live location with my trusted contacts during this visit" with caption "Priya gets a link. Ends after 3 hours or when you tap I'm safe." Yellow-tint note "Never pay before visiting." Purple pill "Send proposal".
```

**M23 Decision — Still interested?** [Light] (FR-MEET-03)
```text
Same style as before. LIGHT card inside the chat after the meet-up (white, radius 24). Title "Still interested in living with Meera?" Caption with eye-off icon "Meera won't see your answer." Two stacked pills: purple "Yes, let's do it", outlined "No, not for me". Second variant (closed): neutral message "This Rishta didn't work out. Your perfect flatmate is still out there." with a purple pill "Back to Discover". No sad imagery.
```

**M24 Rishta pakka** [Immersive] (FR-MEET-03)
```text
Same style as before. IMMERSIVE celebration on deep purple with lime sparkles and confetti once. A white house icon inside a lime circle. Heading "Rishta pakka! 🏠" in white Poppins. Subtext "You and Meera both said yes. Time to plan the move." White bento card "Next steps" with checklist: "Share your number" (green check), "Agree rent & deposit split", "Set up Ghar — coming soon" greyed. Lime pill "Open chat".
```

**M25 Trusted contacts** [Serious] (FR-SAFE-01)
```text
Same style as before. SERIOUS mode. Screen "Trusted contacts". Text "They'll get your live location during visits and any SOS alert. Up to 3 people." Two white rows: "Priya · •••• 4521", "Rahul · •••• 0087", each with "Send test message" and a remove icon. A dashed pill row "+ Add a trusted contact". Blue info card: "Contacts don't need the app — they get an SMS/WhatsApp link."
```

**M26 Active safety session + SOS** [Serious] (FR-SAFE-02, 03)
```text
Same style as before. SERIOUS mode on a LIGHT chat screen. Persistent green-tint pill banner at the top: location icon, "Sharing live location with Priya · ends 7:45 PM", small white pill "I'm safe". Round solid red #C62828 floating button bottom-right with a white shield icon and label "SOS" (above the glass dock). Second frame: the SOS button being held — a red progress ring filling around it, text "Hold for 2 seconds to send SOS", and a text link "Send SOS without holding".
```

**M27 SOS sent** [Serious] (FR-SAFE-03)
```text
Same style as before. SERIOUS mode, red accents only. Large check in a red-tint circle. Title "Alert sent to Priya and Rahul". Body "They have your current location and meet-up details." Very large red pill "Call 112". Outlined pill "I'm safe now". Status rows: "Priya — delivered" (green), "Rahul — sending…".
```

### Listings (My Flat)

**M28 Listing stepper — Basics** [Light] (FR-LST-01, 02)
```text
Same style as before. LIGHT "List your room" stepper: pill step indicator Basics · Money · Rules · Photos · Video · Review (Basics active purple). Fields: Area pill select "Gurugram — Cyber City"; map card with a draggable purple pin, caption "Only an approximate area is shown until you both agree"; BHK pill chips 1–4+; Room type chips "Private" / "Shared"; Furnishing chips; Available from date; "2 of 3 flatmates living there". Footer: text button "Save draft", purple pill "Next".
```

**M29 Listing stepper — Money** [Light] (FR-LST-03)
```text
Same style as before. LIGHT step 2 "Money". Pill inputs with ₹ prefix: Rent ₹18,000; Deposit ₹36,000; Maintenance ₹1,500; Electricity ~₹1,200; Wi-Fi ₹300; Maid/cook ₹500; Other ₹0. Sticky purple bento tile at the bottom: "All-in monthly cost per person" and large white "₹21,500". Green pill "Brokerage-free — brokerage can't be charged on Flatrimony". Section "One-time costs" with "+ Add".
```

**M30 Listing stepper — Rules** [Light] (FR-LST-04)
```text
Same style as before. LIGHT step 3 "House rules (from your landlord)". Caption "Seekers who don't fit these won't see your room." White toggle cards with icons in lavender circles: "Bachelors allowed" (on, purple toggle), "Pets allowed" (off), "Smoking allowed" (off). Pill choice rows: Food "Any / Veg only / Eggetarian OK"; Guests "Allowed / Daytime only / Not allowed"; Flatmate gender "Any / Women only / Men only". Selected chips lime.
```

**M31 Listing stepper — Photos** [Light] (FR-LST-05)
```text
Same style as before. LIGHT step 4 "Photos". Caption "Add 3 to 12 photos. Drag to reorder. The first is the cover." 3-column grid of rounded photo tiles (radius 16): 5 room photos with drag handles, the first with a lime "Cover" pill, one tile uploading with a spinner, one dashed "+ Add photo" tile. Counter pill "5/12".
```

**M32 In-app video recorder** [Immersive] (FR-LST-05)
```text
Same style as before. IMMERSIVE camera UI. Full-screen viewfinder of a living room. Top: dark-glass pill "Show the room, kitchen, bathroom and balcony". Timer pill "0:42 / 1:30" with a thin progress bar that turns lime after 0:30 ("minimum reached"). Bottom dark-glass dock: "Retake" round button, large red record button, "Done" round button (disabled until 30 s). Caption "Recorded in the app so seekers know it's real — gallery videos aren't allowed."
```

**M33 Listing review + My Flat** [Light] (FR-LST-07, 08, 09)
```text
Same style as before. LIGHT, two frames. 1) Review: a mini preview of the immersive room card, checklist with green checks (Basics, Money, Rules, 6 photos, Video 1:04), purple pill "Submit listing", caption "Most listings go live right away; some are checked by our team." 2) My Flat tab: green pill "Active · expires in 4 days"; large lime pill button "Still available ✓" with caption "Tap once a week to keep your room visible"; bento stats tiles — purple "Views 214", lavender "Likes 18", white "Rishtas 3"; buttons Edit, Pause.
```

### Profile

**M34 Profile tab** [Light] (FR-BIO-01, FR-PASS-01)
```text
Same style as before. LIGHT Profile tab (active in glass dock). Header: large circular photo with a purple progress ring "70%" and caption "Flat Biodata 70% complete", "Karan, 24", green "Verified" badge, outlined pill "Preview as others see me". Bento grid: purple tile "Flat Biodata", white tile "Verification centre" (green Verified), lavender tile "Flatmate Passport", white tile "Trusted contacts" (yellow "Add one"), white tile "Settings". A lime nudge pill-card with sparkle: "Answer 5 quick scenarios to improve your matches" + "Start".
```

**M35 Flat Biodata editor** [Light] (FR-BIO-01..06)
```text
Same style as before. LIGHT "Flat Biodata". White cards with a round pencil button and summaries: Basics; Budget & dates; Office & commute "Cyber City · Metro · 45 min"; Habits (lime chips); "What matters most" — each habit with a segmented pill Deal-breaker / Matters / Don't care; Scenario questions "3 of 5 answered" with a pill progress bar; Photos (row of rounded thumbnails). Toggle "Pause my profile — hide me from Discover".
```

**M36 Scenario question** [Light] (FR-BIO-06)
```text
Same style as before. LIGHT. Pill label "Scenario 2 of 5". Lavender tile (radius 32) with a flat illustration of a sink with dishes and a clock at 10 PM, one lime sparkle. Question "There are 5 dishes in the sink at 10 PM. What happens?" Four white answer cards (radius 24): "I wash them right now", "First thing tomorrow", "When I need a plate", "Someone else usually does it" — one selected in lime with dark check. Caption "No right answer — honest answers get better matches." Purple pill "Next".
```

**M37 Flatmate Passport** [Serious] (FR-PASS-01)
```text
Same style as before. SERIOUS mode, trustworthy. A white passport-style card (radius 24) with a small purple stamp icon: "Flatmate Passport", "Karan", "Member since Nov 2026". Rows with green checks: "Identity verified with DigiLocker", "Works at a verified company". Greyed section "Coming soon: confirmations from past flatmates (e.g., 'Tidy · confirmed by 3')" and "References visible only to your Rishtas". No stars, no sparkles.
```

**M38 Settings** [Light] (FR-PRIV-01..03, FR-NOTIF-03)
```text
Same style as before. LIGHT settings in white grouped cards (radius 24): Account (Language pill "English | हिन्दी", Phone number), Notifications (purple toggles, Quiet hours 11 PM–8 AM), Privacy (Pause profile, Hide my age, Blocked users, Consents), Your data ("Download my data", "Delete account" in red), Help & legal. Calm copy, no decorations.
```

---

## Web screens (desktop 1440 px, responsive)

**W01 Landing page + waitlist (Phase 0)** [Light, marketing] (T0.4)
```text
Same style as before, web landing page. LIGHT #F5F2EA. Hero left: headline "Know how they live before you sign." in large Poppins, sub "Verified flatmates in Delhi NCR, matched on budget, commute and habits — flatmates, not dating." Purple pill "Join the waitlist", outlined pill "How it works". Language pill EN | हिन्दी top-right. Hero right: a bento cluster — a phone mockup of the immersive Discover card (Meera 28, lime 94%), a sticker-like rotated room photo, a purple tile "94% match" in lime, lime sparkle stars. Section "You vs your flatmate": two playful tiles "11 PM vs 2 AM" (lavender vs purple) and "Cleans daily vs Never". Section "Before you sign anything": 3-step timeline in pills — Chat → Verify IDs → Meet first. Bento grid "Why it's different": DigiLocker-verified, real video tours, broker-free, commute matching, women-only spaces. Waitlist form card: phone or email, "I'm a…" pill chips (Professional / Student / Women-only / Relocating), budget select, office area select, purple pill "Join the waitlist". Footer with legal links.
```

**W02 Discover — list + map** [Light + Immersive cards] (FR-DISC-01, UI §8.5)
```text
Same style as before, web app. LIGHT. Left floating pill navigation rail (Discover active with lime circle, Rishtas, My Flat, Profile, Help). Top bar with language pill, bell, avatar. Main split: left a grid of immersive photo cards (radius 32, gradient, white name "Meera 28", lime "94%", glass chips "₹21,500/mo", "28 min", round glass Pass and pink Like); right a sticky map card (radius 24) with translucent purple approximate circles (no exact pins) and a purple commute polygon; a hovered card highlights its circle. Pill filter bar: Rooms/People, Max rent, Max commute, Room type, Furnishing; "Deck | List" toggle.
```

**W03 Chat — two pane** [Light] (FR-CHAT-01)
```text
Same style as before, web. LIGHT. Left pane: Rishtas list with pill search, status pills and purple unread dots. Centre: open chat with Meera (purple sent bubbles, white received, the yellow safety warning bubble, lime "Plan Pehli Mulaqat" pill). Right collapsible panel: purple bento "Rishta report" (lime 94%, top agreements, biggest gap) and a small room card.
```

**W04 Listing — continue on your phone** [Light] (FR-LST-05)
```text
Same style as before, web. LIGHT. Pill stepper Basics ✓ · Money ✓ · Rules ✓ · Photos ✓ · Video (active) · Review. Main white card (radius 32): lavender tile with a phone illustration, title "Record your video walkthrough on your Android phone", body "Videos must be recorded in the Flatrimony app so seekers know the room is real. Your draft is saved." Large QR code in a white frame, purple pill "Send link to my phone", caption "Using an iPhone? Ask a flatmate with Android to record it from their account — iPhone app coming soon." Outlined pill "Save and exit".
```

**W05 Public safety share page** [Serious] (FR-SAFE-02)
```text
Same style as before, mobile web page for a trusted contact (no app, no login). SERIOUS mode. Header "Priya, Ananya is sharing her location with you". Map card with her latest position and "Updated 1 min ago". White card: "Visiting a flat · Sat 16 Nov, 5:00 PM · Sector 43, Gurugram". Green pill "Session active · ends 8:00 PM". Large purple pill "Call Ananya". Info "If you think she's in danger, call 112." Expired variant: "This sharing session has ended."
```

**W06 Admin — reports queue** [Light, dense] (FR-ADM-01..05, UI §8.15)
```text
Same style as before but a dense desktop admin UI: smaller radii (12), no sparkles, no glass. Left sidebar: Reports, Listings review, Broker signals, Verifications, Users, Audit log, Config (active item purple tint). Main table: Priority (red "Safety" pill for P1), Reason, Target, Reporter, Age (SLA timer turning red past 2 h), Status. Right detail pane: context messages around the reported message, user summary (verification status, prior reports, broker risk bar), masked phone "+91 ••••• •4521" with "Reveal (reason required)", action buttons Warn / Remove content / Suspend / Ban that open dialogs requiring a reason. Hint bar "J/K move · A action".
```

---

## Screen checklist

| ID | Screen | Mode | Platform | Release |
| --- | --- | --- | --- | --- |
| M01–M09 | Welcome, phone, OTP, onboarding 6 steps | Light | Android (+ web same flow) | v1.0 |
| M10, M11, M15, M16 | Discover cards, detail header, It's a Rishta! | Immersive | Android | v1.0 |
| M12–M14 | Like limit, empty deck, list | Light | Android | v1.0 |
| M17–M18 | Verification gate and results | Serious | Android | v1.0 |
| M19–M23 | Rishtas, chat, report, meet-up, decision | Light / Serious | Android | v1.0 |
| M24 | Rishta pakka | Immersive | Android | v1.0 |
| M25–M27 | Trusted contacts, safety session, SOS | Serious | Android | v1.0 |
| M28–M33 | Listing stepper, recorder, My Flat | Light (recorder Immersive) | Android | v1.0 |
| M34–M38 | Profile, biodata, scenario, Passport, settings | Light (Passport Serious) | Android | v1.0 |
| W01 | Landing + waitlist | Light | Web | Phase 0 (design this first) |
| W02–W06 | Discover, chat, listing hand-off, safety page, admin | Mixed | Web | v1.0 |

Not included (later releases): Ghar stay tools, move-in log, bills, chores (v1.1–v1.2), Move Pass purchase (v1.1).

## Polish block (v3) — paste when editing existing screens

```text
Edit these existing screens in place (do not create new screens) to apply the Flatrimony polish: 1) Font: Plus Jakarta Sans everywhere (ExtraBold for display/titles, Bold for headings, SemiBold for labels/buttons, Regular for body; max 3 weights per screen). 2) Icons: Phosphor icon style — Regular for UI, Fill for active/selected, Duotone inside 44 px tinted circles for feature tiles. 3) Spacing: 20 px screen side padding; 16 below the top bar to the title; 8 title-to-subtitle; 24 to the first component; 32 between sections; 20 inside cards; 12 between list cards; 8 label-to-input; 20 between form fields; text never closer than 16 to a container edge; 96 px clear above the floating dock. 4) Alignment: one left edge for titles, text, cards and inputs; rows vertically centred; trailing values right-aligned; equal-height cards; one primary button per screen, full width, 56 high. 5) Images: cover-cropped, never stretched; deck photos 4:5, room grids 4:3, avatars 1:1 with a 2 px ring. 6) Header logo: the Flatrimony mark (lime house with two linked purple rings on a purple rounded square) + "Flatrimony" wordmark in Plus Jakarta Sans ExtraBold, at least 28 px tall. Keep all content, colours and copy the same.
```

## Design references (inspiration only)

- Matcha – Dating Mobile App, Anam Khoirul for Korsa — https://dribbble.com/shots/26179650-Matcha-Dating-Mobile-App
- Mobile UI Kit for Dating App, Ronas IT — https://dribbble.com/shots/25272356-Mobile-UI-Kit-for-Dating-App
