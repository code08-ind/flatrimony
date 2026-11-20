import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { MessageKey } from '@flatrimony/i18n';
import { LIMITS } from '@flatrimony/shared';
import { api } from '../../../src/api';
import { readMe } from '../../../src/me-parse';
import { useMe } from '../../../src/me';
import { canAddPhoto, photoErrorKey, withMainFirst } from '../../../src/profile/logic';
import { pickAndUploadPhoto } from '../../../src/profile/photo-upload';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { BackButton } from '../../../src/ui/buttons';
import { confirmAction } from '../../../src/ui/confirm';
import { Plus, Star, Trash } from '../../../src/ui/icons';
import { Notice } from '../../../src/ui/Notice';
import { Screen } from '../../../src/ui/Screen';

/**
 * Photos (FR-BIO-01/07; docs/05 §8.3): 1–6 photos, the first is the main one. Add (pick, scale,
 * upload, confirm), make main (reorder) and remove (at least one stays). New photos show "Under
 * review" until moderation (face and content checks are Blocked on a vendor).
 */
export default function Photos() {
  const { t, locale } = useT();
  const { me, etag, set, refresh } = useMe();
  const [busy, setBusy] = useState<string | null>(null); // 'add' or a photo id
  const [error, setError] = useState<MessageKey | null>(null);
  if (!me) return null;

  /**
   * One photo action at a time. A network failure shows `offline`; a 412 (the photos changed on
   * another device) loads the latest profile. Reloads after a change are quiet: if one fails the
   * screen keeps what it shows instead of switching to the profile load error.
   */
  const run = async (
    key: string,
    offline: MessageKey,
    work: () => Promise<{ error: MessageKey | null; status?: number }>,
  ) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const { error: failed, status } = await work();
      if (status === 412) await refresh({ quiet: true });
      setError(failed);
    } catch {
      setError(offline);
    } finally {
      setBusy(null);
    }
  };
  const add = () =>
    run('add', 'profile.photos.errors.failed', async () => {
      const result = await pickAndUploadPhoto(me.photos.length, etag);
      if ('cancelled' in result) return { error: null };
      if (result.ok) await refresh({ quiet: true });
      return result.ok
        ? { error: null }
        : {
            error: result.error,
            status: result.error === 'profile.editor.changedElsewhere' ? 412 : undefined,
          };
    });
  const makeMain = (id: string) =>
    run(id, 'profile.photos.errors.reorderFailed', async () => {
      const res = await api('/me/photos/order', {
        method: 'PATCH',
        ifMatch: etag,
        body: {
          photoIds: withMainFirst(
            me.photos.map((p) => p.id),
            id,
          ),
        },
      });
      const updated = res.status === 200 ? readMe(res.body) : null;
      if (updated) set(updated, res.etag);
      return {
        error: updated ? null : photoErrorKey(res.status, res.body, 'reorder'),
        status: res.status,
      };
    });
  const remove = async (id: string) => {
    if (busy) return;
    const sure = await confirmAction({
      title: t('profile.photos.removeConfirmTitle'),
      message: t('profile.photos.removeConfirmBody'),
      confirmLabel: t('profile.photos.remove'),
      cancelLabel: t('common.cancel'),
    });
    if (!sure) return;
    await run(id, 'profile.photos.errors.removeFailed', async () => {
      const res = await api(`/me/photos/${id}`, { method: 'DELETE', ifMatch: etag });
      if (res.status === 204) {
        await refresh({ quiet: true });
        return { error: null };
      }
      return { error: photoErrorKey(res.status, res.body, 'remove'), status: res.status };
    });
  };

  return (
    <Screen>
      <View style={styles.titleRow}>
        <BackButton label={t('common.back')} onPress={() => router.dismissTo('/profile/biodata')} />
        <Text style={[textStyle('h1', locale), { flex: 1 }]} accessibilityRole="header">
          {t('profile.photos.title')}
        </Text>
      </View>
      <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
        {t('profile.photos.hint')}
      </Text>
      {error && <Notice tone="error" locale={locale} message={t(error)} />}

      <View style={styles.grid}>
        {me.photos.map((p, i) => (
          <View key={p.id} style={styles.slot}>
            <Image
              source={{ uri: p.url }}
              style={styles.image}
              accessibilityIgnoresInvertColors
              accessible={false}
            />
            <View style={styles.badges}>
              {i === 0 && <Badge text={t('profile.photos.main')} strong />}
              {p.moderationStatus === 'pending' && <Badge text={t('profile.photos.pending')} />}
              {p.moderationStatus === 'rejected' && <Badge text={t('profile.photos.rejected')} />}
            </View>
            <View style={styles.actions}>
              {i > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.photos.makeMainN', { n: i + 1 })}
                  disabled={!!busy}
                  onPress={() => void makeMain(p.id)}
                  style={styles.action}
                >
                  <Star size={20} color={theme.color.text.primary} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('profile.photos.removeN', { n: i + 1 })}
                disabled={!!busy || me.photos.length <= 1}
                accessibilityState={{ disabled: !!busy || me.photos.length <= 1 }}
                onPress={() => void remove(p.id)}
                style={[styles.action, me.photos.length <= 1 && styles.actionOff]}
              >
                <Trash size={20} color={theme.color.text.primary} />
              </Pressable>
            </View>
            {busy === p.id && (
              <View style={styles.overlay}>
                <ActivityIndicator color={theme.color.white} />
              </View>
            )}
          </View>
        ))}
        {canAddPhoto(me) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.photos.add')}
            accessibilityState={{ disabled: !!busy, busy: busy === 'add' }}
            disabled={!!busy}
            onPress={() => void add()}
            style={[styles.slot, styles.addSlot]}
          >
            {busy === 'add' ? (
              <>
                <ActivityIndicator color={theme.color.brand.primary} />
                <Text style={[textStyle('caption', locale), { color: theme.color.text.secondary }]}>
                  {t('profile.photos.uploading')}
                </Text>
              </>
            ) : (
              <>
                <Plus size={28} color={theme.color.brand.primary} />
                <Text style={[textStyle('label', locale), { color: theme.color.brand.primary }]}>
                  {t('profile.photos.add')}
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>
      <Text style={[textStyle('caption', locale), { color: theme.color.text.secondary }]}>
        {me.photos.length}/{LIMITS.profilePhotos.max}
      </Text>
    </Screen>
  );
}

function Badge({ text, strong }: { text: string; strong?: boolean }) {
  const { locale } = useT();
  return (
    <View style={[styles.badge, strong && styles.badgeStrong]}>
      <Text
        style={[
          textStyle('micro', locale),
          { color: strong ? theme.color.white : theme.color.text.primary },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] },
  slot: {
    width: '47%',
    aspectRatio: 0.8,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    backgroundColor: theme.color.bg.surface,
  },
  image: { width: '100%', height: '100%' },
  badges: {
    position: 'absolute',
    top: theme.space['2'],
    left: theme.space['2'],
    gap: theme.space['1'],
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space['2'],
    paddingVertical: 2,
  },
  badgeStrong: { backgroundColor: theme.color.brand.primary },
  actions: {
    position: 'absolute',
    bottom: theme.space['2'],
    right: theme.space['2'],
    flexDirection: 'row',
    gap: theme.space['2'],
  },
  action: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionOff: { opacity: 0.4 },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.glass.dark.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space['2'],
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.color.brand.primary,
  },
});
