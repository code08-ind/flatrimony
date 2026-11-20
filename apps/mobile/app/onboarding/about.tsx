import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { humanText, LIMITS } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { updateDraft, useDraft } from '../../src/onboarding/draft';
import { parseDob, todayIst, type DobProblem } from '../../src/onboarding/logic';
import { useGoOnce } from '../../src/onboarding/nav';
import { saveMe, useSaving } from '../../src/onboarding/save';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { Notice } from '../../src/ui/Notice';
import { onboardingStyles, StepHeader } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

const NAME = humanText(LIMITS.displayNameMaxChars);
const DOB_MESSAGE = {
  incomplete: 'onboarding.about.dobIncomplete',
  invalid: 'onboarding.about.dobInvalid',
  underage: 'onboarding.about.dobUnderage',
  too_old: 'onboarding.about.dobTooOld',
} as const satisfies Record<DobProblem, string>;

/**
 * "About you": first name and date of birth, before the six steps (founder decision 2026-11-17;
 * POST /me/bootstrap needs both). After bootstrap the date of birth is fixed (DigiLocker replaces
 * it at verification); only the name can still change here.
 */
export default function AboutScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const go = useGoOnce();

  const [name, setName] = useState(me?.displayName ?? draft.displayName ?? '');
  const [d0, m0, y0] = (draft.dateOfBirth ?? '').split('-').reverse();
  const [day, setDay] = useState(d0 ?? '');
  const [month, setMonth] = useState(m0 ?? '');
  const [year, setYear] = useState(y0 ?? '');
  const [touched, setTouched] = useState(false);
  const monthRef = useRef<ComponentRef<typeof TextInput>>(null);
  const yearRef = useRef<ComponentRef<typeof TextInput>>(null);

  const nameOk = NAME.safeParse(name).success;
  const dob = me ? null : parseDob(day, month, year, todayIst(Date.now()));
  const dobOk = me ? true : !!dob?.ok;
  const showDobError = !me && touched && dob && !dob.ok;

  const next = () => {
    setTouched(true);
    if (!nameOk || !dobOk) return;
    const displayName = NAME.parse(name);
    if (me) {
      // Already bootstrapped: only the name can change.
      if (displayName === me.displayName) return go('/onboarding/intent');
      void saving.run(
        () => saveMe('/me', 'PATCH', { displayName }),
        (updated, etag) => {
          set(updated, etag);
          router.push('/onboarding/intent');
        },
      );
      return;
    }
    updateDraft({ displayName, dateOfBirth: dob!.ok ? dob!.iso : undefined });
    go('/onboarding/intent');
  };

  const digits = (v: string) => v.replace(/\D/g, '');
  // Typed fast or pasted ("12062000"): digits beyond a box flow into the next ones, so nothing is
  // lost while focus moves.
  const spill = (all: string) => {
    setDay(all.slice(0, 2));
    setMonth(all.slice(2, 4));
    setYear(all.slice(4, 8));
    (all.length >= 4 ? yearRef : monthRef).current?.focus();
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          testID="continue"
          locale={locale}
          label={t('onboarding.continue')}
          onPress={next}
          disabled={!nameOk || (touched && !dobOk)}
          busy={saving.busy}
        />
      }
    >
      <StepHeader
        overline={t('onboarding.about.overline')}
        title={t('onboarding.about.title')}
        subtitle={t('onboarding.about.subtitle')}
        backLabel={t('common.back')}
        locale={locale}
      />

      <View style={onboardingStyles.card}>
        <Text style={[textStyle('label', locale), styles.label]}>
          {t('onboarding.about.nameLabel')}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('onboarding.about.namePlaceholder')}
          placeholderTextColor={theme.color.text.disabled}
          accessibilityLabel={t('onboarding.about.nameLabel')}
          autoComplete="given-name"
          textContentType="givenName"
          autoCapitalize="words"
          maxLength={80}
          style={[textStyle('bodyLg', locale), styles.input]}
        />
        {/* Explain at once why Continue is off (too long, only invisible characters). */}
        {(touched || name.length > 0) && !nameOk && (
          <Notice tone="error" locale={locale} message={t('onboarding.about.nameInvalid')} />
        )}
      </View>

      {/* After bootstrap the date of birth is fixed (DigiLocker replaces it at verification). */}
      {!me && (
        <View style={onboardingStyles.card}>
          <Text style={[textStyle('label', locale), styles.label]}>
            {t('onboarding.about.dobLabel')}
          </Text>
          {
            <View style={styles.dobRow}>
              <TextInput
                value={day}
                onChangeText={(v) => {
                  const d = digits(v);
                  if (d.length > 2) return spill(d);
                  setDay(d);
                  if (d.length === 2) monthRef.current?.focus();
                }}
                placeholder={t('onboarding.about.day')}
                placeholderTextColor={theme.color.text.disabled}
                accessibilityLabel={t('onboarding.about.dayLabel')}
                keyboardType="number-pad"
                autoComplete="birthdate-day"
                style={[textStyle('bodyLg', locale), styles.input, styles.dobPart]}
              />
              <TextInput
                ref={monthRef}
                value={month}
                onChangeText={(v) => {
                  const m = digits(v);
                  if (m.length > 2) {
                    setMonth(m.slice(0, 2));
                    setYear(m.slice(2, 6));
                    return yearRef.current?.focus();
                  }
                  setMonth(m);
                  if (m.length === 2) yearRef.current?.focus();
                }}
                placeholder={t('onboarding.about.month')}
                placeholderTextColor={theme.color.text.disabled}
                accessibilityLabel={t('onboarding.about.monthLabel')}
                keyboardType="number-pad"
                autoComplete="birthdate-month"
                style={[textStyle('bodyLg', locale), styles.input, styles.dobPart]}
              />
              <TextInput
                ref={yearRef}
                value={year}
                onChangeText={(v) => setYear(digits(v).slice(0, 4))}
                onBlur={() => setTouched(true)}
                placeholder={t('onboarding.about.year')}
                placeholderTextColor={theme.color.text.disabled}
                accessibilityLabel={t('onboarding.about.yearLabel')}
                keyboardType="number-pad"
                autoComplete="birthdate-year"
                maxLength={4}
                style={[textStyle('bodyLg', locale), styles.input, styles.dobYear]}
              />
            </View>
          }
          {showDobError && dob && !dob.ok && (
            <Notice tone="error" locale={locale} message={t(DOB_MESSAGE[dob.problem])} />
          )}
        </View>
      )}

      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.color.text.secondary },
  input: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['4'],
    color: theme.color.text.primary,
    backgroundColor: theme.color.bg.app,
  },
  dobRow: { flexDirection: 'row', gap: theme.space['3'] },
  // minWidth 0: text inputs otherwise keep their intrinsic width and overflow the row (web).
  dobPart: { flex: 1, minWidth: 0, textAlign: 'center' },
  dobYear: { flex: 1.6, minWidth: 0, textAlign: 'center' },
});
