import { Redirect } from 'expo-router';
import { useMe } from '../../src/me';
import { getDraft } from '../../src/onboarding/draft';
import { resumeStep } from '@flatrimony/client';

/** Opens the first step not yet answered (after a restart, from what the server has). */
export default function OnboardingIndex() {
  const { me } = useMe();
  const step = resumeStep(me, getDraft()) ?? 'habits';
  return <Redirect href={`/onboarding/${step}`} />;
}
