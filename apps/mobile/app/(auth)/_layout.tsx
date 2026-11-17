import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/session';
import { theme } from '../../src/theme';

/** Signed-out area. A signed-in user never sees it. */
export default function AuthLayout() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (session) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg.app } }}
    />
  );
}
