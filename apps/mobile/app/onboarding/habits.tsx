import { useState } from 'react';
import { HabitPicker } from '../../src/ui/biodata/HabitPicker';
import { router } from 'expo-router';
import type { Lifestyle } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { resetDraft } from '../../src/onboarding/draft';
import { habitsComplete, stepNumber, type HabitAnswers } from '../../src/onboarding/logic';
import { saveMe, useSaving } from '../../src/onboarding/save';
import { Text } from 'react-native';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { Sparkle } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

/**
 * M09 Step 6: "Your habits" (docs/06 §8.3; FR-BIO-04): the core questions as chip rows on one
 * screen, plus wake time (founder decision 2026-11-17). Finishing saves the lifestyle; the
 * onboarding layout then opens Discover.
 */
export default function HabitsScreen() {
  const { t, locale } = useT();
  const { me, set } = useMe();
  const saving = useSaving();
  const l = me?.lifestyle;
  const [h, setH] = useState<HabitAnswers>({
    bedtime: l?.bedtime,
    wakeTime: l?.wakeTime,
    cleaning: l?.cleaning,
    smoking: l?.smoking,
    pets: l?.pets,
    food: l?.food,
  });
  const step = stepNumber('habits');

  const finish = () => {
    if (!habitsComplete(h)) return;
    if (!me) return router.replace('/onboarding');
    // Keep any optional answers already saved (the PUT replaces the whole lifestyle).
    const body: Lifestyle = { ...(me.lifestyle ?? {}), ...h };
    void saving.run(
      () => saveMe('/me/lifestyle', 'PUT', body),
      (saved, etag) => {
        resetDraft();
        set(saved, etag); // complete → the layout opens Discover
      },
    );
  };

  return (
    <Screen
      footer={
        <>
          {!habitsComplete(h) && (
            <Text
              style={[
                textStyle('caption', locale),
                { color: theme.color.text.secondary, textAlign: 'center' },
              ]}
              accessibilityLiveRegion="polite"
            >
              {t('onboarding.habits.progress', { done: Object.values(h).filter(Boolean).length })}
            </Text>
          )}
          <PrimaryButton
            testID="finish"
            locale={locale}
            label={t('onboarding.habits.finish')}
            icon={<Sparkle size={20} color={theme.color.white} weight="fill" />}
            trailingArrow={false}
            disabled={!habitsComplete(h)}
            busy={saving.busy}
            onPress={finish}
          />
        </>
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.habits.overline')}`}
        title={t('onboarding.habits.title')}
        subtitle={t('onboarding.habits.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/move-in'))}
        backLabel={t('common.back')}
        locale={locale}
      />

      <HabitPicker value={h} onChange={setH} />

      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </Screen>
  );
}
