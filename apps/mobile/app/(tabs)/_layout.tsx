import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { theme } from '../../src/theme';

/**
 * v1.0 tabs (docs/06 §5.1): Discover, Rishtas, My Flat (have_room) / Saved (seekers), Profile.
 * The floating glass dock and Phosphor icons arrive with the first real screens (M2).
 */
export default function TabsLayout() {
  const { t } = useTranslation();
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
