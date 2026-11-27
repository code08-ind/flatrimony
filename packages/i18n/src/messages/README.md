# Message files

- `en.json` and `hi.json` must have identical keys and identical ICU placeholders (enforced by tests).
- Hindi strings come from `docs/06-ui-ux-design-standards.md` §11.1 and the Hindi Stitch exports in `docs/designs/`.
  Strings not taken from those sources (for example `state.*`, `safety.emergencyNumber`, `money.*`) are agent drafts.
- **All Hindi copy is pending review by a fluent Hindi speaker (founder task T0.12) before launch.**
- No string concatenation: full sentences with ICU placeholders.
- Tab labels `tabs.discover|rishtas|myFlat|profile` (Hindi) come from the Android Hindi exports; `tabs.saved` and `state.comingSoon` in Hindi are agent drafts.
- T2.4 auth screens: Hindi for welcome/phone/OTP copy comes from the Android Hindi exports (M01–M03); `auth.phone.invalid`, `auth.phone.clear`, `auth.otp.codeLabel`, `auth.otp.tooManyAttempts`, `auth.otp.resent`, `auth.errors.*`, `common.*` are agent drafts. `legal.consent` uses rich-text tags `<terms>`/`<privacy>` for links.
- T3.7 walkthrough recorder: all `listing.video.*` Hindi strings are agent drafts.
- T3.9 listing editor and My Flat: all `listing.editor.*` and `listing.myFlat.*` Hindi strings are agent drafts.
- T3.10 listing expiry: `notifications.listing.*` Hindi strings are agent drafts (`expiring` follows docs/05 §10, "Is your room still available?").
