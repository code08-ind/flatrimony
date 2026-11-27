'use client';

import { useEffect, useRef, useState } from 'react';
import { sessionToken } from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import {
  PlaceAutocompleteResponse,
  PlaceDetails,
  type LatLng,
  type PlaceSuggestion,
} from '@flatrimony/shared';
import { api } from '../../lib/client/api';
import { useT } from '../../lib/client/app-context';
import { Notice } from '../ui';

/**
 * The listing's pin (M28 "Pin location"): search the society or a landmark through the API's
 * places proxy (T2.8; a POST, so the place never lands in a logged URL) and take its point. The
 * exact pin stays private; seekers see the ~500 m area (FR-LST-06). The web twin of the Android
 * app's LocationSearch.
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
    <div className="stack-tight">
      {value ? (
        <div className="chosen">
          <span aria-hidden="true" className="brand">
            ●
          </span>
          <span className="chosen-label">{label ?? t('listing.editor.basics.location')}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('listing.editor.basics.changeLocation')}
            onClick={() => onChange(null, null)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : (
        <>
          <div className="search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('listing.editor.basics.searchPlaceholder')}
              aria-label={t('listing.editor.basics.searchLabel')}
              data-testid="listing-location-search"
              autoComplete="off"
              maxLength={100}
            />
            {searching ? (
              <span className="spinner" role="status" aria-label={t('anchor.searching')} />
            ) : null}
          </div>
          {suggestions?.length === 0 && !searching ? (
            <p className="muted" role="status">
              {t('anchor.noResults')}
            </p>
          ) : null}
          {suggestions?.length ? (
            <ul className="suggestions">
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button type="button" onClick={() => void choose(s)}>
                    <span className="suggestion-title">{s.label}</span>
                    {s.secondary ? <span className="muted">{s.secondary}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {notice ? <Notice tone="error">{t(notice)}</Notice> : null}
      <p className="muted caption">
        <span aria-hidden="true">🔒 </span>
        {t('listing.editor.basics.locationPrivate')}
      </p>
    </div>
  );
}
