import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LISTING_STEPS, type ListingStep } from '@flatrimony/client';
import { ListingEditor } from '../../../../../components/listing/ListingEditor';
import { ListingGate } from '../../../../../components/listing/pieces';
import { MeProvider } from '../../../../../lib/client/me';
import { titled } from '../../../../../lib/metadata';
import { REFRESH_COOKIE } from '../../../../../lib/server/session';
import '../../../../listing.css';

export const generateMetadata = titled('listing.editor.title');

const isListingStep = (s: unknown): s is ListingStep =>
  typeof s === 'string' && (LISTING_STEPS as readonly string[]).includes(s);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The listing editor (T3.9b): `?id=<listing>&step=<step>` continues a draft, no id starts a new
 * one. Only the listing id and the step are in the URL.
 */
export default async function ListingEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!(await cookies()).has(REFRESH_COOKIE)) redirect(`/${locale}/sign-in`);
  const { id, step } = await searchParams;
  const listingId = typeof id === 'string' && UUID.test(id) ? id : undefined;
  return (
    <MeProvider>
      <ListingGate>
        <ListingEditor
          // A new key per listing: "List another room" from an open draft starts clean.
          key={listingId ?? 'new'}
          id={listingId}
          initialStep={isListingStep(step) ? step : undefined}
        />
      </ListingGate>
    </MeProvider>
  );
}
