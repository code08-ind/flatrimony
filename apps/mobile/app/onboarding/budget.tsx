import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LIMITS } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import {
  BUDGET_BRACKETS,
  BUDGET_STEP,
  clampBudget,
  formatInr,
  stepNumber,
} from '../../src/onboarding/logic';
import { useGoOnce } from '../../src/onboarding/nav';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { Info } from '../../src/ui/icons';
import { ChoiceChip, onboardingStyles, StepHeader, Stepper } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

/**
 * M06 Step 3: budget per person per month (FR-BIO-02). The design's two-thumb slider is shown as
 * −/+ steppers (₹1,000 steps), which are easier to use precisely and with a screen reader.
 */
export default function BudgetScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me } = useMe();
  const initial = clampBudget(
    draft.budgetMinInr ?? me?.preferences?.budgetMinInr ?? 10_000,
    draft.budgetMaxInr ?? me?.preferences?.budgetMaxInr ?? 20_000,
  );
  const [min, setMin] = useState(initial.min);
  const [max, setMax] = useState(initial.max);
  const step = stepNumber('budget');
  const go = useGoOnce();

  const set = (lo: number, hi: number) => {
    const c = clampBudget(lo, hi);
    setMin(c.min);
    setMax(c.max);
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          testID="continue"
          locale={locale}
          label={t('onboarding.continue')}
          onPress={() => {
            updateDraft({ budgetMinInr: min, budgetMaxInr: max });
            go('/onboarding/commute');
          }}
        />
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.budget.overline')}`}
        title={t('onboarding.budget.title')}
        subtitle={t('onboarding.budget.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/category'))}
        backLabel={t('common.back')}
        locale={locale}
      />

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
    </Screen>
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
