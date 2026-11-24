import { useState } from 'react';
import { MoveInPicker } from '../../src/ui/biodata/MoveInPicker';
import { router } from 'expo-router';
import { LIMITS } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { getDraft, updateDraft, useDraft } from '../../src/onboarding/draft';
import { preferencesBody, stepNumber } from '@flatrimony/client';
import { saveMe, useSaving } from '../../src/onboarding/save';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { Notice } from '../../src/ui/Notice';
import { StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

/** M08 Step 5: move-in window and lease length (FR-BIO-02). Saves the preferences. */
export default function MoveInScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const step = stepNumber('move-in');

  const [range, setRange] = useState<{ from?: string; to?: string }>({
    from: draft.moveInFrom ?? me?.preferences?.moveInFrom,
    to: draft.moveInTo ?? me?.preferences?.moveInTo,
  });
  const [lease, setLease] = useState(
    draft.leaseMonths ?? me?.preferences?.leaseMonths ?? LIMITS.leaseMonths.default,
  );
  const complete = !!range.from && !!range.to;

  const save = () => {
    if (!complete) return;
    updateDraft({ moveInFrom: range.from, moveInTo: range.to, leaseMonths: lease });
    const body = preferencesBody(getDraft(), me?.category ?? 'professional', me?.preferences);
    // Lost earlier answers (restart): resume from the first missing step.
    if (!body || !me) return router.replace('/onboarding');
    void saving.run(
      () => saveMe('/me/preferences', 'PUT', body),
      (saved, etag) => {
        set(saved, etag);
        router.push('/onboarding/habits');
      },
    );
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          testID="continue"
          locale={locale}
          label={t('onboarding.continue')}
          disabled={!complete}
          busy={saving.busy}
          onPress={save}
        />
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.moveIn.overline')}`}
        title={t('onboarding.moveIn.title')}
        subtitle={t('onboarding.moveIn.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/commute'))}
        backLabel={t('common.back')}
        locale={locale}
      />

      <MoveInPicker range={range} onRange={setRange} lease={lease} onLease={setLease} />

      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </Screen>
  );
}
