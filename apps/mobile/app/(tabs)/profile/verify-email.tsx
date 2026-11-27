import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  emailBadgeView,
  emailFieldError,
  emailStartErrorKey,
  RESEND_AFTER_MS,
  type EmailBadgeView,
} from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import {
  StartEmailVerificationResponse,
  VerificationList,
  type EmailVerificationType,
  type Verification,
} from '@flatrimony/shared';
import { api, NetworkError } from '../../../src/api';
import { useMe } from '../../../src/me';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { BackButton, PrimaryButton, SecondaryButton } from '../../../src/ui/buttons';
import {
  Briefcase,
  EnvelopeSimple,
  GraduationCap,
  LockSimple,
  SealCheck,
} from '../../../src/ui/icons';
import { Notice } from '../../../src/ui/Notice';
import { OptionCard } from '../../../src/ui/onboarding';
import { Screen } from '../../../src/ui/Screen';

type Sent = { verificationId: string; to: string | null; at: number };

/**
 * Work or college email badge (FR-VER-05, T3.3; designs M34 "DigiLocker & work email", M37
 * Passport "Work email verified"). The member picks work or college, types the address and gets a
 * one-time link; opening it (on any device) adds "Verified company" or "Verified student". The
 * app checks again whenever it comes back to the front. The address stays on this screen only:
 * the API keeps its domain and a coded copy, and profiles show the badge, never the address.
 */
