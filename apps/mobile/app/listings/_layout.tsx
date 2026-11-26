import { Redirect, Stack } from 'expo-router';
import { isComplete } from '@flatrimony/client';
import { useSession } from '../../src/auth/session';
import { useMe } from '../../src/me';
import { theme } from '../../src/theme';
import { ProfileLoadError } from '../../src/ui/ProfileLoadError';

/**
 * Listing screens outside the tabs (T3.7: the walkthrough recorder, also opened by the
 * `flatrimony://listings/{id}/video` link from the web, FR-LST-05). The same gate as the tabs: signed
 * in, with a finished profile.
 */
export default function ListingsLayout() {
  const { session, loading } = useSession();
  const me = useMe();
  if (loading) return null;
  if (!session) return <Redirect href="/welcome" />;
  if (me.status === 'idle' || (me.status === 'loading' && !me.me)) return null;
  if (me.status === 'error') return <ProfileLoadError onRetry={() => void me.refresh()} />;
  if (!isComplete(me.me)) return <Redirect href="/onboarding" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.bg.app },
      }}
    />
  );
}
