import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LIMITS, ReferenceData } from '@flatrimony/shared';
import { api } from '../../src/api';
import { useMe } from '../../src/me';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import { stepNumber } from '../../src/onboarding/logic';
import { useGoOnce } from '../../src/onboarding/nav';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton, SecondaryButton } from '../../src/ui/buttons';
import { MapPin, MapTrifold } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { ChoiceChip, onboardingStyles, StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

type Area = ReferenceData['areas'][number];
const CITY_ORDER = [
  'delhi',
  'gurugram',
  'noida',
  'greater_noida',
  'ghaziabad',
  'faridabad',
] as const;

/**
 * M07 Step 4: where the user wants to live (FR-BIO-02/03). The office/college search with a commute
 * zone needs the Places proxy (T2.8, vendor key) and routing (T2.9), both Blocked; until then the
 * design's "Pick areas instead" path is the step: up to 3 preferred areas.
 */
export default function CommuteScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me } = useMe();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number[]>(
    draft.areaIds ?? me?.preferences?.areaIds ?? [],
  );
  const [limitHit, setLimitHit] = useState(false);
  const step = stepNumber('commute');
  const go = useGoOnce();

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
    setLimitHit(false);
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((a) => a !== id);
      if (cur.length >= LIMITS.preferredAreasMax) {
        setLimitHit(true);
        return cur;
      }
      return [...cur, id];
    });
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          testID="continue"
          locale={locale}
          label={t('onboarding.continue')}
          disabled={selected.length === 0}
          onPress={() => {
            updateDraft({ areaIds: selected });
            go('/onboarding/move-in');
          }}
        />
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.commute.overline')}`}
        title={t('onboarding.commute.title')}
        subtitle={t('onboarding.commute.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/budget'))}
        backLabel={t('common.back')}
        locale={locale}
      />

      <View style={[onboardingStyles.card, styles.soon]}>
        <MapTrifold size={22} color={theme.color.brand.primary} />
        <Text style={[textStyle('body', locale), styles.soonText]}>
          {t('onboarding.commute.officeSoon')}
        </Text>
      </View>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  soon: { flexDirection: 'row', alignItems: 'flex-start' },
  soonText: { flex: 1, color: theme.color.text.secondary },
  loading: { flexDirection: 'row', gap: theme.space['3'], alignItems: 'center' },
  city: { gap: theme.space['2'] },
  cityName: { color: theme.color.text.secondary, textTransform: 'uppercase' },
});
