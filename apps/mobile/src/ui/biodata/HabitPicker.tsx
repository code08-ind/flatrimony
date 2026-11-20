import { BEDTIMES, WAKE_TIMES, type HabitAnswers } from '../../onboarding/logic';
import { theme } from '../../theme';
import { useT } from '../../useT';
import { CigaretteSlash, ForkKnife, Moon, PawPrint, Sparkle, Sun } from '../icons';
import { ChipGroup, ChoiceChip } from '../onboarding';

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
 * The six core habits as chip rows (FR-BIO-04; design M09 plus wake time, founder decision
 * 2026-11-17). Controlled.
 */
export function HabitPicker({
  value,
  onChange,
}: {
  value: HabitAnswers;
  onChange: (value: HabitAnswers) => void;
}) {
  const { t, locale } = useT();
  const pick = <K extends keyof HabitAnswers>(key: K, v: HabitAnswers[K]) =>
    onChange({ ...value, [key]: v });
  const icon = (Icon: typeof Moon) => <Icon size={22} color={theme.color.brand.primary} />;

  return (
    <>
      <ChipGroup label={t('onboarding.habits.bedtime')} icon={icon(Moon)} locale={locale}>
        {BEDTIMES.map((o) => (
          <ChoiceChip
            key={o.id}
            label={t(`onboarding.habits.${o.id}`)}
            selected={value.bedtime === o.time}
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
            selected={value.wakeTime === o.time}
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
            selected={value.cleaning === v}
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
            selected={value.smoking === v}
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
            selected={value.pets === o.value}
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
            selected={value.food === v}
            onPress={() => pick('food', v)}
            locale={locale}
          />
        ))}
      </ChipGroup>
    </>
  );
}
