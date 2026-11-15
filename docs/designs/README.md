# Flatrimony — Design Export

Final screens exported from Google Stitch on 15 Nov 2026 after the full review in `../09-stitch-design-review.md`. Every screen has English and Hindi versions (except the internal admin console).

## Folder layout

| Path | What it is |
| --- | --- |
| `android/<en|hi>/<screen>/index.html` | Screen as HTML (Tailwind CDN + Google Fonts). Open in a browser at 390 px wide. |
| `android/<en|hi>/<screen>/screen.png` | Full-page render of that HTML at 2× (780 px wide). |
| `web/<en|hi>/<screen>/index.html`, `screen.png` | Web screens, 1440 px wide (PNG at 2×). |
| `assets/img/` | Every photo used by the screens, downloaded locally; the HTML points here, so nothing depends on Stitch. |
| `assets/generated/` | Standalone images Stitch generated (portraits, room photos). |
| `design-system/` | Stitch design-system notes (tokens) for Android and web. The source of truth for tokens is `../06-ui-ux-design-standards.md`. |

**Note:** a few final copy fixes were applied to the exported HTML (not in Stitch): fonts forced to Plus Jakarta Sans + Noto Sans Devanagari, truncation replaced by wrapping, café brand names removed, "SafeMeet" renamed "safety session", Hindi Community Standards headings cleaned, and "Member since" set to 2026. Re-apply them if screens are regenerated in Stitch.

## Android (38 screens × EN/HI)

