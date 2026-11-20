import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PublicConfig, type Category, type Me } from '@flatrimony/shared';
import { api } from '../../src/api';
import { config } from '../../src/config';
import { getDeviceId } from '../../src/device';
import { useMe } from '../../src/me';
import { getDraft, updateDraft, useDraft } from '../../src/onboarding/draft';
import { bootstrapBody, genderPrefFor, stepNumber } from '../../src/onboarding/logic';
import { saveMe, useSaving, type SaveResult } from '../../src/onboarding/save';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { Compass, GraduationCap, Laptop, ShieldCheck } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { OptionCard, StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

const OPTIONS = [
  {
    value: 'professional',
    Icon: Laptop,
    title: 'onboarding.category.professional',
    sub: 'onboarding.category.professionalSub',
  },
  {
    value: 'student',
    Icon: GraduationCap,
    title: 'onboarding.category.student',
    sub: 'onboarding.category.studentSub',
  },
  {
    value: 'women_only',
    Icon: ShieldCheck,
    title: 'onboarding.category.womenOnly',
    sub: 'onboarding.category.womenOnlySub',
  },
  {
    value: 'relocating',
    Icon: Compass,
    title: 'onboarding.category.relocating',
    sub: 'onboarding.category.relocatingSub',
  },
] as const;

/** Creates the account (first time) or updates intent and category (when going back). */
async function saveIdentity(
  category: Category,
  locale: 'en' | 'hi',
  existing: Me | null,
): Promise<SaveResult> {
  const draft = { ...getDraft(), category };
  if (existing) {
    const patched = await saveMe('/me', 'PATCH', { intent: draft.intent, category });
    // Women-only members look for women flatmates: keep saved preferences in line with the new
    // category (QA T2.6 M2).
    const prefs = patched.ok ? patched.me.preferences : undefined;
    if (prefs && prefs.flatmateGenderPref !== genderPrefFor(category)) {
      const updated = await saveMe('/me/preferences', 'PUT', {
        ...prefs,
        flatmateGenderPref: genderPrefFor(category),
      });
      if (updated.ok) return updated;
    }
    return patched;
  }
  // The current Terms/Privacy versions (accepted on the welcome and phone screens).
  let legalVersions: { terms?: string; privacy?: string } = {};
  try {
    const res = await api('/config');
    if (res.status !== 200) return { ok: false, error: 'onboarding.errors.save' };
    const parsed = PublicConfig.safeParse(res.body);
    if (parsed.success) legalVersions = parsed.data.legalVersions;
  } catch {
    return { ok: false, error: 'onboarding.errors.save' };
  }
  const body = bootstrapBody(draft, {
    locale,
    legalVersions,
    device: {
      deviceId: await getDeviceId(),
      platform: Platform.OS === 'web' ? 'web' : 'android',
      appVersion: config.appVersion,
    },
  });
  // No published Terms/Privacy yet (T0.15), or the earlier answers were lost (restart).
  if (!body)
    return {
      ok: false,
      error:
        legalVersions.terms && legalVersions.privacy
          ? 'onboarding.errors.generic'
          : 'onboarding.errors.notOpen',
    };
  return saveMe('/me/bootstrap', 'POST', body);
}

/** M05 Step 2: category (FR-AUTH-06; women-only explained, docs/06 §8.3). */
export default function CategoryScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const [category, setCategory] = useState<Category | undefined>(draft.category ?? me?.category);
  const step = stepNumber('category');

  const next = () => {
    if (!category) return;
    // Lost the earlier answers (app restarted before the account existed): start again.
    if (!me && (!getDraft().displayName || !getDraft().intent))
      return router.replace('/onboarding');
    updateDraft({ category });
    void saving.run(
      () => saveIdentity(category, locale, me),
      (saved, etag) => {
        set(saved, etag);
        router.push('/onboarding/budget');
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
          disabled={!category}
          busy={saving.busy}
          onPress={next}
        />
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.category.overline')}`}
        title={t('onboarding.category.title')}
        subtitle={t('onboarding.category.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/intent'))}
        backLabel={t('common.back')}
        locale={locale}
      />
      <View style={styles.grid} accessibilityRole="radiogroup">
        {OPTIONS.map(({ value, Icon, title, sub }) => (
          <OptionCard
            key={value}
            compact
            icon={
              <Icon
                size={24}
                color={category === value ? theme.color.text.primary : theme.color.brand.primary}
              />
            }
            title={t(title)}
            subtitle={t(sub)}
            selected={category === value}
            onPress={() => setCategory(value)}
            locale={locale}
          />
        ))}
      </View>
      <View style={styles.note}>
        <ShieldCheck size={24} color={theme.color.brand.primary} weight="fill" />
        <View style={styles.noteText}>
          <Text style={[textStyle('label', locale), styles.noteTitle]}>
            {t('onboarding.category.womenNoteTitle')}
          </Text>
          <Text style={[textStyle('body', locale), { color: theme.color.text.primary }]}>
            {t('onboarding.category.womenNote')}
          </Text>
        </View>
      </View>
      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] },
  note: {
    flexDirection: 'row',
    gap: theme.space['3'],
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    ...theme.elevation['1'],
  },
  noteText: { flex: 1, gap: theme.space['1'] },
  noteTitle: { color: theme.color.brand.primary, textTransform: 'uppercase' },
});
