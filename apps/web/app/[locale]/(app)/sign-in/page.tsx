import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignIn } from '../../../../components/SignIn';
import { titled } from '../../../../lib/metadata';
import { REFRESH_COOKIE } from '../../../../lib/server/session';

export const generateMetadata = titled('auth.phone.title');

/** Phone sign-in. Already signed in: straight on to onboarding (which sends finished users home). */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if ((await cookies()).has(REFRESH_COOKIE)) redirect(`/${locale}/onboarding`);
  return <SignIn />;
}