| ID | Screen | English | Hindi |
| --- | --- | --- | --- |
| M01 | Welcome | [HTML](android/en/welcome/index.html) · [PNG](android/en/welcome/screen.png) | [HTML](android/hi/welcome/index.html) · [PNG](android/hi/welcome/screen.png) |
| M02 | Phone number | [HTML](android/en/phone_number/index.html) · [PNG](android/en/phone_number/screen.png) | [HTML](android/hi/phone_number/index.html) · [PNG](android/hi/phone_number/screen.png) |
| M03 | Otp verification | [HTML](android/en/otp_verification/index.html) · [PNG](android/en/otp_verification/screen.png) | [HTML](android/hi/otp_verification/index.html) · [PNG](android/hi/otp_verification/screen.png) |
| M04 | Onboarding intent | [HTML](android/en/onboarding_intent/index.html) · [PNG](android/en/onboarding_intent/screen.png) | [HTML](android/hi/onboarding_intent/index.html) · [PNG](android/hi/onboarding_intent/screen.png) |
| M05 | Onboarding category | [HTML](android/en/onboarding_category/index.html) · [PNG](android/en/onboarding_category/screen.png) | [HTML](android/hi/onboarding_category/index.html) · [PNG](android/hi/onboarding_category/screen.png) |
| M06 | Onboarding budget | [HTML](android/en/onboarding_budget/index.html) · [PNG](android/en/onboarding_budget/screen.png) | [HTML](android/hi/onboarding_budget/index.html) · [PNG](android/hi/onboarding_budget/screen.png) |
| M07 | Onboarding commute | [HTML](android/en/onboarding_commute/index.html) · [PNG](android/en/onboarding_commute/screen.png) | [HTML](android/hi/onboarding_commute/index.html) · [PNG](android/hi/onboarding_commute/screen.png) |
| M08 | Onboarding move in | [HTML](android/en/onboarding_move_in/index.html) · [PNG](android/en/onboarding_move_in/screen.png) | [HTML](android/hi/onboarding_move_in/index.html) · [PNG](android/hi/onboarding_move_in/screen.png) |
| M09 | Onboarding habits | [HTML](android/en/onboarding_habits/index.html) · [PNG](android/en/onboarding_habits/screen.png) | [HTML](android/hi/onboarding_habits/index.html) · [PNG](android/hi/onboarding_habits/screen.png) |
| M10 | Discover room card | [HTML](android/en/discover_room_card/index.html) · [PNG](android/en/discover_room_card/screen.png) | [HTML](android/hi/discover_room_card/index.html) · [PNG](android/hi/discover_room_card/screen.png) |
| M11 | Discover locked room | [HTML](android/en/discover_locked_room/index.html) · [PNG](android/en/discover_locked_room/screen.png) | [HTML](android/hi/discover_locked_room/index.html) · [PNG](android/hi/discover_locked_room/screen.png) |
| M12 | Like limit’sheet | [HTML](android/en/like_limit_sheet/index.html) · [PNG](android/en/like_limit_sheet/screen.png) | [HTML](android/hi/like_limit_sheet/index.html) · [PNG](android/hi/like_limit_sheet/screen.png) |
| M13 | Empty deck | [HTML](android/en/empty_deck/index.html) · [PNG](android/en/empty_deck/screen.png) | [HTML](android/hi/empty_deck/index.html) · [PNG](android/hi/empty_deck/screen.png) |
| M14 | Discover list view | [HTML](android/en/discover_list_view/index.html) · [PNG](android/en/discover_list_view/screen.png) | [HTML](android/hi/discover_list_view/index.html) · [PNG](android/hi/discover_list_view/screen.png) |
| M15 | Room detail rishta report | [HTML](android/en/room_detail_rishta_report/index.html) · [PNG](android/en/room_detail_rishta_report/screen.png) | [HTML](android/hi/room_detail_rishta_report/index.html) · [PNG](android/hi/room_detail_rishta_report/screen.png) |
| M16 | It’s a rishta | [HTML](android/en/it_s_a_rishta/index.html) · [PNG](android/en/it_s_a_rishta/screen.png) | [HTML](android/hi/it_s_a_rishta/index.html) · [PNG](android/hi/it_s_a_rishta/screen.png) |
| M17 | Verification gate | [HTML](android/en/verification_gate/index.html) · [PNG](android/en/verification_gate/screen.png) | [HTML](android/hi/verification_gate/index.html) · [PNG](android/hi/verification_gate/screen.png) |
| M18 | Verification result states | [HTML](android/en/verification_result_states/index.html) · [PNG](android/en/verification_result_states/screen.png) | [HTML](android/hi/verification_result_states/index.html) · [PNG](android/hi/verification_result_states/screen.png) |
| M19 | Rishtas tab | [HTML](android/en/rishtas_tab/index.html) · [PNG](android/en/rishtas_tab/screen.png) | [HTML](android/hi/rishtas_tab/index.html) · [PNG](android/hi/rishtas_tab/screen.png) |
| M20 | Chat | [HTML](android/en/chat/index.html) · [PNG](android/en/chat/screen.png) | [HTML](android/hi/chat/index.html) · [PNG](android/hi/chat/screen.png) |
| M21 | Report sheet | [HTML](android/en/report_sheet/index.html) · [PNG](android/en/report_sheet/screen.png) | [HTML](android/hi/report_sheet/index.html) · [PNG](android/hi/report_sheet/screen.png) |
| M22 | Pehli mulaqat planner | [HTML](android/en/pehli_mulaqat_planner/index.html) · [PNG](android/en/pehli_mulaqat_planner/screen.png) | [HTML](android/hi/pehli_mulaqat_planner/index.html) · [PNG](android/hi/pehli_mulaqat_planner/screen.png) |
| M23 | Decision card | [HTML](android/en/decision_card/index.html) · [PNG](android/en/decision_card/screen.png) | [HTML](android/hi/decision_card/index.html) · [PNG](android/hi/decision_card/screen.png) |
| M24 | Rishta pakka | [HTML](android/en/rishta_pakka/index.html) · [PNG](android/en/rishta_pakka/screen.png) | [HTML](android/hi/rishta_pakka/index.html) · [PNG](android/hi/rishta_pakka/screen.png) |
| M25 | Trusted contacts | [HTML](android/en/trusted_contacts/index.html) · [PNG](android/en/trusted_contacts/screen.png) | [HTML](android/hi/trusted_contacts/index.html) · [PNG](android/hi/trusted_contacts/screen.png) |
| M26 | Active safety session sos | [HTML](android/en/active_safety_session_sos/index.html) · [PNG](android/en/active_safety_session_sos/screen.png) | [HTML](android/hi/active_safety_session_sos/index.html) · [PNG](android/hi/active_safety_session_sos/screen.png) |
| M27 | Sos sent | [HTML](android/en/sos_sent/index.html) · [PNG](android/en/sos_sent/screen.png) | [HTML](android/hi/sos_sent/index.html) · [PNG](android/hi/sos_sent/screen.png) |
| M28 | Listing basics | [HTML](android/en/listing_basics/index.html) · [PNG](android/en/listing_basics/screen.png) | [HTML](android/hi/listing_basics/index.html) · [PNG](android/hi/listing_basics/screen.png) |
| M29 | Listing money | [HTML](android/en/listing_money/index.html) · [PNG](android/en/listing_money/screen.png) | [HTML](android/hi/listing_money/index.html) · [PNG](android/hi/listing_money/screen.png) |
| M30 | Listing rules | [HTML](android/en/listing_rules/index.html) · [PNG](android/en/listing_rules/screen.png) | [HTML](android/hi/listing_rules/index.html) · [PNG](android/hi/listing_rules/screen.png) |
| M31 | Listing photos | [HTML](android/en/listing_photos/index.html) · [PNG](android/en/listing_photos/screen.png) | [HTML](android/hi/listing_photos/index.html) · [PNG](android/hi/listing_photos/screen.png) |
| M32 | In app video walkthrough | [HTML](android/en/in_app_video_walkthrough/index.html) · [PNG](android/en/in_app_video_walkthrough/screen.png) | [HTML](android/hi/in_app_video_walkthrough/index.html) · [PNG](android/hi/in_app_video_walkthrough/screen.png) |
| M33 | Review and my flat | [HTML](android/en/review_and_my_flat/index.html) · [PNG](android/en/review_and_my_flat/screen.png) | [HTML](android/hi/review_and_my_flat/index.html) · [PNG](android/hi/review_and_my_flat/screen.png) |
| M34 | Profile tab | [HTML](android/en/profile_tab/index.html) · [PNG](android/en/profile_tab/screen.png) | [HTML](android/hi/profile_tab/index.html) · [PNG](android/hi/profile_tab/screen.png) |
| M35 | Flat biodata editor | [HTML](android/en/flat_biodata_editor/index.html) · [PNG](android/en/flat_biodata_editor/screen.png) | [HTML](android/hi/flat_biodata_editor/index.html) · [PNG](android/hi/flat_biodata_editor/screen.png) |
| M36 | Scenario question | [HTML](android/en/scenario_question/index.html) · [PNG](android/en/scenario_question/screen.png) | [HTML](android/hi/scenario_question/index.html) · [PNG](android/hi/scenario_question/screen.png) |
| M37 | Flatmate passport | [HTML](android/en/flatmate_passport/index.html) · [PNG](android/en/flatmate_passport/screen.png) | [HTML](android/hi/flatmate_passport/index.html) · [PNG](android/hi/flatmate_passport/screen.png) |
| M38 | Settings | [HTML](android/en/settings/index.html) · [PNG](android/en/settings/screen.png) | [HTML](android/hi/settings/index.html) · [PNG](android/hi/settings/screen.png) |

