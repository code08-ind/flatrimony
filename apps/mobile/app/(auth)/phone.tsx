import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ShieldCheck, X } from '../../src/ui/icons';
import { authConfigured, config, legalUrl } from '../../src/config';
import { fetchWithTimeout } from '../../src/net';
import { getDeviceId } from '../../src/device';
import { requestOtp, type RequestOtpResult } from '../../src/auth/otp-flow';
import {
  applyKey,
  formatNational,
  hasValidStart,
  isValidMobile,
  toE164,
} from '../../src/auth/phone';
import { requestErrorKey } from '../../src/auth/messages';
import { codeStillFresh, getPendingSignIn, setPendingSignIn } from '../../src/auth/pending';
import { supabase } from '../../src/supabase';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { BackButton, PrimaryButton } from '../../src/ui/buttons';
import { Keypad } from '../../src/ui/Keypad';
import { LegalConsent } from '../../src/ui/LegalConsent';
import { Notice } from '../../src/ui/Notice';
import { Screen } from '../../src/ui/Screen';

/** M02 Phone number (FR-AUTH-01, FR-AUTH-02; docs/06 §8.2). */
export default function PhoneScreen() {
  const { t, raw, locale } = useT();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // set synchronously: two taps in one frame send one request
  const [error, setError] = useState<
    RequestOtpResult | { ok: false; reason: 'not_configured' } | null
  >(null);
  // After a rate limit, Send stays off (and the message stays up) until the wait is over.
  const [blockedUntil, setBlockedUntil] = useState(0);
  const blocked = blockedUntil > 0;
  useEffect(() => {
    if (!blocked) return;
    const timer = setTimeout(() => {
      setBlockedUntil(0);
      setError(null);
    }, blockedUntil - Date.now());
    return () => clearTimeout(timer);
  }, [blocked, blockedUntil]);

  const valid = isValidMobile(digits);
  const showInvalid = !hasValidStart(digits);

  const send = async () => {
    if (!valid || inFlight.current || blocked) return;
    if (!authConfigured || !supabase) return setError({ ok: false, reason: 'not_configured' });
    const phone = toE164(digits);
    // Back from the OTP screen ("Wrong number?") with the same number while its code is still
    // fresh: reuse it. Asking again would only spend the user's otp-guard allowance and hit
    // Auth's 30 s resend interval.
    if (codeStillFresh(getPendingSignIn(), phone, Date.now())) {
      router.push('/otp');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await requestOtp(
        {
          auth: supabase.auth,
          fetch: (url, init) => fetchWithTimeout(url, init),
          apiUrl: config.apiUrl,
          deviceId: await getDeviceId(),
          appVersion: config.appVersion,
          platform: Platform.OS === 'web' ? 'web' : 'android',
        },
        phone,
      );
      if (result.ok) {
        setPendingSignIn({ phone, sentAt: Date.now() });
        router.push('/otp');
        return;
      }
      if (result.reason === 'rate_limited')
        setBlockedUntil(Date.now() + result.retryAfterSeconds * 1000);
      setError(result);
    } catch {
      setError({ ok: false, reason: 'unavailable' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const errorMessage = error && !error.ok ? messageFor(error) : null;
  function messageFor(e: Exclude<typeof error, null>): string {
    if (e.ok) return '';
    if (e.reason === 'not_configured') return t('auth.errors.notConfigured');
    if (e.reason === 'rate_limited')
      return t('auth.errors.rateLimited', { minutes: Math.ceil(e.retryAfterSeconds / 60) });
    return t(requestErrorKey(e.reason));
  }

  return (
    <Screen
      footer={
        <>
          {/* A message takes the place of the DigiLocker note, so the layout barely moves. */}
          {showInvalid || errorMessage ? (
            <Notice
              tone="error"
              locale={locale}
              message={showInvalid ? t('auth.phone.startDigit') : errorMessage!}
            />
          ) : (
            <View style={styles.note}>
              <ShieldCheck size={20} color={theme.color.brand.primary} />
              <Text
                style={[
                  textStyle('body', locale),
                  { color: theme.color.text.secondary, flexShrink: 1 },
                ]}
              >
                {t('auth.phone.digilockerNote')}
              </Text>
            </View>
          )}
          <PrimaryButton
            testID="send-code"
            locale={locale}
            label={t('auth.phone.sendCode')}
            onPress={() => void send()}
            disabled={!valid || blocked}
            busy={busy}
          />
          {/* Right under Send: the agreement is visible when the user taps it. */}
          <LegalConsent
            text={raw('legal.consent')}
            locale={locale}
            termsUrl={legalUrl('terms', locale)}
            privacyUrl={legalUrl('privacy', locale)}
          />
          <Keypad
            deleteLabel={t('common.delete')}
            onKey={(key) => {
              if (!blocked) setError(null);
              setDigits((d) => applyKey(d, key));
            }}
            leftSlot={
              // The "secured keypad" mark (docs/designs M02), named for screen readers.
              <View accessible accessibilityLabel={t('auth.phone.securedKeypad')}>
                <ShieldCheck size={24} color={theme.color.text.disabled} />
              </View>
            }
          />
        </>
      }
    >
      <BackButton
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      />

      <View style={styles.titles}>
        <Text style={textStyle('display', locale)} accessibilityRole="header">
          {t('auth.phone.title')}
        </Text>
        <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
          {t('auth.phone.subtitle')}
        </Text>
      </View>

      <View
        style={styles.field}
        accessible
        accessibilityLabel={`${t('auth.phone.label')}: +91 ${formatNational(digits)}`}
      >
        <Text style={styles.flag} importantForAccessibility="no">
          🇮🇳
        </Text>
        <Text style={styles.prefix}>+91</Text>
        <View style={styles.divider} />
        <Text
          style={[styles.number, !digits && styles.placeholder]}
          numberOfLines={1}
          testID="phone-value"
        >
          {digits ? formatNational(digits) : '98123 45678'}
        </Text>
        {digits.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.phone.clear')}
            onPress={() => setDigits('')}
            style={styles.clear}
            hitSlop={8}
          >
            <X size={20} color={theme.color.brand.primary} />
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space['4'],
    minHeight: 72,
    gap: theme.space['2'],
    ...theme.elevation['1'],
  },
  flag: { fontSize: 22 },
  prefix: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 20,
    color: theme.color.text.primary,
  },
  divider: { width: 1, height: 28, backgroundColor: theme.color.border.default },
  number: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 21,
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'], // docs/06 §3.2: figures in numbers are tabular
    color: theme.color.text.primary,
  },
  placeholder: { color: theme.color.text.disabled, fontFamily: 'PlusJakartaSans_500Medium' },
  clear: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    backgroundColor: theme.color.brand.primarySubtle,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space['4'],
    paddingVertical: theme.space['3'],
  },
});
