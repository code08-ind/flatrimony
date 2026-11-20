import { useState } from 'react';
import { BudgetPicker } from '../../src/ui/biodata/BudgetPicker';
import { router } from 'expo-router';
import { useMe } from '../../src/me';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import { clampBudget, stepNumber } from '../../src/onboarding/logic';
import { useGoOnce } from '../../src/onboarding/nav';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { StepHeader } from '../../src/ui/onboarding';
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

      <BudgetPicker
        min={min}
        max={max}
        onChange={(lo, hi) => {
          setMin(lo);
          setMax(hi);
        }}
      />
    </Screen>
  );
}
