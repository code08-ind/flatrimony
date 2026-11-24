import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { OnboardingGate } from '../../../../components/OnboardingGate';
import { MeProvider } from '../../../../lib/client/me';
import { REFRESH_COOKIE } from '../../../../lib/server/session';

/** Onboarding needs a session; which step to show is decided from the profile (OnboardingGate). */
export default async function OnboardingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(await cookies()).has(REFRESH_COOKIE)) redirect(`/${locale}/sign-in`);
  return (
    <MeProvider>
      <OnboardingGate>{children}</OnboardingGate>
    </MeProvider>
  );
}
