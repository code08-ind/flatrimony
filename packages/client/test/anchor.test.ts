import { describe, expect, it } from 'vitest';
import type { GeoMultiPolygon, Me } from '@flatrimony/shared';
import {
  anchorComplete,
  anchorLabel,
  previewKey,
  areasInReach,
  fitProjection,
  inZone,
  MINUTE_CHOICES,
  placeLabels,
  sessionToken,
  TRAVEL_MODES,
  zonePath,
  resumeStep,
} from '../src/index.js';

/** A square zone around Cyber City (0.1° on each side), with a hole in the north-east corner. */
const zone: GeoMultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [77.0, 28.4],
        [77.2, 28.4],
        [77.2, 28.6],
        [77.0, 28.6],
        [77.0, 28.4],
      ],
      [
        [77.15, 28.55],
        [77.19, 28.55],
        [77.19, 28.59],
        [77.15, 28.59],
        [77.15, 28.55],
      ],
    ],
  ],
};
const cyberCity = { lat: 28.495, lng: 77.089 };
const area = (id: number, name: string, lat: number, lng: number) => ({
  id,
  slug: name.toLowerCase().replace(/ /g, '-'),
  name,
  city: 'delhi' as const,
  centroid: { lat, lng },
});

describe('choices (FR-BIO-03)', () => {
  it('four travel modes and minutes inside 15–90', () => {
    expect(TRAVEL_MODES).toEqual(['metro_transit', 'car', 'two_wheeler', 'walk']);
    expect(Math.min(...MINUTE_CHOICES)).toBe(15);
    expect(Math.max(...MINUTE_CHOICES)).toBe(90);
  });
  it('an anchor needs a place before it can be saved', () => {
    const d = { kind: 'office' as const, travelMode: 'car' as const, maxCommuteMin: 45 };
    expect(anchorComplete(d)).toBe(false);
    expect(anchorComplete({ ...d, label: 'Cyber City', location: cyberCity })).toBe(true);
  });
});

describe('zone geometry', () => {
  it('inside the zone, outside its holes', () => {
    expect(inZone(zone, cyberCity)).toBe(true);
    expect(inZone(zone, { lat: 28.57, lng: 77.17 })).toBe(false); // in the hole
    expect(inZone(zone, { lat: 28.7, lng: 77.1 })).toBe(false);
  });
  it('areas in reach, nearest first', () => {
    const areas = [
      area(1, 'Far Inside', 28.59, 77.01),
      area(2, 'Near', 28.5, 77.09),
      area(3, 'Outside', 28.8, 77.1),
    ];
    expect(areasInReach(zone, areas, cyberCity).map((a) => a.name)).toEqual(['Near', 'Far Inside']);
  });
  it('fits the zone in the drawing with true proportions and padding', () => {
    const p = fitProjection(zone, cyberCity, 300, 200, 10);
    const sw = p.xy({ lat: 28.4, lng: 77.0 });
    const ne = p.xy({ lat: 28.6, lng: 77.2 });
    // 0.2° of longitude at 28.5°N is ~0.88 of 0.2° of latitude: narrower than tall.
    expect((ne.x - sw.x) / (sw.y - ne.y)).toBeCloseTo(Math.cos((28.5 * Math.PI) / 180), 2);
    expect(Math.min(sw.x, ne.x, sw.y, ne.y)).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(sw.y).toBeLessThanOrEqual(190 + 1e-6);
    expect(p.visible(cyberCity)).toBe(true);
    expect(p.visible({ lat: 30, lng: 80 })).toBe(false);
  });
  it('one SVG path with every ring closed', () => {
    const d = zonePath(zone, fitProjection(zone, cyberCity, 300, 200));
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});

describe('area labels', () => {
  it('never cover the pin or each other; areas in reach first', () => {
    const placed = placeLabels(
      [
        { id: 1, name: 'Under the pin', x: 100, y: 100, inReach: true },
        { id: 2, name: 'Sector 18', x: 100, y: 140, inReach: false },
        { id: 3, name: 'Indirapuram', x: 102, y: 141, inReach: true },
        { id: 4, name: 'Far away', x: 20, y: 20, inReach: false },
      ],
      { x: 104, y: 100 },
      300,
    );
    const names = placed.map((p) => p.name);
    expect(names).not.toContain('Under the pin');
    expect(names).toContain('Indirapuram');
    expect(names).not.toContain('Sector 18'); // collides with Indirapuram, which is in reach
    expect(names).toContain('Far away');
  });
  it('labels near the right edge go to the left of their dot', () => {
    const [l] = placeLabels(
      [{ id: 1, name: 'Edge', x: 295, y: 50, inReach: false }],
      { x: 0, y: 0 },
      300,
    );
    expect(l!.side).toBe('left');
  });
});

describe('place search session', () => {
  it('a version-4 UUID (what the API accepts)', () => {
    const t = sessionToken();
    expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sessionToken()).not.toBe(t);
  });
});

describe('onboarding with an office instead of areas', () => {
  it('a saved anchor completes the commute step', () => {
    const me = {
      preferences: null,
      anchor: {
        kind: 'office',
        label: 'Cyber City',
        location: cyberCity,
        travelMode: 'car',
        maxCommuteMin: 45,
      },
      lifestyle: null,
    } as unknown as Me;
    expect(resumeStep(me, { budgetMinInr: 10000, budgetMaxInr: 20000 })).toBe('move-in');
    expect(
      resumeStep({ ...me, anchor: null } as unknown as Me, {
        budgetMinInr: 10000,
        budgetMaxInr: 20000,
      }),
    ).toBe('commute');
  });
});

describe('anchor label and preview requests', () => {
  it('the name with its locality, within 80 characters, no trailing space or comma', () => {
    expect(anchorLabel('DLF Cyber City', 'Gurugram, Haryana, India')).toBe(
      'DLF Cyber City, Gurugram',
    );
    expect(anchorLabel('Cyber City', null)).toBe('Cyber City');
    expect(anchorLabel('Noida Sector 62', 'Noida')).toBe('Noida Sector 62'); // locality already in it
    const long = anchorLabel(`${'A'.repeat(77)} Tower`, 'Gurugram');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long).not.toMatch(/[\s,]$/);
  });
  it('a preview answers one place, mode and time', () => {
    expect(previewKey(undefined, 'car', 45)).toBeNull();
    expect(previewKey(cyberCity, 'car', 45)).not.toBe(previewKey(cyberCity, 'car', 30));
    expect(previewKey(cyberCity, 'car', 45)).not.toBe(previewKey(cyberCity, 'walk', 45));
  });
  it('labels stay clear of the map credit and inside the drawing', () => {
    const placed = placeLabels(
      [
        { id: 1, name: 'Under the credit', x: 220, y: 210, inReach: true },
        { id: 2, name: 'Off the left edge', x: 5, y: 100, inReach: true },
      ],
      { x: 150, y: 50 },
      300,
      [{ x1: 110, y1: 198, x2: 300, y2: 220 }],
    );
    expect(placed.map((p) => p.name)).toEqual(['Off the left edge']);
    expect(placed[0]!.side).toBe('right');
  });
});
