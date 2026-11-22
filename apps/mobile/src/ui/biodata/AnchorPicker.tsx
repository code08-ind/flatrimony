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
import { MINUTE_CHOICES, sessionToken, TRAVEL_MODES, type AnchorDraft } from '../../anchor/logic';
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
  const token = useRef(sessionToken());
  const latestQuery = useRef('');

  // Suggestions, 300 ms after the last keystroke; only the newest answer is shown.
  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setSuggestions(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api('/places/autocomplete', {
          method: 'POST',
          body: { q, sessionToken: token.current },
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
        if (latestQuery.current === q) setNotice('anchor.searchUnavailable');
      } finally {
        if (latestQuery.current === q) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, locale]);

  const choose = async (s: PlaceSuggestion) => {
    setSearching(true);
    try {
      const res = await api(
        `/places/${encodeURIComponent(s.placeId)}?sessionToken=${token.current}`,
        { locale },
      );
      const parsed = PlaceDetails.safeParse(res.body);
      if (res.status === 200 && parsed.success) {
        onChange({
          ...value,
          label: parsed.data.label,
          location: parsed.data.location,
          placeId: parsed.data.placeId,
        });
        setQuery('');
        setSuggestions(null);
        setNotice(null);
        token.current = sessionToken(); // the search session ends with the details call
      } else {
        const code = (res.body as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code;
        setNotice(code === 'outside_ncr' ? 'anchor.outsideNcr' : 'anchor.searchUnavailable');
      }
    } catch {
      setNotice('anchor.searchUnavailable');
    } finally {
      setSearching(false);
    }
  };

  // The zone for the chosen place, mode and minutes (300 ms after the last change).
  const [zone, setZone] = useState<CommutePreviewResponse | null>(null);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [zoneFailed, setZoneFailed] = useState(false);
  const { location, travelMode, maxCommuteMin } = value;
  useEffect(() => {
    if (!location) {
      setZone(null);
      return;
    }
    let live = true;
    setZoneLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api('/commute/preview', {
          method: 'POST',
          body: { location, travelMode, maxCommuteMin },
          locale,
        });
        const parsed = CommutePreviewResponse.safeParse(res.body);
        if (!live) return;
        if (res.status === 200 && parsed.success) {
          setZone(parsed.data);
          setZoneFailed(false);
        } else setZoneFailed(true);
      } catch {
        if (live) setZoneFailed(true);
      } finally {
        if (live) setZoneLoading(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [location?.lat, location?.lng, travelMode, maxCommuteMin, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- location by value

  const placeholder =
    value.kind === 'office'
      ? t('anchor.searchPlaceholderOffice')
      : t('anchor.searchPlaceholderCollege');

  return (
    <View style={{ gap: theme.space['4'] }}>
      <View style={styles.kinds} accessibilityRole="radiogroup">
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
              {searching ? <ActivityIndicator color={theme.color.brand.primary} /> : null}
            </View>
            {suggestions?.length === 0 && !searching ? (
              <Text style={[textStyle('body', locale), styles.muted]}>{t('anchor.noResults')}</Text>
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
        <>
          {zone ? (
            <ZonePreview
              zone={zone.zone}
              anchor={value.location}
              anchorLabel={value.label}
              areas={areas}
              approx={zone.approx}
              loading={zoneLoading}
            />
          ) : (
            <ZonePreview
              zone={null}
              anchor={value.location}
              anchorLabel={value.label}
              areas={areas}
              approx={false}
              loading
            />
          )}
          {zoneFailed ? (
            <Notice tone="info" locale={locale} message={t('anchor.zone.failed')} />
          ) : null}
        </>
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
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.bg.app,
  },
  muted: { color: theme.color.text.secondary },
});
