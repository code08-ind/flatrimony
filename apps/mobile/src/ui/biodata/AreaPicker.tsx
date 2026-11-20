import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LIMITS, ReferenceData } from '@flatrimony/shared';
import { api } from '../../api';
import { textStyle, theme } from '../../theme';
import { useT } from '../../useT';
import { SecondaryButton } from '../buttons';
import { MapPin } from '../icons';
import { Notice } from '../Notice';
import { ChoiceChip, onboardingStyles } from '../onboarding';

type Area = ReferenceData['areas'][number];
const CITY_ORDER = [
  'delhi',
  'gurugram',
  'noida',
  'greater_noida',
  'ghaziabad',
  'faridabad',
] as const;

/** Up to 3 preferred areas, grouped by city (FR-BIO-02; design M07 "pick areas"). Controlled. */
export function AreaPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (areaIds: number[]) => void;
}) {
  const { t, locale } = useT();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api('/reference', { locale });
      const parsed = ReferenceData.safeParse(res.body);
      if (!parsed.success) throw new Error('bad reference data');
      setAreas(parsed.data.areas);
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      setLimitHit(false);
      return onChange(selected.filter((a) => a !== id));
    }
    if (selected.length >= LIMITS.preferredAreasMax) return setLimitHit(true);
    setLimitHit(false);
    onChange([...selected, id]);
  };

  return (
    <>
      {!areas && !failed && (
        <View style={styles.loading} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.color.brand.primary} />
          <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
            {t('onboarding.commute.loading')}
          </Text>
        </View>
      )}
      {failed && (
        <View style={{ gap: theme.space['3'] }}>
          <Notice tone="error" locale={locale} message={t('onboarding.commute.loadFailed')} />
          <SecondaryButton
            locale={locale}
            label={t('onboarding.commute.retry')}
            trailingArrow={false}
            onPress={() => void load()}
          />
        </View>
      )}
      {areas &&
        CITY_ORDER.map((city) => {
          const inCity = areas.filter((a) => a.city === city);
          if (inCity.length === 0) return null;
          return (
            <View key={city} style={styles.city}>
              <Text style={[textStyle('label', locale), styles.cityName]}>
                {t(`onboarding.commute.cities.${city}`)}
              </Text>
              <View style={onboardingStyles.chipWrap}>
                {inCity.map((a) => (
                  <ChoiceChip
                    key={a.id}
                    label={a.name}
                    icon={<MapPin size={16} color={theme.color.brand.primary} />}
                    multiple
                    selected={selected.includes(a.id)}
                    onPress={() => toggle(a.id)}
                    locale={locale}
                  />
                ))}
              </View>
            </View>
          );
        })}
      {/* Below the list, so the chips do not move when it appears. */}
      {limitHit && (
        <Notice tone="info" locale={locale} message={t('onboarding.commute.maxReached')} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', gap: theme.space['3'], alignItems: 'center' },
  city: { gap: theme.space['2'] },
  cityName: { color: theme.color.text.secondary, textTransform: 'uppercase' },
});