## Web (10 screens)

| ID | Screen | English | Hindi |
| --- | --- | --- | --- |
| W01 | Landing page waitlist | [HTML](web/en/landing_page_waitlist/index.html) · [PNG](web/en/landing_page_waitlist/screen.png) | [HTML](web/hi/landing_page_waitlist/index.html) · [PNG](web/hi/landing_page_waitlist/screen.png) |
| W02 | Discover flatmates list map | [HTML](web/en/discover_flatmates_list_map/index.html) · [PNG](web/en/discover_flatmates_list_map/screen.png) | [HTML](web/hi/discover_flatmates_list_map/index.html) · [PNG](web/hi/discover_flatmates_list_map/screen.png) |
| W03 | Chat rishta report | [HTML](web/en/chat_rishta_report/index.html) · [PNG](web/en/chat_rishta_report/screen.png) | [HTML](web/hi/chat_rishta_report/index.html) · [PNG](web/hi/chat_rishta_report/screen.png) |
| W04 | Listing stepper video handover | [HTML](web/en/listing_stepper_video_handover/index.html) · [PNG](web/en/listing_stepper_video_handover/screen.png) | [HTML](web/hi/listing_stepper_video_handover/index.html) · [PNG](web/hi/listing_stepper_video_handover/screen.png) |
| W05 | Public safety share emergency contact | [HTML](web/en/public_safety_share_emergency_contact/index.html) · [PNG](web/en/public_safety_share_emergency_contact/screen.png) | [HTML](web/hi/public_safety_share_emergency_contact/index.html) · [PNG](web/hi/public_safety_share_emergency_contact/screen.png) |
| W06 | Safety reports queue moderation console | [HTML](web/en/safety_reports_queue_moderation_console/index.html) · [PNG](web/en/safety_reports_queue_moderation_console/screen.png) | English only (internal tool) |
| W07 | Terms of service | [HTML](web/en/terms_of_service/index.html) · [PNG](web/en/terms_of_service/screen.png) | [HTML](web/hi/terms_of_service/index.html) · [PNG](web/hi/terms_of_service/screen.png) |
| W08 | Privacy policy | [HTML](web/en/privacy_policy/index.html) · [PNG](web/en/privacy_policy/screen.png) | [HTML](web/hi/privacy_policy/index.html) · [PNG](web/hi/privacy_policy/screen.png) |
| W09 | Community standards | [HTML](web/en/community_standards/index.html) · [PNG](web/en/community_standards/screen.png) | [HTML](web/hi/community_standards/index.html) · [PNG](web/hi/community_standards/screen.png) |
| W10 | Tenancy guidelines | [HTML](web/en/tenancy_guidelines/index.html) · [PNG](web/en/tenancy_guidelines/screen.png) | [HTML](web/hi/tenancy_guidelines/index.html) · [PNG](web/hi/tenancy_guidelines/screen.png) |

## Still needs a person (not design work)

- A fluent Hindi speaker must review all Hindi copy (task T0.12).
- Photo licences: the web Home hero and the generated portraits/room photos are placeholders (T0.13).
- Founder decision: show the 1091 helpline next to 112 on SOS or not (T0.14).
- Legal review of Terms, Privacy, Community Standards and Tenancy Guidelines, plus the `[Grievance Officer name]`, `[grievance email]`, `[DD Month YYYY]` and `[YYYY]` placeholders (T0.15).