export default function VerifyEmailScreen() {
  const { t, locale } = useT();
  const { me, refresh } = useMe();
  const params = useLocalSearchParams<{ type?: string }>();
  const [type, setType] = useState<EmailVerificationType>(
    params.type === 'college_email' || (!params.type && me?.category === 'student')
      ? 'college_email'
      : 'work_email',
  );
  const [attempts, setAttempts] = useState<Verification[] | null>(null);
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState<Partial<Record<EmailVerificationType, Sent>>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [clock, setClock] = useState(Date.now());
  const sending = useRef(false);

  /** The member's attempts and badges as the API has them now. */
  const load = useCallback(async () => {
    try {
      const [res] = await Promise.all([
        api('/verifications', { locale }),
        refresh({ quiet: true }),
      ]);
      const parsed = VerificationList.safeParse(res.body);
      if (res.status !== 200 || !parsed.success) throw new Error('verifications');
      setAttempts(parsed.data.verifications);
      return true;
    } catch {
      setAttempts((a) => a ?? []);
      return false;
    }
  }, [locale, refresh]);

  useEffect(() => {
    void load();
  }, [load]);
  // Back from the mail app: the link may have been opened.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);
  // The "Send again in N s" countdown.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const view: EmailBadgeView | null =
    me && attempts ? emailBadgeView(type, me.badges, attempts, clock) : null;
  const mine = sent[type];
  const showSent = !editing && view?.kind === 'sent';

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const fieldError = touched ? emailFieldError(type, email) : null;

  const choose = (next: EmailVerificationType) => {
    if (next === type) return;
    setType(next);
    setError(null);
    setNotice(null);
    setTouched(false);
    setEditing(false);
  };

  const send = async () => {
    setTouched(true);
    const problem = emailFieldError(type, email);
    if (problem) return setError(problem);
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api('/verifications/email', {
        method: 'POST',
        body: { email: email.trim(), type },
        locale,
      });
      const parsed = StartEmailVerificationResponse.safeParse(res.body);
      if (res.status !== 201 || !parsed.success) {
        setError(emailStartErrorKey(res.status, res.body));
        if (res.status === 409) void load(); // the badge may be there already
        return;
      }
      setSent((s) => ({
        ...s,
        [type]: { verificationId: parsed.data.verificationId, to: email.trim(), at: Date.now() },
      }));
      setEditing(false);
      await load();
    } catch (err) {
      setError(emailStartErrorKey(err instanceof NetworkError ? 'network' : 500, undefined));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setNotice(null);
    setError(null);
    const ok = await load();
    setChecking(false);
    if (!ok) setError('verification.errors.status');
  };

  // The badge arrived while this screen was open: say so once.
  const verified = view?.kind === 'verified';
  useEffect(() => {
    if (verified) setNotice(null);
  }, [verified]);

  if (!me || !view)
    return (
      <Screen>
        <View style={styles.result}>
          <ActivityIndicator
            size="large"
            color={theme.color.brand.primary}
            accessibilityLabel={t('state.loading')}
          />
        </View>
      </Screen>
    );

  const kindPicker = (
    <View style={{ gap: theme.space['3'] }} accessibilityRole="radiogroup">
      <Text style={[textStyle('label', locale), styles.primary]}>
        {t('verification.email.kindLabel')}
      </Text>
      <OptionCard
        icon={<Briefcase size={22} color={theme.color.brand.primary} />}
        title={t('verification.email.work')}
        subtitle={t('verification.email.workSub')}
        selected={type === 'work_email'}
        onPress={() => choose('work_email')}
        locale={locale}
      />
      <OptionCard
        icon={<GraduationCap size={22} color={theme.color.brand.primary} />}
        title={t('verification.email.college')}
        subtitle={t('verification.email.collegeSub')}
        selected={type === 'college_email'}
        onPress={() => choose('college_email')}
        locale={locale}
      />
    </View>
  );

  const header = (
    <>
      <BackButton label={t('common.back')} onPress={close} />
      <View style={styles.titles}>
        <Text style={[textStyle('label', locale), styles.overline]}>
          {t('verification.email.overline')}
        </Text>
        <Text style={textStyle('display', locale)} accessibilityRole="header">
          {t('verification.email.title')}
        </Text>
        <Text style={[textStyle('bodyLg', locale), styles.muted]}>
          {t('verification.email.body')}
        </Text>
      </View>
    </>
  );

  if (verified)
    return (
      <Screen
        footer={
          <PrimaryButton
            testID="verify-email-done"
            locale={locale}
            label={t('verification.done')}
            trailingArrow={false}
            onPress={close}
          />
        }
      >
        {header}
        {kindPicker}
        <View style={[styles.card, styles.center]} testID="verify-email-verified">
          <View style={[styles.badge, styles.badgeOk]}>
            <SealCheck size={40} color={theme.semantic.status.verified.fg} weight="fill" />
          </View>
          <Text
            style={[textStyle('h2', locale), styles.primary, styles.centerText]}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {t(
              type === 'work_email'
                ? 'verification.email.verified.work'
                : 'verification.email.verified.college',
            )}
          </Text>
          <Text style={[textStyle('body', locale), styles.muted, styles.centerText]}>
            {t('verification.email.verified.body')}
          </Text>
        </View>
      </Screen>
    );

  if (showSent) {
    const wait = mine ? Math.max(0, Math.ceil((mine.at + RESEND_AFTER_MS - clock) / 1000)) : 0;
    return (
      <Screen
        footer={
          <>
            {error ? <Notice tone="error" locale={locale} message={t(error)} /> : null}
            {notice ? <Notice tone="info" locale={locale} message={t(notice)} /> : null}
            <PrimaryButton
              testID="verify-email-check"
              locale={locale}
              label={t('verification.email.sent.check')}
              busy={checking}
              trailingArrow={false}
              onPress={() =>
                void check().then(() => setNotice((n) => n ?? 'verification.email.notYet'))
              }
            />
            {mine?.to ? (
              <SecondaryButton
                testID="verify-email-resend"
                locale={locale}
                label={
                  wait > 0
                    ? t('verification.email.sent.resendIn', { seconds: wait })
                    : t('verification.email.sent.resend')
                }
                disabled={wait > 0 || busy}
                trailingArrow={false}
                onPress={() => {
                  setEmail(mine.to!);
                  void send();
                }}
              />
            ) : null}
            <SecondaryButton
              testID="verify-email-change"
              locale={locale}
              label={t('verification.email.sent.change')}
              trailingArrow={false}
              onPress={() => {
                setEditing(true);
                setError(null);
                setNotice(null);
              }}
            />
          </>
        }
      >
        {header}
        {kindPicker}
        <View style={[styles.card, styles.center]} testID="verify-email-sent">
          <View style={[styles.badge, styles.badgeWait]}>
            <EnvelopeSimple size={40} color={theme.color.brand.primary} weight="fill" />
          </View>
          <Text
            style={[textStyle('h2', locale), styles.primary, styles.centerText]}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {t('verification.email.sent.title')}
          </Text>
          <Text style={[textStyle('body', locale), styles.muted, styles.centerText]}>
            {mine?.to
              ? t('verification.email.sent.body', { email: mine.to })
              : t('verification.email.sent.bodyNoEmail')}
          </Text>
          <Text style={[textStyle('caption', locale), styles.muted, styles.centerText]}>
            {t('verification.email.sent.spam')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <>
          {view.kind === 'in_use' && !error ? (
            <Notice
              tone="error"
              locale={locale}
              message={`${t('verification.email.inUse.title')}. ${t('verification.email.inUse.body')}`}
            />
          ) : null}
          {error ? <Notice tone="error" locale={locale} message={t(error)} /> : null}
          <PrimaryButton
            testID="verify-email-send"
            locale={locale}
            label={t('verification.email.send')}
            icon={
              <EnvelopeSimple size={22} color={theme.semantic.action.primary.fg} weight="bold" />
            }
            busy={busy}
            onPress={() => void send()}
          />
          <SecondaryButton
            locale={locale}
            label={t('verification.gate.notNow')}
            trailingArrow={false}
            onPress={close}
          />
        </>
      }
    >
      {header}
      {kindPicker}
      <View style={{ gap: theme.space['2'] }}>
        <Text nativeID="verify-email-label" style={[textStyle('label', locale), styles.primary]}>
          {t(
            type === 'work_email'
              ? 'verification.email.labelWork'
              : 'verification.email.labelCollege',
          )}
        </Text>
        <TextInput
          testID="verify-email-input"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          onBlur={() => setTouched(email.trim().length > 0)}
          onSubmitEditing={() => void send()}
          placeholder={t(
            type === 'work_email'
              ? 'verification.email.placeholderWork'
              : 'verification.email.placeholderCollege',
          )}
          placeholderTextColor={theme.color.text.disabled}
          accessibilityLabelledBy="verify-email-label"
          accessibilityLabel={t(
            type === 'work_email'
              ? 'verification.email.labelWork'
              : 'verification.email.labelCollege',
          )}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          inputMode="email"
          maxLength={254}
          returnKeyType="send"
          style={[textStyle('bodyLg', locale), styles.input, fieldError && styles.inputError]}
        />
        {fieldError && !error ? (
          <Text
            style={[textStyle('caption', locale), styles.errorText]}
            accessibilityLiveRegion="polite"
          >
            {t(fieldError)}
          </Text>
        ) : null}
      </View>
      <View style={styles.privacy}>
        <LockSimple size={18} color={theme.color.text.secondary} />
        <Text style={[textStyle('caption', locale), styles.muted, { flex: 1 }]}>
          {t('verification.email.privacy')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  overline: { color: theme.color.brand.primary, textTransform: 'uppercase' },
  primary: { color: theme.color.text.primary },
  muted: { color: theme.color.text.secondary },
  centerText: { textAlign: 'center' },
  center: { alignItems: 'center' },
  result: { alignItems: 'center', gap: theme.space['3'], paddingVertical: theme.space['8'] },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['3'],
    ...theme.elevation['1'],
  },
  badge: {
    width: 80,
    height: 80,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOk: { backgroundColor: theme.semantic.status.verified.bg },
  badgeWait: { backgroundColor: theme.color.brand.primarySubtle },
  input: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['3'],
    backgroundColor: theme.color.bg.app,
    color: theme.color.text.primary,
  },
  inputError: { borderColor: theme.semantic.status.error.fg },
  errorText: { color: theme.semantic.status.error.fg },
  privacy: {
    flexDirection: 'row',
    gap: theme.space['2'],
    alignItems: 'flex-start',
    padding: theme.space['3'],
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.bg.surface,
  },
});
