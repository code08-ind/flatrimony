import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { MessageKey } from '@flatrimony/i18n';
import {
  CommutePreviewResponse,
  PlaceAutocompleteResponse,
  PlaceDetails,
  type ReferenceData,
  type PlaceSuggestion,
} from '@flatrimony/shared';
import { api } from '../../api';
import {
  anchorLabel,
  MINUTE_CHOICES,
  previewKey,
  sessionToken,
  TRAVEL_MODES,
  type AnchorDraft,
} from '../../anchor/logic';
import { textStyle, theme } from '../../theme';
import { useT } from '../../useT';
import {
  Briefcase,
  Car,
  GraduationCap,
  MagnifyingGlass,
  MapPin,
  Motorcycle,
  PersonSimpleWalk,
  Train,
  X,
} from '../icons';
import { Notice } from '../Notice';
import { ChipGroup, ChoiceChip, onboardingStyles } from '../onboarding';
import { ZonePreview } from './ZonePreview';

const MODE_ICON = {
  metro_transit: Train,
  car: Car,
  two_wheeler: Motorcycle,
  walk: PersonSimpleWalk,
} as const;

/**
 * Office or college, how the user travels and the longest commute (FR-BIO-03; design M07), with
 * a live preview of the commute zone. Search goes through the API's places proxy (T2.8); the zone
 * through POST /v1/commute/preview (T2.9). Controlled: the parent saves (PUT /me/anchor).
 */
