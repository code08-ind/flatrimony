import type { Metadata } from 'next';
import { VerifyEmail } from '../../../../components/VerifyEmail';
import { titled } from '../../../../lib/metadata';

const title = titled('web.verifyEmail.title');

/** The page a work/college email link opens (T3.3): no sign-in, no referrer, nothing cached. */
export async function generateMetadata(args: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return { ...(await title(args)), referrer: 'no-referrer', robots: { index: false } };
}

export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
