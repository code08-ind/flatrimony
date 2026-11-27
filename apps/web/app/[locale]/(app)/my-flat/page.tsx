import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MyFlat } from '../../../../components/listing/MyFlat';
import { ListingGate } from '../../../../components/listing/pieces';
import { MeProvider } from '../../../../lib/client/me';
import { titled } from '../../../../lib/metadata';
import { REFRESH_COOKIE } from '../../../../lib/server/session';
import '../../../listing.css';

export const generateMetadata = titled('listing.myFlat.overline');

/** My Flat (T3.9b): the owner's listings. Needs a session and a finished profile. */
export default async function MyFlatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!(await cookies()).has(REFRESH_COOKIE)) redirect(`/${locale}/sign-in`);
  return (
    <MeProvider>
      <ListingGate>
        <MyFlat />
      </ListingGate>
    </MeProvider>
  );
}
