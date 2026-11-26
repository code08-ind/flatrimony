import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  hasLatinLetter,
  outcomeCopy,
  pollVerification,
  resumeFrom,
  startErrorKey,
  type VerifyOutcome,
} from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import {
  humanText,
  LIMITS,
  PublicConfig,
  StartDigiLockerResponse,
  Verification,
  VerificationList,
} from '@flatrimony/shared';
import { api, NetworkError, problemCode } from '../../../src/api';
import { useMe } from '../../../src/me';
import { saveMe } from '../../../src/onboarding/save';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { BackButton, PrimaryButton, SecondaryButton } from '../../../src/ui/buttons';
import { Clock, LockSimple, SealCheck, ShieldCheck, WarningCircle } from '../../../src/ui/icons';
import { Notice } from '../../../src/ui/Notice';
import { Screen } from '../../../src/ui/Screen';

const NAME = humanText(LIMITS.displayNameMaxChars);
type Outcome = Exclude<VerifyOutcome, { kind: 'error' }>;

type Phase =
  | { step: 'resuming' }
  | { step: 'gate' }
  | { step: 'starting' }
  /** redirectUrl is null after a resume (the provider link is not kept). */
  | { step: 'waiting'; verificationId: string; redirectUrl: string | null; checking: boolean }
  | { step: 'result'; outcome: Outcome; verificationId: string | null; redirectUrl: string | null };

/**
 * DigiLocker verification (FR-VER-01, 07; docs/06 §8.8; designs M17 gate, M18 result states). The
 * gate explains what is kept; "Verify" records consent to the identity verification notice and
 * opens DigiLocker in an in-app browser tab. The app then asks for the result every 2 s, again
 * whenever it comes back to the front (Android cannot tell when the tab closes), and picks up the
 * newest attempt when the screen opens again (Android may close the app meanwhile).
 */
