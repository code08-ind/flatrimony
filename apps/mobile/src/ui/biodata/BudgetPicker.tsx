import { StyleSheet, Text, View } from 'react-native';
import { LIMITS } from '@flatrimony/shared';
import { BUDGET_BRACKETS, BUDGET_STEP, clampBudget, formatInr } from '../../onboarding/logic';
import { textStyle, theme } from '../../theme';
import { useT } from '../../useT';
import { Info } from '../icons';
import { ChoiceChip, onboardingStyles, Stepper } from '../onboarding';

/**
 * Budget per person per month (FR-BIO-02; design M06): range card, −/+ steppers (₹1,000 steps) and
 * quick brackets. Controlled; values are always clamped to the limits with min ≤ max.
 */
export function BudgetPicker({
  min,
  max,
  onChange,
  showNote = true,
}: {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  showNote?: boolean;
}) {
  const { t, locale } = useT();
  const set = (lo: number, hi: number) => {
    const c = clampBudget(lo, hi);
    onChange(c.min, c.max);
  };

  return (
    <>
      <View
        style={styles.hero}
        accessible
        accessibilityLabel={`${t('onboarding.budget.cardLabel')}: ${formatInr(min)} – ${formatInr(max)}`}
      >
        <Text style={[textStyle('label', locale), styles.heroLabel]}>
          {t('onboarding.budget.cardLabel')}
        </Text>
        <Text style={[textStyle('h1', locale), styles.heroValue]}>
          {formatInr(min)} – {formatInr(max)}
        </Text>
      </View>

      <View style={[onboardingStyles.card, styles.steppers]}>
        <Stepper
          label={t('onboarding.budget.min')}
          value={formatInr(min)}
          onMinus={() => set(min - BUDGET_STEP, max)}
          onPlus={() => set(min + BUDGET_STEP, Math.max(max, min + BUDGET_STEP))}
          minusLabel={t('onboarding.budget.decreaseMin')}
          plusLabel={t('onboarding.budget.increaseMin')}
          canMinus={min > LIMITS.budgetInr.min}
          canPlus={min < LIMITS.budgetInr.max}
          locale={locale}
        />
        <Stepper
          label={t('onboarding.budget.max')}
          value={formatInr(max)}
          onMinus={() => set(Math.min(min, max - BUDGET_STEP), max - BUDGET_STEP)}
          onPlus={() => set(min, max + BUDGET_STEP)}
          minusLabel={t('onboarding.budget.decreaseMax')}
          plusLabel={t('onboarding.budget.increaseMax')}
          canMinus={max > LIMITS.budgetInr.min}
          canPlus={max < LIMITS.budgetInr.max}
          locale={locale}
        />
      </View>

      <Text style={[textStyle('label', locale), styles.quick]}>{t('onboarding.budget.quick')}</Text>
      <View style={onboardingStyles.chipWrap} accessibilityRole="radiogroup">
        {BUDGET_BRACKETS.map((b) => (
          <ChoiceChip
            key={b.id}
            label={t(`onboarding.budget.${b.id}`)}
            selected={min === b.min && max === b.max}
            onPress={() => set(b.min, b.max)}
            locale={locale}
          />
        ))}
      </View>
      {showNote && (
        <View style={[onboardingStyles.card, styles.note]}>
          <View style={styles.noteIcon}>
            <Info size={22} color={theme.color.brand.primary} />
          </View>
          <View style={{ flex: 1, gap: theme.space['1'] }}>
            <Text style={[textStyle('h3', locale), { color: theme.color.text.primary }]}>
              {t('onboarding.budget.noteTitle')}
            </Text>
            <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
              {t('onboarding.budget.note')}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: theme.color.brand.primary,
    borderRadius: theme.radius.lg,
    padding: theme.space['6'],
    alignItems: 'center',
    gap: theme.space['2'],
  },
  heroLabel: { color: theme.color.brand.primarySubtle, textTransform: 'uppercase' },
  heroValue: { color: theme.color.white },
  steppers: { gap: theme.space['5'] },
  quick: { color: theme.color.text.secondary, textTransform: 'uppercase' },
  note: { flexDirection: 'row', alignItems: 'flex-start' },
  noteIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
