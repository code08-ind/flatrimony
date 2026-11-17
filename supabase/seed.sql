-- Local development seed ONLY (applied by `supabase db reset`; never pushed to staging/prod).
-- Everything here is placeholder content for building screens:
--   * Area centroids are approximate and boundaries are missing — production areas must come
--     from OpenStreetMap (docs/04 §14) via a dedicated migration.
--   * Hindi labels marked DRAFT need the fluent-Hindi review (founder task T0.12).
--   * Scenario option values are illustrative; the founder signs off the real scenario set (FR-BIO-06).
--   * No products are seeded: prices are set by the founder (docs/02 OQ-05).
--   * Legal policy versions are 'dev-draft': the real Terms/Privacy text and versions come with
--     the lawyer-reviewed documents (founder task T0.15). Bootstrap refuses without this row.
-- Never put real people's data here (docs/03 §8.3).

insert into ref.areas (slug, name_en, name_hi, city, centroid) values
  ('gurugram-cyber-city', 'Cyber City',    'साइबर सिटी',     'gurugram', st_point(77.0890, 28.4950)::geography),
  ('noida-sector-62',     'Sector 62',     'सेक्टर 62',       'noida',    st_point(77.3650, 28.6270)::geography),
  ('noida-sector-18',     'Sector 18',     'सेक्टर 18',       'noida',    st_point(77.3260, 28.5708)::geography),
  ('delhi-hauz-khas',     'Hauz Khas',     'हौज़ ख़ास',        'delhi',    st_point(77.2001, 28.5494)::geography),
  ('delhi-saket',         'Saket',         'साकेत',           'delhi',    st_point(77.2066, 28.5245)::geography),
  ('delhi-laxmi-nagar',   'Laxmi Nagar',   'लक्ष्मी नगर',      'delhi',    st_point(77.2777, 28.6304)::geography),
  ('ghaziabad-indirapuram','Indirapuram',  'इंदिरापुरम',       'ghaziabad',st_point(77.3712, 28.6415)::geography);

-- Habit tags from docs/04 §14. Hindi labels are DRAFT.
insert into ref.habit_tags (id, label_en, label_hi, attribute, sort_order) values
  ('tidy',                'Tidy',                'साफ़-सुथरे (DRAFT)',            'cleaning', 1),
  ('quiet_after_11',      'Quiet after 11 PM',   'रात 11 के बाद शांत (DRAFT)',     'bedtime',  2),
  ('pays_on_time',        'Pays on time',        'समय पर भुगतान (DRAFT)',          null,       3),
  ('respects_guest_rule', 'Respects guests rule','मेहमानों के नियम का सम्मान (DRAFT)', 'guests', 4),
  ('shares_chores',       'Shares chores',       'काम बाँटते हैं (DRAFT)',           null,       5),
  ('easy_to_talk_to',     'Easy to talk to',     'बात करना आसान (DRAFT)',           null,       6),
  ('respects_food_rule',  'Respects food rule',  'खाने के नियम का सम्मान (DRAFT)',    'food',     7),
  ('early_riser',         'Early riser',         'जल्दी उठने वाले (DRAFT)',          'wake_time',8),
  ('night_owl',           'Night owl',           'देर रात तक जागने वाले (DRAFT)',     'bedtime',  9);

-- The one scenario designed in Stitch (docs/designs android scenario_question, EN + HI).
-- The other four required by FR-BIO-06 still need founder-approved content.
insert into ref.scenario_questions (id, attribute, prompt_en, prompt_hi, options, sort_order) values
  ('sink_dishes_10pm', 'cleaning',
   'There are 5 dishes in the sink at 10 PM. What happens?',
   'रात 10 बजे सिंक में 5 गंदे बर्तन पड़े हैं। आप क्या करेंगे?',
   '[
      {"id":"wash_now",       "label_en":"I wash them right now",        "label_hi":"मैं उन्हें तुरंत धो देता हूँ",     "value":1.0},
      {"id":"first_tomorrow", "label_en":"First thing tomorrow",         "label_hi":"कल सुबह सबसे पहले",            "value":0.67},
      {"id":"when_needed",    "label_en":"When I need a plate",          "label_hi":"जब मुझे प्लेट की ज़रूरत हो",      "value":0.33},
      {"id":"someone_else",   "label_en":"Someone else usually does it", "label_hi":"आमतौर पर कोई और धो देता है",      "value":0.0}
    ]'::jsonb,
   1);

-- Current policy version per consent purpose (docs/05 §8.15). Clients must accept exactly these.
insert into ref.app_config (key, value, is_public, description) values
  ('legal.versions',
   '{"terms":"dev-draft","privacy":"dev-draft","analytics":"dev-draft","marketing":"dev-draft","identity_verification":"dev-draft","location_safety":"dev-draft"}'::jsonb,
   true,
   'Current policy version per consent purpose (FR-AUTH-09). DEV ONLY: set by the founder with T0.15.');
