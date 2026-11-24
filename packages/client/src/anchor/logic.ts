/**
 * Office/college picker (FR-BIO-03; design M07) as pure functions: the travel modes and minute
 * choices, and drawing the commute zone to scale (until a basemap tile host is chosen, docs/07
 * T2.8): projection, SVG paths and which areas the zone reaches.
 */
import type { GeoMultiPolygon, LatLng, ReferenceData, TravelMode } from '@flatrimony/shared';
import { LIMITS } from '@flatrimony/shared';

export const TRAVEL_MODES: readonly TravelMode[] = ['metro_transit', 'car', 'two_wheeler', 'walk'];
export const MINUTE_CHOICES = [15, 30, 45, 60, 90] as const;
export const DEFAULT_MINUTES = LIMITS.commuteMinutes.default;

export interface AnchorDraft {
  kind: 'office' | 'college';
  label?: string;
  location?: LatLng;
  placeId?: string;
  travelMode: TravelMode;
  maxCommuteMin: number;
}

type Area = ReferenceData['areas'][number];

/** Inside the outer ring and outside its holes (ray casting in lng/lat; fine at city scale). */
export function inZone(zone: GeoMultiPolygon, p: LatLng): boolean {
  const inRing = (ring: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  };
  return zone.coordinates.some(
    (polygon) => inRing(polygon[0]!) && !polygon.slice(1).some((hole) => inRing(hole)),
  );
}

/** The areas (reference data) a zone reaches, nearest to the anchor first. */
export function areasInReach(zone: GeoMultiPolygon, areas: Area[], anchor: LatLng): Area[] {
  const d = (a: Area) =>
    (a.centroid.lat - anchor.lat) ** 2 +
    ((a.centroid.lng - anchor.lng) * Math.cos((anchor.lat * Math.PI) / 180)) ** 2;
  return areas.filter((a) => inZone(zone, a.centroid)).sort((a, b) => d(a) - d(b));
}

export interface Projection {
  /** Pixel position of a point. */
  xy(p: LatLng): { x: number; y: number };
  /** Whether a point falls inside the drawing. */
  visible(p: LatLng): boolean;
}

/**
 * Fits the zone (and the anchor) into a width × height drawing with padding, keeping distances
 * true in both directions (a degree of longitude is shorter than one of latitude in NCR).
 */
export function fitProjection(
  zone: GeoMultiPolygon,
  anchor: LatLng,
  width: number,
  height: number,
  padding = 16,
): Projection {
  let minLng = anchor.lng;
  let maxLng = anchor.lng;
  let minLat = anchor.lat;
  let maxLat = anchor.lat;
  for (const polygon of zone.coordinates)
    for (const [lng, lat] of polygon[0]!) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * kx, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const xy = (p: LatLng) => ({
    x: offX + (p.lng - minLng) * kx * scale,
    y: offY + (maxLat - p.lat) * scale,
  });
  return {
    xy,
    visible: (p) => {
      const { x, y } = xy(p);
      return x >= 0 && x <= width && y >= 0 && y <= height;
    },
  };
}

/** The zone as one SVG path (outer rings and holes; draw with fillRule "evenodd"). */
export function zonePath(zone: GeoMultiPolygon, projection: Projection): string {
  return zone.coordinates
    .flatMap((polygon) =>
      polygon.map(
        (ring) =>
          ring
            .map(([lng, lat], i) => {
              const { x, y } = projection.xy({ lat, lng });
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ') + ' Z',
      ),
    )
    .join(' ');
}

/** A session token for one place search (groups keystrokes and the final details call). */
export function sessionToken(random: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const anchorComplete = (
  d: AnchorDraft,
): d is Required<Omit<AnchorDraft, 'placeId'>> & AnchorDraft => !!d.location && !!d.label;

export interface PlacedLabel {
  id: number;
  name: string;
  /** Dot position. */
  x: number;
  y: number;
  /** Text anchor: to the right of the dot, or to its left near the right edge. */
  side: 'right' | 'left';
}

/**
 * Chooses which area names fit on the drawing: areas in reach first, then the rest; a label is
 * left out when it would cover the pin or another label (estimated text size), so the drawing
 * never turns into overlapping names.
 */
export function placeLabels(
  candidates: { id: number; name: string; x: number; y: number; inReach: boolean }[],
  pin: { x: number; y: number },
  width: number,
  /** Areas labels must keep clear of (e.g. the map credit). */
  reserved: { x1: number; y1: number; x2: number; y2: number }[] = [],
  charWidth = 6.4,
  lineHeight = 14,
): PlacedLabel[] {
  type Box = { x1: number; y1: number; x2: number; y2: number };
  const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  const taken: Box[] = [
    { x1: pin.x - 12, y1: pin.y - 12, x2: pin.x + 12, y2: pin.y + 12 },
    ...reserved,
  ];
  const placed: PlacedLabel[] = [];
  const ordered = [...candidates].sort((a, b) => Number(b.inReach) - Number(a.inReach));
  for (const c of ordered) {
    const w = c.name.length * charWidth + 10; // dot + gap + text
    for (const side of c.x > width - w ? (['left'] as const) : (['right', 'left'] as const)) {
      const box: Box =
        side === 'right'
          ? { x1: c.x - 4, y1: c.y - lineHeight / 2, x2: c.x + w, y2: c.y + lineHeight / 2 }
          : { x1: c.x - w, y1: c.y - lineHeight / 2, x2: c.x + 4, y2: c.y + lineHeight / 2 };
      if (box.x1 < 0 || box.x2 > width || taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      placed.push({ id: c.id, name: c.name, x: c.x, y: c.y, side });
      break;
    }
  }
  return placed;
}

/**
 * The anchor's label: the place's name with its locality ("DLF Cyber City, Gurugram"), so offices
 * with the same name stay distinguishable. Trimmed to the stored limit without a trailing space
 * or comma (the API refuses those).
 */
export function anchorLabel(name: string, secondary: string | null): string {
  const locality = secondary?.split(',')[0]?.trim();
  const full = locality && !name.includes(locality) ? `${name.trim()}, ${locality}` : name.trim();
  return full
    .slice(0, LIMITS.anchorLabelMaxChars)
    .replace(/[\s,]+$/u, '')
    .trim();
}

/** Identifies one commute zone preview request: a zone is shown only for the request it answers. */
export const previewKey = (
  location: LatLng | undefined,
  travelMode: TravelMode,
  maxCommuteMin: number,
) => (location ? `${location.lat},${location.lng},${travelMode},${maxCommuteMin}` : null);
