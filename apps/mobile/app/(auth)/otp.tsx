import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowsClockwise, ChatCircleDots } from '../../src/ui/icons';
import { config } from '../../src/config';
import { fetchWithTimeout } from '../../src/net';
import { getDeviceId } from '../../src/device';
import { formatCountdown, secondsLeft } from '../../src/auth/countdown';
import { requestErrorKey, verifyErrorKey } from '../../src/auth/messages';
import { clearsCode, requestOtp, verifyOtp } from '../../src/auth/otp-flow';
import { applyKey, displayE164 } from '../../src/auth/phone';
import { getPendingSignIn, setPendingSignIn } from '../../src/auth/pending';
import { supabase } from '../../src/supabase';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { BackButton, PrimaryButton } from '../../src/ui/buttons';
import { Keypad } from '../../src/ui/Keypad';
import { Notice } from '../../src/ui/Notice';
import { OtpBoxes } from '../../src/ui/OtpBoxes';
import { Screen } from '../../src/ui/Screen';

/**
 * M03 OTP verification (FR-AUTH-01; docs/06 §8.2: 6 boxes, 30 s resend). SMS Retriever auto-read
 * is Blocked (docs/07 T2.4): it needs the DLT template with the app hash and a native build. Until
 * then, tapping the boxes opens the system keyboard, whose code suggestion can fill them.
 */
export default function OtpScreen() {
  const { t, locale } = useT();
  const [pending] = useState(getPendingSignIn);
  const phone = pending?.phone ?? null;

  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState(() => pending?.sentAt ?? Date.now());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  /** `retry`: the code is kept and "Verify" may send it again (network or server failure). */
  const [message, setMessage] = useState<{
    tone: 'error' | 'info';
    text: string;
    retry?: boolean;
  } | null>(null);
  const submitted = useRef('');
  const inFlight = useRef(false); // set synchronously: one verify/resend at a time
  // After a wrong code the boxes keep it (red) until the next key press starts a fresh code.
  const startFresh = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Opened without a pending sign-in (deep link, reload, restart): back to the phone screen.
  useEffect(() => {
    if (!phone) router.replace('/phone');
  }, [phone]);

  const verify = async (value: string) => {
    if (!phone || !supabase || inFlight.current || value.length !== 6) return;
    if (submitted.current === value) return;
    inFlight.current = true;
    submitted.current = value;
    setBusy(true);
    setMessage(null);
    try {
      const result = await verifyOtp({ auth: supabase.auth }, phone, value);
      if (result.ok) {
        setPendingSignIn(null);
        return; // the session change routes the user onward (app/(auth)/_layout.tsx)
      }
      const retry = !clearsCode(result.reason);
      setMessage({ tone: 'error', text: t(verifyErrorKey(result.reason)), retry });
      if (result.reason === 'too_many_attempts') setCode('');
      else if (clearsCode(result.reason)) startFresh.current = true;
      // A network or server failure keeps the code: "Verify" retries it.
    } finally {
      submitted.current = '';
      inFlight.current = false;
      setBusy(false);
    }
  };

  // Functional updates: fast key presses (or an OS autofill) never act on a stale code.
  const press = (key: string) => {
    const fresh = startFresh.current;
    startFresh.current = false;
    setMessage((m) => (m?.tone === 'error' ? null : m));
    setCode((c) => applyKey(fresh ? '' : c, key).slice(0, 6));
  };
  const autofill = (value: string) => {
    startFresh.current = false;
    setMessage((m) => (m?.tone === 'error' ? null : m));
    setCode(value.replace(/\D/g, '').slice(0, 6));
  };
  useEffect(() => {
    if (code.length === 6) void verify(code);
    // verify reads current state each render; it only needs to run when the code changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const left = secondsLeft(sentAt, now);
  const resend = async () => {
    if (!phone || !supabase || left > 0 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
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
        const at = Date.now();
        setPendingSignIn({ phone, sentAt: at });
        setSentAt(at);
        setCode('');
        startFresh.current = false;
        setMessage({ tone: 'info', text: t('auth.otp.resent') });
      } else if (result.reason === 'rate_limited') {
        setMessage({
          tone: 'error',
          text: t('auth.errors.rateLimited', {
            minutes: Math.ceil(result.retryAfterSeconds / 60),
          }),
        });
      } else {
        setMessage({ tone: 'error', text: t(requestErrorKey(result.reason)) });
      }
    } catch {
      setMessage({ tone: 'error', text: t('auth.errors.unavailable') });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!phone) return null;

  return (
    <Screen
      footer={
        <>
          <Keypad
            deleteLabel={t('common.delete')}
            onKey={press}
            disabled={busy}
            leftSlot={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('auth.otp.resend')}
                accessibilityState={{ disabled: left > 0 || busy }}
                disabled={left > 0 || busy}
                onPress={() => void resend()}
                style={styles.resendKey}
              >
                <ArrowsClockwise
                  size={24}
                  color={left > 0 ? theme.color.text.disabled : theme.color.brand.primary}
                />
              </Pressable>
            }
          />
          <PrimaryButton
            testID="verify"
            locale={locale}
            label={t('auth.otp.verify')}
            onPress={() => void verify(code)}
            disabled={code.length !== 6 || (message?.tone === 'error' && !message.retry)}
            busy={busy}
          />
        </>
      }
    >
      <BackButton label={t('common.back')} onPress={() => router.back()} />

      <View style={styles.titles}>
        <View style={styles.overlineRow}>
          <ChatCircleDots size={20} color={theme.color.brand.primary} weight="fill" />
          <Text style={[textStyle('label', locale), styles.overline]}>
            {t('auth.otp.overline')}
          </Text>
        </View>
        <Text style={textStyle('display', locale)} accessibilityRole="header">
          {t('auth.otp.title')}
        </Text>
        <View style={styles.sentRow}>
          <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
            {t('auth.otp.sentTo', { phone: displayE164(phone) })}
          </Text>
          <Pressable accessibilityRole="link" onPress={() => router.back()} style={styles.target}>
            <Text style={[textStyle('body', locale), styles.link]}>
              {t('auth.otp.wrongNumber')}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <OtpBoxes
          value={code}
          onChange={autofill}
          label={t('auth.otp.codeLabel')}
          invalid={message?.tone === 'error' && !message.retry}
        />
        {message && <Notice tone={message.tone} locale={locale} message={message.text} />}
        <View style={styles.statusRow}>
          {left > 0 ? (
            <Text
              style={[textStyle('caption', locale), { color: theme.color.text.secondary }]}
              accessibilityLiveRegion="none"
            >
              {t('auth.otp.resendIn', { time: formatCountdown(left) })}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              onPress={() => void resend()}
              disabled={busy}
              style={styles.target}
            >
              <Text style={[textStyle('label', locale), styles.link]}>{t('auth.otp.resend')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  overlineRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] },
  overline: { color: theme.color.brand.primary, textTransform: 'uppercase' },
  link: {
    color: theme.color.brand.primary,
    textDecorationLine: 'underline',
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['4'],
    ...theme.elevation['1'],
  },
  sentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: theme.space['3'],
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  /** Text links get a 48 dp tall target (docs/06 §6). */
  target: { minHeight: 48, justifyContent: 'center' },
  resendKey: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