export function AnchorPicker({
  value,
  onChange,
  areas,
}: {
  value: AnchorDraft;
  onChange: (next: AnchorDraft) => void;
  areas: ReferenceData['areas'];
}) {
  const { t, locale } = useT();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  // One session token per search (Google bills a session: keystrokes + one details call). Lazily
  // created; replaced after every details call and when an unfinished search is abandoned.
  const token = useRef<string | null>(null);
  const currentToken = () => (token.current ??= sessionToken());
  const latestQuery = useRef('');
  // The latest value, for answers that arrive after the user changed something else.
  const latest = useRef(value);
  latest.current = value;
  const choosing = useRef(false);

  // Suggestions, 300 ms after the last keystroke; only the newest answer is shown.
  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setSuggestions(null);
      setSearching(false);
      setNotice(null);
      if (q.length === 0) token.current = null; // search abandoned: a later one is a new session
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api('/places/autocomplete', {
          method: 'POST',
          body: { q, sessionToken: currentToken() },
          locale,
        });
        if (latestQuery.current !== q) return;
        const parsed = PlaceAutocompleteResponse.safeParse(res.body);
        if (res.status === 200 && parsed.success) {
          setSuggestions(parsed.data.suggestions);
          setNotice(null);
        } else {
          setSuggestions(null);
          setNotice(
            res.status === 429 ? 'auth.errors.tooManyRequests' : 'anchor.searchUnavailable',
          );
        }
      } catch {
        if (latestQuery.current === q) {
          setSuggestions(null);
          setNotice('anchor.searchUnavailable');
        }
      } finally {
        if (latestQuery.current === q) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, locale]);

  const choose = async (s: PlaceSuggestion) => {
    if (choosing.current) return; // one details call at a time
    choosing.current = true;
    setSearching(true);
    try {
      // A POST: the chosen place (the user's office) must not end up in a logged URL.
      const res = await api('/places/details', {
        method: 'POST',
        body: { placeId: s.placeId, sessionToken: currentToken() },
        locale,
      });
      const parsed = PlaceDetails.safeParse(res.body);
      if (res.status === 200 && parsed.success) {
        onChange({
          ...latest.current,
          label: anchorLabel(parsed.data.label ?? s.label, s.secondary),
          location: parsed.data.location,
          placeId: parsed.data.placeId,
        });
        setQuery('');
        setSuggestions(null);
        setNotice(null);
      } else {
        const code = (res.body as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code;
        setNotice(
          code === 'outside_ncr'
            ? 'anchor.outsideNcr'
            : res.status === 429
              ? 'auth.errors.tooManyRequests'
              : 'anchor.searchUnavailable',
        );
      }
    } catch {
      setNotice('anchor.searchUnavailable');
    } finally {
      token.current = null; // the details call ends the search session, whatever its answer
      choosing.current = false;
      setSearching(false);
    }
  };

  // The zone for the chosen place, mode and minutes (300 ms after the last change). Each answer
  // is kept with the request it answers, so an old zone is never shown under a new choice.
  const { location, travelMode, maxCommuteMin } = value;
  const key = previewKey(location, travelMode, maxCommuteMin);
  const [preview, setPreview] = useState<{
    key: string;
    zone: CommutePreviewResponse | null;
  } | null>(null);
  useEffect(() => {
    if (!key || !location) return;
    let live = true;
    const timer = setTimeout(async () => {
      let zone: CommutePreviewResponse | null = null;
      try {
        const res = await api('/commute/preview', {
          method: 'POST',
          body: { location, travelMode, maxCommuteMin },
          locale,
        });
        const parsed = CommutePreviewResponse.safeParse(res.body);
        if (res.status === 200 && parsed.success) zone = parsed.data;
      } catch {
        zone = null;
      }
      if (live) setPreview({ key, zone });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` covers location, mode, minutes
  const answered = preview?.key === key ? preview : null;
  const zone = answered?.zone ?? null;
  const zoneFailed = !!answered && !answered.zone;
  const zoneLoading = !!key && !answered;

  const placeholder =
    value.kind === 'office'
      ? t('anchor.searchPlaceholderOffice')
      : t('anchor.searchPlaceholderCollege');

  return (
    <View style={{ gap: theme.space['4'] }}>
      <View
        style={styles.kinds}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('anchor.kindLabel')}
      >
        {(['office', 'college'] as const).map((kind) => {
          const Icon = kind === 'office' ? Briefcase : GraduationCap;
          return (
            <ChoiceChip
              key={kind}
              label={t(`anchor.${kind}`)}
              icon={<Icon size={18} color={theme.color.text.primary} />}
              selected={value.kind === kind}
              onPress={() => onChange({ ...value, kind })}
              locale={locale}
            />
          );
        })}
      </View>

      <View style={onboardingStyles.card}>
        {value.label && value.location ? (
          <View style={styles.chosen}>
            <MapPin size={22} color={theme.color.brand.primary} weight="fill" />
            <Text style={[textStyle('bodyLg', locale), styles.chosenText]} numberOfLines={2}>
              {value.label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('anchor.clear')}
              onPress={() =>
                onChange({
                  kind: value.kind,
                  travelMode: value.travelMode,
                  maxCommuteMin: value.maxCommuteMin,
                })
              }
              hitSlop={8}
              style={styles.clear}
            >
              <X size={18} color={theme.color.text.primary} />
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.search}>
              <MagnifyingGlass size={20} color={theme.color.text.secondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={placeholder}
                placeholderTextColor={theme.color.text.disabled}
                accessibilityLabel={t('anchor.searchLabel')}
                testID="anchor-search"
                autoCorrect={false}
                maxLength={100}
                style={[textStyle('bodyLg', locale), styles.input]}
              />
              {searching ? (
                <ActivityIndicator
                  color={theme.color.brand.primary}
                  accessibilityLabel={t('anchor.searching')}
                />
              ) : null}
            </View>
            {suggestions?.length === 0 && !searching ? (
              <Text
                style={[textStyle('body', locale), styles.muted]}
                accessibilityLiveRegion="polite"
              >
                {t('anchor.noResults')}
              </Text>
            ) : null}
            {suggestions?.map((s) => (
              <Pressable
                key={s.placeId}
                accessibilityRole="button"
                accessibilityLabel={s.secondary ? `${s.label}, ${s.secondary}` : s.label}
                onPress={() => void choose(s)}
                style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              >
                <MapPin size={18} color={theme.color.text.secondary} />
                <View style={{ flex: 1 }}>
                  <Text style={[textStyle('label', locale), { color: theme.color.text.primary }]}>
                    {s.label}
                  </Text>
                  {s.secondary ? (
                    <Text style={[textStyle('caption', locale), styles.muted]}>{s.secondary}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </>
        )}
        {notice ? <Notice tone="error" locale={locale} message={t(notice)} /> : null}
      </View>

      {value.location && value.label ? (
        zoneFailed ? (
          <Notice tone="info" locale={locale} message={t('anchor.zone.failed')} />
        ) : (
          <ZonePreview
            zone={zone?.zone ?? null}
            anchor={value.location}
            anchorLabel={value.label}
            areas={areas}
            approx={zone?.approx ?? false}
            loading={zoneLoading}
          />
        )
      ) : null}

      <ChipGroup label={t('anchor.travelMode')} locale={locale}>
        {TRAVEL_MODES.map((mode) => {
          const Icon = MODE_ICON[mode];
          return (
            <ChoiceChip
              key={mode}
              label={t(`anchor.modes.${mode}`)}
              icon={<Icon size={18} color={theme.color.text.primary} />}
              selected={travelMode === mode}
              onPress={() => onChange({ ...value, travelMode: mode })}
              locale={locale}
            />
          );
        })}
      </ChipGroup>

      <ChipGroup label={t('anchor.maxCommute')} locale={locale}>
        {MINUTE_CHOICES.map((n) => (
          <ChoiceChip
            key={n}
            label={t('anchor.minutes', { n })}
            selected={maxCommuteMin === n}
            onPress={() => onChange({ ...value, maxCommuteMin: n })}
            locale={locale}
          />
        ))}
      </ChipGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  kinds: { flexDirection: 'row', gap: theme.space['2'] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['2'],
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['3'],
    backgroundColor: theme.color.bg.app,
  },
  input: { flex: 1, color: theme.color.text.primary, minHeight: 48 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    minHeight: 52,
    paddingVertical: theme.space['2'],
    paddingHorizontal: theme.space['1'],
    borderRadius: theme.radius.md,
  },
  pressed: { backgroundColor: theme.color.brand.primarySubtle },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], minHeight: 52 },
  chosenText: { flex: 1, color: theme.color.text.primary },
  clear: {
    width: theme.size.touchMin,
    height: theme.size.touchMin,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.bg.app,
  },
  muted: { color: theme.color.text.secondary },
});