export default function VerifyScreen() {
  const { t, locale } = useT();
  const { me, etag, refresh, set } = useMe();
  const [phase, setPhase] = useState<Phase>({ step: 'resuming' });
  const [error, setError] = useState<MessageKey | null>(null);
  const [name, setName] = useState(me?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const live = useRef(true);
  const pollRun = useRef(0); // the newest wait; older ones stop
  const starting = useRef(false); // set synchronously: a double tap starts once
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const showResult = useCallback(
    (outcome: Outcome, verificationId: string | null, redirectUrl: string | null) => {
      // Verified: the badge, the age and the completion change; refresh the profile everywhere.
      if (outcome.kind === 'verified') void refresh({ quiet: true });
      setPhase({ step: 'result', outcome, verificationId, redirectUrl });
    },
    [refresh],
  );

  const wait = useCallback(
    async (verificationId: string, redirectUrl: string | null) => {
      const run = ++pollRun.current;
      setError(null);
      setPhase({ step: 'waiting', verificationId, redirectUrl, checking: true });
      const outcome = await pollVerification(
        async () => {
          const res = await api(`/verifications/${verificationId}`, { locale });
          const parsed = Verification.safeParse(res.body);
          if (res.status !== 200 || !parsed.success) throw new Error('status');
          return parsed.data;
        },
        { stopped: () => !live.current || run !== pollRun.current },
      );
      if (!outcome || run !== pollRun.current || !live.current) return;
      if (outcome.kind === 'error') {
        setError('verification.errors.status');
        setPhase({ step: 'waiting', verificationId, redirectUrl, checking: false });
        return;
      }
      showResult(outcome, verificationId, redirectUrl);
    },
    [locale, showResult],
  );

  // Opened again: pick up the newest attempt instead of starting over.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (me?.isIdentityVerified) return showResult({ kind: 'verified' }, null, null);
      try {
        const res = await api('/verifications', { locale });
        const parsed = VerificationList.safeParse(res.body);
        const resume = parsed.success ? resumeFrom(parsed.data.verifications, Date.now()) : null;
        if (cancelled) return;
        if (resume && 'wait' in resume) return void wait(resume.wait, null);
        if (resume) return showResult(resume.outcome, resume.id, null);
      } catch {
        // Offline: the gate, which says so when the user starts.
      }
      if (!cancelled) setPhase({ step: 'gate' });
    })();
    return () => {
      cancelled = true;
    };
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from DigiLocker: ask again at once (also after a wait ran out: the user may finish late).
  const pendingId =
    phase.step === 'waiting' ||
    (phase.step === 'result' && phase.outcome.kind === 'timeout' && phase.verificationId)
      ? phase.verificationId
      : null;
  const pendingUrl = phase.step === 'waiting' || phase.step === 'result' ? phase.redirectUrl : null;
  useEffect(() => {
    if (!pendingId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void wait(pendingId, pendingUrl);
    });
    return () => sub.remove();
  }, [pendingId, pendingUrl, wait]);

  // Screen readers hear each new state (live regions do not announce new screens reliably).
  const announcement =
    phase.step === 'waiting'
      ? t('verification.checking.title')
      : phase.step === 'result'
        ? t(outcomeCopy(phase.outcome).title)
        : null;
  useEffect(() => {
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setError(null);
    setPhase({ step: 'starting' });
    try {
      // The identity verification notice the user agrees to by starting (docs/05 §8.4).
      const config = await api('/config', { locale });
      const parsed = PublicConfig.safeParse(config.body);
      const version = parsed.success ? parsed.data.legalVersions.identity_verification : undefined;
      if (!version) {
        setError('verification.errors.notOpen');
        return setPhase({ step: 'gate' });
      }
      const res = await api('/verifications/digilocker', {
        method: 'POST',
        body: { consentVersion: version },
        locale,
      });
      const started = StartDigiLockerResponse.safeParse(res.body);
      if (res.status !== 201 || !started.success) {
        // 409 also means "already verified" (verified elsewhere, or while this screen was away).
        if (res.status === 409) {
          void refresh({ quiet: true });
          return await reopen();
        }
        setError(startErrorKey(res.status, problemCode(res.body)));
        return setPhase({ step: 'gate' });
      }
      const { verificationId, redirectUrl } = started.data;
      // In the recent apps list too: users switch to Messages for DigiLocker's OTP and back.
      await WebBrowser.openBrowserAsync(redirectUrl, { showInRecents: true }).catch(
        () => undefined,
      );
      if (live.current) void wait(verificationId, redirectUrl);
    } catch (err) {
      setError(startErrorKey(err instanceof NetworkError ? 'network' : 500));
      setPhase({ step: 'gate' });
    } finally {
      starting.current = false;
    }
  };

  /** A start refused as a conflict: verified meanwhile, or another start is under way. */
  const reopen = async () => {
    const res = await api('/me', { locale }).catch(() => null);
    const verified = !!(res?.body as { isIdentityVerified?: boolean } | null)?.isIdentityVerified;
    if (verified) return showResult({ kind: 'verified' }, null, null);
    setError('verification.errors.inProgress');
    setPhase({ step: 'gate' });
  };

  const trimmed = name.trim();
  const nameUsable =
    NAME.safeParse(name).success && hasLatinLetter(name) && trimmed !== me?.displayName;

  /** Name mismatch: fix the display name (FR-VER-03), then verify again. */
  const updateAndRetry = async () => {
    if (!nameUsable || savingName) return;
    setError(null);
    setSavingName(true);
    const saved = await saveMe(
      '/me',
      'PATCH',
      { displayName: trimmed },
      etag ? { ifMatch: etag } : {},
    );
    setSavingName(false);
    if (!saved.ok) {
      if (saved.status === 412) void refresh({ quiet: true }); // changed elsewhere: reload it
      return setError(saved.error);
    }
    set(saved.me, saved.etag);
    await start();
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const consentLine = (
    <Text style={[textStyle('caption', locale), styles.muted, styles.center]}>
      {t('verification.gate.consent')}
    </Text>
  );

  if (phase.step === 'result') {
    const copy = outcomeCopy(phase.outcome);
    const verified = phase.outcome.kind === 'verified';
    const startsAgain =
      copy.action === 'retry' || copy.action === 'edit_name' || copy.action === 'check';
    return (
      <Screen
        footer={
          <>
            {error ? <Notice tone="error" locale={locale} message={t(error)} /> : null}
            {/* A new start records the consent again: show what it says. */}
            {copy.action === 'edit_name' && !nameUsable ? (
              // Why the button is off, where the user sees it (the field may be under the footer).
              <Notice
                tone="info"
                locale={locale}
                message={t(
                  trimmed && !hasLatinLetter(name)
                    ? 'verification.failed.nameMismatch.latinOnly'
                    : 'verification.failed.nameMismatch.unchanged',
                )}
              />
            ) : null}
            {startsAgain ? consentLine : null}
            {copy.action === 'done' ? (
              <PrimaryButton
                testID="verify-done"
                locale={locale}
                label={t('verification.done')}
                onPress={close}
              />
            ) : copy.action === 'edit_name' ? (
              <PrimaryButton
                testID="verify-update-name"
                locale={locale}
                label={t('verification.failed.nameMismatch.retry')}
                busy={savingName}
                disabled={!nameUsable}
                onPress={() => void updateAndRetry()}
              />
            ) : copy.action === 'retry' ? (
              <PrimaryButton
                testID="verify-retry"
                locale={locale}
                label={t('verification.tryAgain')}
                onPress={() => void start()}
              />
            ) : copy.action === 'check' ? (
              <>
                {phase.verificationId ? (
                  <PrimaryButton
                    testID="verify-check"
                    locale={locale}
                    label={t('verification.timeout.check')}
                    onPress={() => void wait(phase.verificationId!, phase.redirectUrl)}
                  />
                ) : null}
                <SecondaryButton
                  testID="verify-restart"
                  locale={locale}
                  label={t('verification.timeout.restart')}
                  trailingArrow={false}
                  onPress={() => void start()}
                />
              </>
            ) : null}
            {!verified ? (
              <SecondaryButton
                locale={locale}
                label={t(
                  copy.action === 'none' ? 'verification.close' : 'verification.gate.notNow',
                )}
                trailingArrow={false}
                onPress={close}
              />
            ) : null}
          </>
        }
      >
        <BackButton label={t('common.back')} onPress={close} />
        <View style={styles.result}>
          <View style={[styles.badge, verified ? styles.badgeOk : styles.badgeWarn]}>
            {verified ? (
              <SealCheck size={40} color={theme.semantic.status.verified.fg} weight="fill" />
            ) : (
              <WarningCircle size={40} color={theme.semantic.status.pending.fg} weight="fill" />
            )}
          </View>
          <Text style={[textStyle('display', locale), styles.center]} accessibilityRole="header">
            {t(copy.title)}
          </Text>
          <Text style={[textStyle('bodyLg', locale), styles.muted, styles.center]}>
            {t(copy.body)}
          </Text>
          {verified && me?.age ? (
            <Text style={[textStyle('label', locale), styles.muted]}>
              {t('profile.nameAge', { name: me.displayName, age: me.age })}
            </Text>
          ) : null}
        </View>
        {copy.action === 'edit_name' ? (
          <View style={styles.card}>
            <Text style={[textStyle('label', locale), { color: theme.color.text.primary }]}>
              {t('verification.failed.nameMismatch.label')}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              accessibilityLabel={t('verification.failed.nameMismatch.label')}
              testID="verify-name"
              autoComplete="given-name"
              autoCapitalize="words"
              maxLength={LIMITS.displayNameMaxChars}
              style={[textStyle('bodyLg', locale), styles.input]}
            />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (phase.step === 'waiting') {
    return (
      <Screen
        footer={
          <>
            {error ? <Notice tone="error" locale={locale} message={t(error)} /> : null}
            <PrimaryButton
              testID="verify-check"
              locale={locale}
              label={t('verification.timeout.check')}
              busy={phase.checking}
              onPress={() => void wait(phase.verificationId, phase.redirectUrl)}
            />
            {!phase.redirectUrl ? (
              <SecondaryButton
                testID="verify-restart"
                locale={locale}
                label={t('verification.timeout.restart')}
                trailingArrow={false}
                onPress={() => void start()}
              />
            ) : null}
            {phase.redirectUrl ? (
              <SecondaryButton
                locale={locale}
                label={t('verification.waiting.open')}
                trailingArrow={false}
                onPress={() =>
                  void WebBrowser.openBrowserAsync(phase.redirectUrl!, {
                    showInRecents: true,
                  }).catch(() => undefined)
                }
              />
            ) : null}
          </>
        }
      >
        <BackButton label={t('common.back')} onPress={close} />
        <View style={styles.result}>
          <ActivityIndicator
            size="large"
            color={theme.color.brand.primary}
            accessibilityLabel={t('verification.checking.title')}
          />
          <Text
            style={[textStyle('display', locale), styles.center]}
            accessibilityRole="header"
            testID="verify-checking"
          >
            {t('verification.checking.title')}
          </Text>
          <Text style={[textStyle('bodyLg', locale), styles.muted, styles.center]}>
            {t('verification.waiting.body')}
          </Text>
          <Text style={[textStyle('body', locale), styles.muted, styles.center]}>
            {t('verification.checking.body')}
          </Text>
        </View>
      </Screen>
    );
  }

  if (phase.step === 'resuming')
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

  const rows = [
    { Icon: Clock, title: 'verification.gate.minute', sub: 'verification.gate.minuteSub' },
    { Icon: LockSimple, title: 'verification.gate.privacy', sub: 'verification.gate.privacySub' },
    { Icon: ShieldCheck, title: 'verification.gate.badge', sub: 'verification.gate.badgeSub' },
  ] as const;
  return (
    <Screen
      footer={
        <>
          {error ? <Notice tone="error" locale={locale} message={t(error)} /> : null}
          {consentLine}
          <PrimaryButton
            testID="verify-start"
            locale={locale}
            label={t('verification.gate.start')}
            icon={<ShieldCheck size={22} color={theme.semantic.action.primary.fg} weight="fill" />}
            busy={phase.step === 'starting'}
            onPress={() => void start()}
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
      <BackButton label={t('common.back')} onPress={close} />
      <View style={styles.titles}>
        <Text style={[textStyle('label', locale), styles.overline]}>
          {t('verification.gate.overline')}
        </Text>
        <Text style={textStyle('display', locale)} accessibilityRole="header">
          {t('verification.gate.title')}
        </Text>
        <Text style={[textStyle('bodyLg', locale), styles.muted]}>
          {t('verification.gate.body')}
        </Text>
      </View>
      <View style={styles.card}>
        {rows.map(({ Icon, title, sub }) => (
          <View key={title} style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon size={22} color={theme.color.brand.primary} />
            </View>
            <View style={{ flex: 1, gap: theme.space['1'] }}>
              <Text style={[textStyle('label', locale), { color: theme.color.text.primary }]}>
                {t(title)}
              </Text>
              <Text style={[textStyle('body', locale), styles.muted]}>{t(sub)}</Text>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  overline: { color: theme.color.brand.primary, textTransform: 'uppercase' },
  muted: { color: theme.color.text.secondary },
  center: { textAlign: 'center' },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['4'],
    ...theme.elevation['1'],
  },
  row: { flexDirection: 'row', gap: theme.space['3'], alignItems: 'flex-start' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.brand.primarySubtle,
  },
  result: { alignItems: 'center', gap: theme.space['3'], paddingVertical: theme.space['8'] },
  badge: {
    width: 80,
    height: 80,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOk: { backgroundColor: theme.semantic.status.verified.bg },
  badgeWarn: { backgroundColor: theme.semantic.status.pending.bg },
  input: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    paddingHorizontal: theme.space['3'],
    backgroundColor: theme.color.bg.app,
    color: theme.color.text.primary,
  },
});
