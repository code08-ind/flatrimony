import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  canStopRecording,
  recordingClock,
  STOP_AFTER_SECONDS,
  submitWalkthrough,
  takeIsUsable,
  walkthroughUploadsAvailable,
  type WalkthroughTake,
} from '@flatrimony/client';
import type { Locale, MessageKey } from '@flatrimony/i18n';
import { VIDEO_MAX_BYTES, WALKTHROUGH } from '@flatrimony/shared';
import { config } from '../../../src/config';
import { confirmAction } from '../../../src/ui/confirm';
import { discardTake, readTake, walkthroughDeps } from '../../../src/listing/walkthrough-device';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { BackButton, PrimaryButton, SecondaryButton } from '../../../src/ui/buttons';
import {
  ArrowsClockwise,
  Clock,
  House,
  SealCheck,
  SpeakerSlash,
  Stop,
  VideoCamera,
  X,
} from '../../../src/ui/icons';
import { Notice } from '../../../src/ui/Notice';
import { Screen } from '../../../src/ui/Screen';

type Phase =
  | { step: 'intro' }
  | { step: 'camera'; recording: boolean; startedAt: number | null }
  | { step: 'reading' }
  | { step: 'preview'; take: WalkthroughTake }
  | { step: 'sending'; take: WalkthroughTake }
  | { step: 'done' };

type Problem = { key: MessageKey; next: 'retry' | 'record' | 'stop' };

/**
 * The camera stops itself below the API's 25 MB: Android's size cap is approximate and the MP4
 * index is written after it is reached.
 */
const RECORD_MAX_BYTES = VIDEO_MAX_BYTES - 1024 * 1024;

/** On the dark camera view: white text, and a see-through version of the dark background. */
const ON_DARK = theme.semantic.action.primary.fg;
const SCRIM = `${theme.color.bg.immersive}B3`;

/**
 * The listing walkthrough recorder (T3.7; FR-LST-05; docs/06 listing stepper "Video walkthrough"):
 * guidance, then the back camera records 30–90 s of 720p without sound (the camera stops itself at
 * 90 s), a preview to keep or retake, then the upload: presigned PUT to R2, the file's SHA-256 and
 * a Play Integrity token bound to this upload, and the API's confirm. Gallery videos are never
 * offered. On the web the screen says to record on the Android phone instead.
 */
