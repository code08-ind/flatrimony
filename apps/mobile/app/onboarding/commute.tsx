import { useState } from 'react';
import { AreaPicker } from '../../src/ui/biodata/AreaPicker';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../../src/me';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import { stepNumber } from '../../src/onboarding/logic';
import { useGoOnce } from '../../src/onboarding/nav';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { MapTrifold } from '../../src/ui/icons';
import { onboardingStyles, StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

/**
 * M07 Step 4: where the user wants to live (FR-BIO-02/03). The office/college search with a commute
 * zone needs the Places proxy (T2.8, vendor key) and routing (T2.9), both Blocked; until then the
 * design's "Pick areas instead" path is the step: up to 3 preferred areas.
 */
export default function CommuteScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me } = useMe();
  const [selected, setSelected] = useState<number[]>(
    draft.areaIds ?? me?.preferences?.areaIds ?? [],
  );
  const step = stepNumber('commute');
  const go = useGoOnce();

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

      <AreaPicker selected={selected} onChange={setSelected} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  soon: { flexDirection: 'row', alignItems: 'flex-start' },
  soonText: { flex: 1, color: theme.color.text.secondary },
});
