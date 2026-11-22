import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../../src/me';
import { AreaPicker } from '../../src/ui/biodata/AreaPicker';
import { AnchorPicker } from '../../src/ui/biodata/AnchorPicker';
import { anchorComplete, DEFAULT_MINUTES, type AnchorDraft } from '../../src/anchor/logic';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import { stepNumber } from '../../src/onboarding/logic';
import { useGoOnce } from '../../src/onboarding/nav';
import { saveMe, useSaving } from '../../src/onboarding/save';
import { useReference } from '../../src/profile/reference';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { MapTrifold, MagnifyingGlass } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

/**
 * M07 Step 4: where the user goes every day (FR-BIO-03) — office or college, travel mode and the
 * longest commute, with the commute zone previewed — or, with no office, up to 3 preferred areas
 * (FR-BIO-02; "No office? Pick areas instead"). The anchor is saved here (PUT /me/anchor); areas
 * are saved with the preferences on the move-in step.
 */
export default function CommuteScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const reference = useReference(locale);
  const saving = useSaving();
  const savedAreas = draft.areaIds ?? me?.preferences?.areaIds ?? [];
  const [mode, setMode] = useState<'anchor' | 'areas'>(
    me?.anchor || savedAreas.length === 0 ? 'anchor' : 'areas',
  );
  const [selected, setSelected] = useState<number[]>(savedAreas);
  const [anchor, setAnchor] = useState<AnchorDraft>(
    me?.anchor
      ? { ...me.anchor }
      : {
          kind: me?.category === 'student' ? 'college' : 'office',
          travelMode: 'metro_transit',
          maxCommuteMin: DEFAULT_MINUTES,
        },
  );
  const step = stepNumber('commute');
  const go = useGoOnce();

  const next = () => {
    if (mode === 'areas') {
      updateDraft({ areaIds: selected });
      go('/onboarding/move-in');
      return;
    }
    if (!anchorComplete(anchor)) return;
    void saving.run(
      () =>
        saveMe('/me/anchor', 'PUT', {
          kind: anchor.kind,
          label: anchor.label,
          location: anchor.location,
          travelMode: anchor.travelMode,
          maxCommuteMin: anchor.maxCommuteMin,
        }),
      (saved, etag) => {
        set(saved, etag);
        // With an office or college the areas are optional: none unless picked later.
        updateDraft({ areaIds: draft.areaIds ?? [] });
        go('/onboarding/move-in');
      },
    );
  };

  return (
    <Screen
      footer={
        <>
          {saving.error ? <Notice tone="error" locale={locale} message={t(saving.error)} /> : null}
          <PrimaryButton
            testID="continue"
            locale={locale}
            label={t('onboarding.continue')}
            disabled={mode === 'areas' ? selected.length === 0 : !anchorComplete(anchor)}
            busy={saving.busy}
            onPress={next}
          />
        </>
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.commute.overline')}`}
        title={mode === 'anchor' ? t('anchor.title') : t('onboarding.commute.title')}
        subtitle={mode === 'anchor' ? t('anchor.subtitle') : t('onboarding.commute.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/budget'))}
        backLabel={t('common.back')}
        locale={locale}
      />

      {mode === 'anchor' ? (
        <AnchorPicker value={anchor} onChange={setAnchor} areas={reference.data?.areas ?? []} />
      ) : (
        <AreaPicker selected={selected} onChange={setSelected} />
      )}

      <Pressable
        testID={mode === 'anchor' ? 'pick-areas' : 'use-anchor'}
        accessibilityRole="button"
        onPress={() => setMode(mode === 'anchor' ? 'areas' : 'anchor')}
        style={styles.switch}
        hitSlop={8}
      >
        {mode === 'anchor' ? (
          <MapTrifold size={18} color={theme.color.brand.primary} />
        ) : (
          <MagnifyingGlass size={18} color={theme.color.brand.primary} />
        )}
        <Text style={[textStyle('label', locale), { color: theme.color.brand.primary }]}>
          {mode === 'anchor' ? t('anchor.pickAreas') : t('anchor.useAnchor')}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  switch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space['2'],
    minHeight: 48,
  },
});
