import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { sessionToken } from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import {
  PlaceAutocompleteResponse,
  PlaceDetails,
  type LatLng,
  type PlaceSuggestion,
} from '@flatrimony/shared';
import { api } from '../api';
import { textStyle, theme } from '../theme';
import { useT } from '../useT';
import { LockSimple, MagnifyingGlass, MapPin, X } from '../ui/icons';
import { Notice } from '../ui/Notice';

/**
 * The listing's pin (M28 "Pin location"): search the society or a landmark through the API's
 * places proxy (T2.8; a POST, so the place never lands in a logged URL) and take its point. The
 * exact pin stays private; seekers see the ~500 m area (FR-LST-06).
 */
export function LocationSearch({
  value,
  label,
  onChange,
}: {
  value: LatLng | null;
  label: string | null;
  onChange: (location: LatLng | null, label: string | null) => void;
}) {
  const { t, locale } = useT();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const token = useRef<string | null>(null);
  const currentToken = () => (token.current ??= sessionToken());
  const latestQuery = useRef('');
  const choosing = useRef(false);

  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setSuggestions(null);
      setSearching(false);
      setNotice(null);
      if (q.length === 0) token.current = null;
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
    if (choosing.current) return;
    choosing.current = true;
    setSearching(true);
    try {
      const res = await api('/places/details', {
        method: 'POST',
        body: { placeId: s.placeId, sessionToken: currentToken() },
        locale,
      });
      const parsed = PlaceDetails.safeParse(res.body);
      if (res.status === 200 && parsed.success) {
        const name = parsed.data.label ?? s.label;
        onChange(parsed.data.location, s.secondary ? `${name}, ${s.secondary}` : name);
        setQuery('');
        setSuggestions(null);
        setNotice(null);
      } else {
        const code = (res.body as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code;
        setNotice(
          code === 'outside_ncr'
            ? 'listing.editor.basics.errors.outsideNcr'
            : res.status === 429
              ? 'auth.errors.tooManyRequests'
              : 'anchor.searchUnavailable',
        );
      }
    } catch {
      setNotice('anchor.searchUnavailable');
    } finally {
      token.current = null;
      choosing.current = false;
      setSearching(false);
    }
  };

  return (
    <View style={{ gap: theme.space['3'] }}>
      {value ? (
        <View style={styles.chosen}>
          <MapPin size={22} color={theme.color.brand.primary} weight="fill" />
          <Text style={[textStyle('bodyLg', locale), styles.chosenText]} numberOfLines={2}>
            {label ?? t('listing.editor.basics.location')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('listing.editor.basics.changeLocation')}
            onPress={() => onChange(null, null)}
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
              placeholder={t('listing.editor.basics.searchPlaceholder')}
              placeholderTextColor={theme.color.text.disabled}
              accessibilityLabel={t('listing.editor.basics.searchLabel')}
              testID="listing-location-search"
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
                <Text style={[textStyle('label', locale), styles.primary]}>{s.label}</Text>
                {s.secondary ? (
                  <Text style={[textStyle('caption', locale), styles.muted]}>{s.secondary}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </>
      )}
      {notice ? <Notice tone="error" locale={locale} message={t(notice)} /> : null}
      <View style={styles.privacy}>
        <LockSimple size={18} color={theme.color.text.secondary} />
        <Text style={[textStyle('caption', locale), styles.muted, { flex: 1 }]}>
          {t('listing.editor.basics.locationPrivate')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  primary: { color: theme.color.text.primary },
  muted: { color: theme.color.text.secondary },
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
  privacy: {
    flexDirection: 'row',
    gap: theme.space['2'],
    alignItems: 'flex-start',
    padding: theme.space['3'],
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.bg.app,
  },
});