export default function WalkthroughScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useT();
  const [phase, setPhase] = useState<Phase>({ step: 'intro' });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const live = useRef(true);
  const takeUri = useRef<string | null>(null);
  const recording = useRef(false); // set synchronously: a double tap records once
  const sending = useRef(false);
  const closed = useRef(false); // the camera was closed while recording: drop that take
  const available = walkthroughUploadsAvailable(config.appEnv, config.playIntegrityCloudProject);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // A take that was not uploaded is not kept on the phone (one being uploaded is left alone).
      if (takeUri.current && !sending.current) discardTake(takeUri.current);
    };
  }, []);

  // Back from Settings with the camera allowed: the screen notices.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  // The clock while recording, and one announcement when Stop starts to work.
  useEffect(() => {
    if (phase.step !== 'camera' || !phase.startedAt) return;
    const started = phase.startedAt;
    let announced = false;
    const tick = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setElapsed(s);
      if (!announced && canStopRecording(s)) {
        announced = true;
        AccessibilityInfo.announceForAccessibility(t('listing.video.stopNow'));
      }
    }, 250);
    return () => clearInterval(tick);
  }, [phase, t]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/my-flat');
  }, []);

  const openCamera = useCallback(async () => {
    setProblem(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted || !live.current) return;
    closed.current = false;
    setReady(false);
    setElapsed(0);
    setPhase({ step: 'camera', recording: false, startedAt: null });
  }, [permission, requestPermission]);

  /** Leaves the camera: a recording in progress is stopped and its file discarded. */
  const closeCamera = useCallback(() => {
    closed.current = true;
    if (recording.current) camera.current?.stopRecording();
    setPhase({ step: 'intro' });
  }, []);

  // Hardware back on the camera returns to the guidance instead of leaving mid-recording.
  useEffect(() => {
    if (phase.step !== 'camera') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeCamera();
      return true;
    });
    // Leaving the app stops Android's recorder: say so instead of showing a cut-off take.
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && recording.current) {
        closeCamera();
        setProblem({ key: 'listing.video.errors.interrupted', next: 'record' });
      }
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, [phase.step, closeCamera]);

  /** Back from the preview asks before the take is thrown away. */
  const discard = useCallback(async () => {
    const ok = await confirmAction({
      title: t('listing.video.discard.title'),
      message: t('listing.video.discard.body'),
      confirmLabel: t('listing.video.discard.confirm'),
      cancelLabel: t('listing.video.discard.cancel'),
    });
    if (!ok || !live.current) return;
    if (takeUri.current) discardTake(takeUri.current);
    takeUri.current = null;
    setPhase({ step: 'intro' });
  }, [t]);

  // Hardware back on the preview asks first; during the upload it waits (the result matters).
  useEffect(() => {
    if (phase.step !== 'preview' && phase.step !== 'sending') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase.step === 'preview') void discard();
      return true;
    });
    return () => sub.remove();
  }, [phase.step, discard]);

  const record = useCallback(async () => {
    if (!camera.current || !ready || recording.current) return;
    recording.current = true;
    const startedAt = Date.now();
    setPhase({ step: 'camera', recording: true, startedAt });
    AccessibilityInfo.announceForAccessibility(t('listing.video.recording'));
    let result: { uri: string } | undefined;
    try {
      result = await camera.current.recordAsync({
        maxDuration: WALKTHROUGH.maxSeconds,
        maxFileSize: RECORD_MAX_BYTES,
      });
    } catch {
      result = undefined;
    } finally {
      recording.current = false;
    }
    // Left the screen or closed the camera while recording: the file is not kept.
    if (!live.current || closed.current) {
      if (result?.uri) discardTake(result.uri);
      return;
    }
    if (!result?.uri) {
      setProblem({ key: 'listing.video.errors.camera', next: 'record' });
      setPhase({ step: 'intro' });
      return;
    }
    if (takeUri.current && takeUri.current !== result.uri) discardTake(takeUri.current);
    takeUri.current = result.uri;
    setPhase((p) => (p.step === 'camera' ? { step: 'reading' } : p));
    const take = await readTake(result.uri, startedAt);
    if (!live.current) return;
    if (!take) {
      setProblem({ key: 'listing.video.errors.camera', next: 'record' });
      setPhase({ step: 'intro' });
      return;
    }
    setPhase((p) => (p.step === 'reading' ? { step: 'preview', take } : p));
  }, [ready, t]);

  const stop = useCallback(() => {
    if (canStopRecording(elapsed)) camera.current?.stopRecording();
  }, [elapsed]);

  const send = useCallback(
    async (take: WalkthroughTake) => {
      if (!id || sending.current) return;
      sending.current = true;
      setProblem(null);
      setProgress(0);
      setPhase({ step: 'sending', take });
      const result = await submitWalkthrough(id, take, walkthroughDeps, {
        onProgress: (fraction) => {
          if (live.current) setProgress(fraction);
        },
      });
      sending.current = false;
      if (!live.current) {
        discardTake(take.uri);
        return;
      }
      if (result.ok) {
        discardTake(take.uri);
        takeUri.current = null;
        setPhase({ step: 'done' });
        AccessibilityInfo.announceForAccessibility(t('listing.video.done.title'));
        return;
      }
      setProblem({ key: result.error, next: result.next });
      setPhase(result.next === 'retry' ? { step: 'preview', take } : { step: 'intro' });
    },
    [id, t],
  );

  // ------------------------------------------------------------------ web: record on Android
  if (Platform.OS === 'web')
    return (
      <Screen>
        <BackButton onPress={leave} label={t('common.back')} />
        <View style={styles.titles}>
          <Text style={[textStyle('label', locale), styles.overline]}>
            {t('listing.video.overline')}
          </Text>
          <Text accessibilityRole="header" style={textStyle('display', locale)}>
            {t('listing.video.web.title')}
          </Text>
          <Text style={[textStyle('bodyLg', locale), styles.muted]}>
            {t('listing.video.web.body')}
          </Text>
        </View>
      </Screen>
    );

  // ------------------------------------------------------------------ camera
  if (phase.step === 'camera' || phase.step === 'reading') {
    const recordingNow = phase.step === 'camera' && phase.recording;
    const canStop = canStopRecording(elapsed);
    return (
      <View style={styles.cameraRoot}>
        {phase.step === 'camera' ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="video"
            mute
            videoQuality="720p"
            videoBitrate={WALKTHROUGH.videoBitrate}
            onCameraReady={() => setReady(true)}
            onMountError={() => {
              setProblem({ key: 'listing.video.errors.camera', next: 'record' });
              setPhase({ step: 'intro' });
            }}
          />
        ) : null}
        <SafeAreaView style={styles.cameraOverlay} edges={['top', 'bottom']}>
          <View style={styles.cameraTop}>
            <Pressable
              testID="walkthrough-close"
              accessibilityRole="button"
              accessibilityLabel={t('listing.video.close')}
              onPress={closeCamera}
              hitSlop={8}
              style={styles.close}
            >
              <X size={24} color={ON_DARK} />
            </Pressable>
            <View style={styles.pill}>
              {recordingNow ? <View style={styles.dot} /> : null}
              <Text style={[textStyle('label', locale), styles.onDark]}>
                {recordingNow
                  ? `${recordingClock(elapsed)} / ${recordingClock(WALKTHROUGH.maxSeconds)}`
                  : t('listing.video.show')}
              </Text>
            </View>
          </View>
          <View style={styles.cameraBottom}>
            {phase.step === 'reading' ? (
              <ActivityIndicator color={ON_DARK} />
            ) : recordingNow ? (
              <>
                <View style={styles.pill}>
                  <Text style={[textStyle('body', locale), styles.onDark]}>
                    {canStop
                      ? t('listing.video.show')
                      : t('listing.video.stopIn', {
                          seconds: Math.ceil(STOP_AFTER_SECONDS - elapsed),
                        })}
                  </Text>
                </View>
                <Pressable
                  testID="walkthrough-stop"
                  accessibilityRole="button"
                  accessibilityLabel={t('listing.video.stop')}
                  accessibilityHint={
                    canStop
                      ? undefined
                      : t('listing.video.stopIn', {
                          seconds: Math.ceil(STOP_AFTER_SECONDS - elapsed),
                        })
                  }
                  accessibilityState={{ disabled: !canStop }}
                  disabled={!canStop}
                  onPress={stop}
                  style={[styles.shutter, !canStop && styles.shutterDisabled]}
                >
                  <Stop size={32} color={ON_DARK} weight="fill" />
                </Pressable>
              </>
            ) : (
              <Pressable
                testID="walkthrough-record"
                accessibilityRole="button"
                accessibilityLabel={t('listing.video.start')}
                accessibilityState={{ disabled: !ready }}
                disabled={!ready}
                onPress={() => void record()}
                style={[styles.shutter, !ready && styles.shutterDisabled]}
              >
                <View style={styles.recordDot} />
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ------------------------------------------------------------------ preview, sending, done
  if (phase.step === 'preview' || phase.step === 'sending')
    return (
      <Preview
        take={phase.take}
        sending={phase.step === 'sending'}
        progress={progress}
        problem={problem ? t(problem.key) : null}
        onUse={() => void send(phase.take)}
        onRetake={() => void openCamera()}
        onBack={() => void discard()}
      />
    );

  if (phase.step === 'done')
    return (
      <Screen
        footer={
          <PrimaryButton
            label={t('listing.video.done.back')}
            onPress={leave}
            locale={locale}
            testID="walkthrough-done"
          />
        }
      >
        <View style={[styles.titles, styles.centered]}>
          <SealCheck size={56} color={theme.semantic.status.verified.fg} weight="fill" />
          <Text accessibilityRole="header" style={[textStyle('display', locale), styles.center]}>
            {t('listing.video.done.title')}
          </Text>
          <Text style={[textStyle('bodyLg', locale), styles.muted, styles.center]}>
            {t('listing.video.done.body')}
          </Text>
        </View>
      </Screen>
    );

  // ------------------------------------------------------------------ intro and permission
  const denied = !!permission && !permission.granted && !permission.canAskAgain;
  // Recording again on this phone will not pass the integrity check; this build cannot upload.
  const blocked = !available || problem?.next === 'stop';
  return (
    <Screen
      footer={
        blocked ? (
          <SecondaryButton
            label={t('listing.video.done.back')}
            onPress={leave}
            locale={locale}
            trailingArrow={false}
          />
        ) : denied ? (
          <PrimaryButton
            label={t('listing.video.permission.settings')}
            onPress={() => void Linking.openSettings()}
            locale={locale}
          />
        ) : (
          <PrimaryButton
            testID="walkthrough-open-camera"
            label={
              permission?.granted ? t('listing.video.start') : t('listing.video.permission.allow')
            }
            onPress={() => void openCamera()}
            locale={locale}
            icon={<VideoCamera size={22} color={ON_DARK} weight="fill" />}
          />
        )
      }
    >
      <BackButton onPress={leave} label={t('common.back')} />
      <View style={styles.titles}>
        <Text style={[textStyle('label', locale), styles.overline]}>
          {t('listing.video.overline')}
        </Text>
        <Text accessibilityRole="header" style={textStyle('display', locale)}>
          {t('listing.video.title')}
        </Text>
        <Text style={[textStyle('bodyLg', locale), styles.muted]}>{t('listing.video.body')}</Text>
      </View>
      <View style={styles.card}>
        <Guide
          locale={locale}
          icon={<House size={22} color={theme.color.brand.primary} />}
          text={t('listing.video.show')}
        />
        <Guide
          locale={locale}
          icon={<Clock size={22} color={theme.color.brand.primary} />}
          text={t('listing.video.length')}
        />
        <Guide
          locale={locale}
          icon={<SpeakerSlash size={22} color={theme.color.brand.primary} />}
          text={t('listing.video.noSound')}
        />
      </View>
      {!available ? (
        <Notice tone="info" locale={locale} message={t('listing.video.errors.notAvailable')} />
      ) : !permission?.granted ? (
        <Text style={[textStyle('body', locale), styles.muted]}>
          {denied ? t('listing.video.permission.denied') : t('listing.video.permission.body')}
        </Text>
      ) : null}
      {problem ? <Notice tone="error" locale={locale} message={t(problem.key)} /> : null}
    </Screen>
  );
}

function Guide({ icon, text, locale }: { icon: ReactNode; text: string; locale: Locale }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={[textStyle('body', locale), styles.rowText]}>{text}</Text>
    </View>
  );
}

/** The take, playing, with "Use this video" and "Record again". */
function Preview({
  take,
  sending,
  progress,
  problem,
  onUse,
  onRetake,
  onBack,
}: {
  take: WalkthroughTake;
  sending: boolean;
  progress: number;
  problem: string | null;
  onUse: () => void;
  onRetake: () => void;
  onBack: () => void;
}) {
  const { t, locale } = useT();
  const player = useVideoPlayer(take.uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const usable = takeIsUsable(take);
  return (
    <Screen
      footer={
        <View style={styles.footerButtons}>
          {usable ? (
            <PrimaryButton
              testID="walkthrough-use"
              label={t('listing.video.preview.use')}
              onPress={onUse}
              locale={locale}
              busy={sending}
            />
          ) : null}
          <SecondaryButton
            testID="walkthrough-retake"
            label={t('listing.video.preview.retake')}
            onPress={onRetake}
            locale={locale}
            disabled={sending}
            trailingArrow={false}
            icon={<ArrowsClockwise size={20} color={theme.color.brand.primary} />}
          />
        </View>
      }
    >
      {!sending ? <BackButton onPress={onBack} label={t('common.back')} /> : null}
      <View style={styles.titles}>
        <Text accessibilityRole="header" style={textStyle('display', locale)}>
          {t('listing.video.preview.title')}
        </Text>
        <Text style={[textStyle('body', locale), styles.muted]}>
          {t('listing.video.preview.seconds', { seconds: Math.round(take.durationS) })}
        </Text>
      </View>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        accessibilityLabel={t('listing.video.preview.label')}
      />
      {!usable ? (
        <Notice
          tone="error"
          locale={locale}
          message={
            take.sizeBytes > VIDEO_MAX_BYTES
              ? t('listing.video.errors.tooLarge')
              : Math.round(take.durationS) > WALKTHROUGH.maxSeconds
                ? t('listing.video.preview.tooLong')
                : t('listing.video.preview.tooShort')
          }
        />
      ) : null}
      {sending ? (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.color.brand.primary} />
          <Text style={[textStyle('body', locale), styles.muted]}>
            {progress > 0 && progress < 1
              ? t('listing.video.uploadingPercent', { percent: Math.round(progress * 100) })
              : t('listing.video.uploading')}
          </Text>
        </View>
      ) : null}
      {problem ? <Notice tone="error" locale={locale} message={problem} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  centered: { alignItems: 'center', marginTop: theme.space['8'] },
  center: { textAlign: 'center' },
  overline: { color: theme.color.brand.primary, textTransform: 'uppercase' },
  muted: { color: theme.color.text.secondary },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['4'],
    ...theme.elevation['1'],
  },
  row: { flexDirection: 'row', gap: theme.space['3'], alignItems: 'center' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.brand.primarySubtle,
  },
  rowText: { flex: 1 },
  footerButtons: { gap: theme.space['3'] },
  video: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 420,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.bg.immersive,
  },
  cameraRoot: { flex: 1, backgroundColor: theme.color.bg.immersive },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    paddingHorizontal: theme.space['4'],
    paddingTop: theme.space['4'],
  },
  close: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCRIM,
  },
  cameraBottom: { alignItems: 'center', gap: theme.space['3'], paddingBottom: theme.space['6'] },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['2'],
    paddingHorizontal: theme.space['4'],
    paddingVertical: theme.space['2'],
    borderRadius: theme.radius.full,
    backgroundColor: SCRIM,
  },
  onDark: { color: ON_DARK },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.semantic.status.error.fg },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: ON_DARK,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCRIM,
  },
  shutterDisabled: { opacity: 0.45 },
  recordDot: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.semantic.status.error.fg,
  },
});
