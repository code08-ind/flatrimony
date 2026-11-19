import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '../../src/auth/session';
import { useMe } from '../../src/me';
import { useDraft } from '../../src/onboarding/draft';
import { isComplete, resumeStep, stepAhead } from '../../src/onboarding/logic';
import { theme } from '../../src/theme';
import { ProfileLoadError } from '../../src/ui/ProfileLoadError';

/**
 * Onboarding (FR-AUTH-06): signed in, profile not finished. A finished profile goes to Discover.
 * A step opened ahead of the answers so far (a reload or a deep link on the web preview) goes to
 * the first unanswered step instead of letting the user answer it and then losing the answer.
 */
export default function OnboardingLayout() {
  const { session, loading } = useSession();
  const { status, me, refresh } = useMe();
  const draft = useDraft();
  const path = usePathname();
  if (loading) return null;
  if (!session) return <Redirect href="/welcome" />;
  if (status === 'idle' || (status === 'loading' && !me)) return null;
  if (status === 'error') return <ProfileLoadError onRetry={() => void refresh()} />;
  if (isComplete(me)) return <Redirect href="/" />;
  const first = resumeStep(me, draft) ?? 'habits';
  const current = path.split('/')[2];
  if (current && stepAhead(current, first)) return <Redirect href={`/onboarding/${first}`} />;
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg.app } }}
    />
  );
}
