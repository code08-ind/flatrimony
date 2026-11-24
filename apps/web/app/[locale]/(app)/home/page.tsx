import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Home } from '../../../../components/Home';
import { MeProvider } from '../../../../lib/client/me';
import { titled } from '../../../../lib/metadata';
import { REFRESH_COOKIE } from '../../../../lib/server/session';

export const generateMetadata = titled('web.savedTitle');

/** Where a finished onboarding lands until web Discover (W02) is built. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!(await cookies()).has(REFRESH_COOKIE)) redirect(`/${locale}/sign-in`);
  return (
    <MeProvider>
      <Home />
    </MeProvider>
  );
}
