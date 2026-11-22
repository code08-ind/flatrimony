import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import type { GeoMultiPolygon, LatLng, ReferenceData } from '@flatrimony/shared';
import {
  areasInReach,
  fitProjection,
  placeLabels,
  zonePath,
  type PlacedLabel,
} from '../../anchor/logic';
import { textStyle, theme } from '../../theme';
import { useT } from '../../useT';

const HEIGHT = 220;

/**
 * The commute zone drawn to scale around the office or college, with the seeded NCR areas for
 * orientation (design M07). No basemap yet: the tile host is a founder decision (docs/07 T2.8).
 * Zones come from OpenStreetMap data, so the credit is always shown.
 */
export function ZonePreview({
  zone,
  anchor,
  anchorLabel,
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
  const { t, locale } = useT();
  const [width, setWidth] = useState(0);
  const reach = zone ? areasInReach(zone, areas, anchor) : [];
  const projection = zone && width > 0 ? fitProjection(zone, anchor, width, HEIGHT) : null;
  const pin = projection?.xy(anchor);
  const summary = zone
    ? `${t('anchor.zone.label', { place: anchorLabel })}. ${
        reach.length
          ? t('anchor.zone.reaches', { areas: reach.map((a) => a.name).join(', ') })
          : t('anchor.zone.noAreas')
      }${approx ? `. ${t('anchor.zone.approx')}` : ''}`
    : t('anchor.zone.loading');

  return (
    <View style={styles.card}>
      <View
        style={styles.map}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
      >
        {projection && zone && pin ? (
          <Svg width={width} height={HEIGHT}>
            <Path
              d={zonePath(zone, projection)}
              fill={theme.color.brand.primarySubtle}
              fillRule="evenodd"
              stroke={theme.color.brand.primary}
              strokeWidth={2}
              strokeDasharray={approx ? '6 4' : undefined}
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
            ).map((l) => (
              <SvgAreaLabel
                key={l.id}
                label={l}
                strong={reach.some((r) => r.id === l.id)}
                fontFamily={
                  locale === 'hi' ? 'NotoSansDevanagari_500Medium' : 'PlusJakartaSans_500Medium'
                }
              />
            ))}
            <Circle cx={pin.x} cy={pin.y} r={9} fill={theme.color.brand.primary} />
            <Circle cx={pin.x} cy={pin.y} r={4} fill={theme.color.white} />
          </Svg>
        ) : (
          <View style={styles.placeholder}>
            <ActivityIndicator color={theme.color.brand.primary} />
          </View>
        )}
        {loading && projection ? (
          <View style={styles.busy}>
            <ActivityIndicator color={theme.color.brand.primary} />
          </View>
        ) : null}
        <Text style={[textStyle('micro', locale), styles.credit]}>
          © OpenStreetMap contributors
        </Text>
      </View>
      {zone ? (
        <View style={styles.below}>
          <Text style={[textStyle('label', locale), { color: theme.color.text.primary }]}>
            {reach.length
              ? t('anchor.zone.reaches', { areas: reach.map((a) => a.name).join(', ') })
              : t('anchor.zone.noAreas')}
          </Text>
          {approx ? (
            <Text style={[textStyle('caption', locale), { color: theme.color.text.secondary }]}>
              {t('anchor.zone.approx')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SvgAreaLabel({
  label,
  strong,
  fontFamily,
}: {
  label: PlacedLabel;
  strong: boolean;
  fontFamily: string;
}) {
  const color = strong ? theme.color.text.primary : theme.color.text.secondary;
  const left = label.side === 'left';
  return (
    <>
      <Circle cx={label.x} cy={label.y} r={3} fill={color} />
      <SvgText
        x={left ? label.x - 6 : label.x + 6}
        y={label.y + 4}
        fontSize={11}
        fontFamily={fontFamily}
        fontWeight={strong ? '700' : '400'}
        fill={color}
        textAnchor={left ? 'end' : 'start'}
      >
        {label.name}
      </SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    backgroundColor: theme.color.bg.surface,
    ...theme.elevation['1'],
  },
  map: { height: HEIGHT, backgroundColor: theme.color.bg.app },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  busy: { position: 'absolute', top: 8, right: 8 },
  credit: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    color: theme.color.text.secondary,
    backgroundColor: theme.color.bg.surface,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  below: { padding: theme.layout.cardPadding, gap: theme.space['1'] },
});
