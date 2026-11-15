# Message files

- `en.json` and `hi.json` must have identical keys and identical ICU placeholders (enforced by tests).
- Hindi strings come from `docs/06-ui-ux-design-standards.md` §11.1 and the Hindi Stitch exports in `docs/designs/`.
  Strings not taken from those sources (for example `state.*`, `safety.emergencyNumber`, `money.*`) are agent drafts.
- **All Hindi copy is pending review by a fluent Hindi speaker (founder task T0.12) before launch.**
- No string concatenation: full sentences with ICU placeholders.
- Tab labels `tabs.discover|rishtas|myFlat|profile` (Hindi) come from the Android Hindi exports; `tabs.saved` and `state.comingSoon` in Hindi are agent drafts.
