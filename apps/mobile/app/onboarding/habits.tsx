import { useState } from 'react';
import { router } from 'expo-router';
import type { Lifestyle } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { resetDraft } from '../../src/onboarding/draft';
import {
  BEDTIMES,
  habitsComplete,
  stepNumber,
  WAKE_TIMES,
  type HabitAnswers,
} from '../../src/onboarding/logic';
import { saveMe, useSaving } from '../../src/onboarding/save';
import { Text } from 'react-native';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { CigaretteSlash, ForkKnife, Moon, PawPrint, Sparkle, Sun } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { ChipGroup, ChoiceChip, StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

const CLEANING = ['daily', 'few_times_week', 'weekly', 'rarely'] as const;
const SMOKING = ['no', 'outside_only', 'yes'] as const;
const PETS = [
  { value: 'have', label: 'have' },
  { value: 'love', label: 'love' },
  { value: 'ok', label: 'ok' },
  { value: 'no', label: 'no_pets' },
] as const;
const FOOD = ['veg', 'eggetarian', 'non_veg', 'vegan'] as const;

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
  const pick = <K extends keyof HabitAnswers>(key: K, value: HabitAnswers[K]) =>
    setH((cur) => ({ ...cur, [key]: value }));
  const icon = (Icon: typeof Moon) => <Icon size={22} color={theme.color.brand.primary} />;

  const finish = () => {
    if (!habitsComplete(h)) return;
    if (!me) return router.replace('/onboarding');
    // Keep any optional answers already saved (the PUT replaces the whole lifestyle).
    const body: Lifestyle = { ...(me.lifestyle ?? {}), ...h };
    void saving.run(
      () => saveMe('/me/lifestyle', 'PUT', body),
      (saved) => {
        resetDraft();
        set(saved); // complete → the layout opens Discover
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

      <ChipGroup label={t('onboarding.habits.bedtime')} icon={icon(Moon)} locale={locale}>
        {BEDTIMES.map((o) => (
          <ChoiceChip
            key={o.id}
            label={t(`onboarding.habits.${o.id}`)}
            selected={h.bedtime === o.time}
            onPress={() => pick('bedtime', o.time)}
            locale={locale}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={t('onboarding.habits.wakeTime')} icon={icon(Sun)} locale={locale}>
        {WAKE_TIMES.map((o) => (
          <ChoiceChip
            key={o.id}
            label={t(`onboarding.habits.${o.id}`)}
            selected={h.wakeTime === o.time}
            onPress={() => pick('wakeTime', o.time)}
            locale={locale}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={t('onboarding.habits.cleaning')} icon={icon(Sparkle)} locale={locale}>
        {CLEANING.map((v) => (
          <ChoiceChip
            key={v}
            label={t(`onboarding.habits.${v}`)}
            selected={h.cleaning === v}
            onPress={() => pick('cleaning', v)}
            locale={locale}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={t('onboarding.habits.smoking')} icon={icon(CigaretteSlash)} locale={locale}>
        {SMOKING.map((v) => (
          <ChoiceChip
            key={v}
            label={t(`onboarding.habits.${v}`)}
            selected={h.smoking === v}
            onPress={() => pick('smoking', v)}
            locale={locale}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={t('onboarding.habits.pets')} icon={icon(PawPrint)} locale={locale}>
        {PETS.map((o) => (
          <ChoiceChip
            key={o.value}
            label={t(`onboarding.habits.${o.label}`)}
            selected={h.pets === o.value}
            onPress={() => pick('pets', o.value)}
            locale={locale}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={t('onboarding.habits.food')} icon={icon(ForkKnife)} locale={locale}>
        {FOOD.map((v) => (
          <ChoiceChip
            key={v}
            label={t(`onboarding.habits.${v}`)}
            selected={h.food === v}
            onPress={() => pick('food', v)}
            locale={locale}
          />
        ))}
      </ChipGroup>

      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </Screen>
  );
}
