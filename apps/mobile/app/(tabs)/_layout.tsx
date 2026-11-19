import { Redirect, Tabs } from 'expo-router';
import { useSession } from '../../src/auth/session';
import { useMe } from '../../src/me';
import { isComplete } from '../../src/onboarding/logic';
import { ProfileLoadError } from '../../src/ui/ProfileLoadError';
import { useTranslation } from 'react-i18next';
import { theme } from '../../src/theme';

/**
 * v1.0 tabs (docs/06 §5.1): Discover, Rishtas, My Flat (have_room) / Saved (seekers), Profile.
 * The floating glass dock and Phosphor icons arrive with the first real screens (M2).
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { session, loading } = useSession();
  const me = useMe();
  if (loading) return null;
  if (!session) return <Redirect href="/welcome" />;
  // Until the profile is known the tabs stay hidden; an unfinished profile goes to onboarding.
  if (me.status === 'idle' || (me.status === 'loading' && !me.me)) return null;
  if (me.status === 'error') return <ProfileLoadError onRetry={() => void me.refresh()} />;
  if (!isComplete(me.me)) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.brand.primary,
        tabBarInactiveTintColor: theme.color.text.secondary,
        tabBarStyle: { backgroundColor: theme.color.bg.surface, minHeight: theme.size.dock },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.discover') }} />
      <Tabs.Screen name="rishtas" options={{ title: t('tabs.rishtas') }} />
      <Tabs.Screen name="my-flat" options={{ title: t('tabs.myFlat') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
    </Tabs>
  );
}
