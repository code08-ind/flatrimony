'use client';

import { useEffect, useRef, useState } from 'react';
import {
  anchorLabel,
  areasInReach,
  fitProjection,
  MINUTE_CHOICES,
  placeLabels,
  previewKey,
  sessionToken,
  TRAVEL_MODES,
  zonePath,
  type AnchorDraft,
} from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import {
  CommutePreviewResponse,
  PlaceAutocompleteResponse,
  PlaceDetails,
  type GeoMultiPolygon,
  type LatLng,
  type PlaceSuggestion,
  type ReferenceData,
} from '@flatrimony/shared';
import { api } from '../lib/client/api';
import { useT } from '../lib/client/app-context';
import { Notice, RadioChips } from './ui';

/**
 * Office or college, how the user travels and the longest commute (FR-BIO-03; design M07), with
 * a live preview of the commute zone. Search goes through the API's places proxy (T2.8), the zone
 * through POST /v1/commute/preview (T2.9). Controlled: the page saves (PUT /me/anchor).
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
  // One session token per search (keystrokes + one details call); replaced after every details
  // call and when a search is abandoned.
  const token = useRef<string | null>(null);
  const currentToken = () => (token.current ??= sessionToken());
  const latestQuery = useRef('');
  const latest = useRef(value);
  latest.current = value;
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
      token.current = null;
      choosing.current = false;
      setSearching(false);
    }
  };

  // The zone for the chosen place, mode and minutes; each answer is kept with its request.
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
    // `key` covers location, mode and minutes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locale]);
  const answered = preview?.key === key ? preview : null;
  const zoneFailed = !!answered && !answered.zone;

  return (
    <div className="stack">
      <RadioChips
        legend={t('anchor.kindLabel')}
        options={(['office', 'college'] as const).map((k) => ({
          value: k,
          label: t(`anchor.${k}`),
        }))}
        value={value.kind}
        onChange={(kind) => onChange({ ...value, kind })}
      />

      <div className="card">
        {value.label && value.location ? (
          <div className="chosen">
            <span className="chosen-label">{value.label}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('anchor.clear')}
              onClick={() =>
                onChange({
                  kind: value.kind,
                  travelMode: value.travelMode,
                  maxCommuteMin: value.maxCommuteMin,
                })
              }
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : (
          <>
            <label className="visually-hidden" htmlFor="anchor-search">
              {t('anchor.searchLabel')}
            </label>
            <div className="search">
              <input
                id="anchor-search"
                type="search"
                aria-controls={suggestions?.length ? 'anchor-suggestions' : undefined}
                autoComplete="off"
                maxLength={100}
                value={query}
                placeholder={
                  value.kind === 'office'
                    ? t('anchor.searchPlaceholderOffice')
                    : t('anchor.searchPlaceholderCollege')
                }
                onChange={(e) => setQuery(e.target.value)}
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
              <ul
                id="anchor-suggestions"
                className="suggestions"
                aria-label={t('anchor.searchLabel')}
              >
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
      </div>

      {value.location && value.label ? (
        zoneFailed ? (
          <Notice tone="info">{t('anchor.zone.failed')}</Notice>
        ) : (
          <ZoneMap
            zone={answered?.zone?.zone ?? null}
            anchor={value.location}
            anchorLabel={value.label}
            areas={areas}
            approx={answered?.zone?.approx ?? false}
            loading={!!key && !answered}
          />
        )
      ) : null}

      <RadioChips
        legend={t('anchor.travelMode')}
        options={TRAVEL_MODES.map((m) => ({ value: m, label: t(`anchor.modes.${m}`) }))}
        value={travelMode}
        onChange={(mode) => onChange({ ...value, travelMode: mode })}
      />
      <RadioChips
        legend={t('anchor.maxCommute')}
        options={MINUTE_CHOICES.map((n) => ({ value: n, label: t('anchor.minutes', { n }) }))}
        value={maxCommuteMin}
        onChange={(n) => onChange({ ...value, maxCommuteMin: n })}
      />
    </div>
  );
}

const HEIGHT = 240;

/** The commute zone drawn to scale with the NCR areas for orientation (no basemap yet, T2.8). */
function ZoneMap({
  zone,
  anchor,
  anchorLabel: place,
  areas,
  approx,
  loading,
}: {
  zone: GeoMultiPolygon | null;
  anchor: LatLng;
  anchorLabel: string;
  areas: ReferenceData['areas'];
  approx: boolean;
  loading: boolean;
}) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const reach = zone ? areasInReach(zone, areas, anchor) : [];
  const projection = zone && width > 0 ? fitProjection(zone, anchor, width, HEIGHT) : null;
  const pin = projection?.xy(anchor);
  const reaches = reach.length
    ? t('anchor.zone.reaches', { areas: reach.map((a) => a.name).join(', ') })
    : t('anchor.zone.noAreas');
  const summary = zone
    ? `${t('anchor.zone.label', { place })}. ${reaches}${approx ? `. ${t('anchor.zone.approx')}` : ''}`
    : t('anchor.zone.loading');

  return (
    <figure className="zone card">
      <div ref={box} className="zone-map" aria-busy={loading || undefined}>
        {projection && zone && pin ? (
          <svg width={width} height={HEIGHT} role="img" aria-label={summary}>
            <path
              d={zonePath(zone, projection)}
              className={approx ? 'zone-shape zone-approx' : 'zone-shape'}
              fillRule="evenodd"
            />
            {placeLabels(
              areas
                .filter((a) => projection.visible(a.centroid))
                .map((a) => ({
                  id: a.id,
                  name: a.name,
                  ...projection.xy(a.centroid),
                  inReach: reach.some((r) => r.id === a.id),
                })),
              pin,
              width,
              [{ x1: width - 190, y1: HEIGHT - 22, x2: width, y2: HEIGHT }],
            ).map((l) => {
              const strong = reach.some((r) => r.id === l.id);
              const left = l.side === 'left';
              return (
                <g key={l.id} className={strong ? 'area area-strong' : 'area'}>
                  <circle cx={l.x} cy={l.y} r={3} />
                  <text
                    x={left ? l.x - 6 : l.x + 6}
                    y={l.y + 4}
                    textAnchor={left ? 'end' : 'start'}
                  >
                    {l.name}
                  </text>
                </g>
              );
            })}
            <circle cx={pin.x} cy={pin.y} r={9} className="pin" />
            <circle cx={pin.x} cy={pin.y} r={4} className="pin-dot" />
          </svg>
        ) : (
          <div className="zone-placeholder" role="status" aria-label={t('anchor.zone.loading')}>
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
        <span className="credit">© OpenStreetMap contributors</span>
      </div>
      {zone ? (
        <figcaption>
          <p className="reaches">{reaches}</p>
          <p className="muted">{approx ? t('anchor.zone.approx') : t('anchor.zone.basis')}</p>
        </figcaption>
      ) : null}
    </figure>
  );
}
