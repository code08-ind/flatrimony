/**
 * The owner's listing calls (docs/05 §8.6) for My Flat and the editor (T3.9). Each answers with the
 * listing as it is now (`OwnerListing`) and its ETag, or the message for a refusal.
 */
import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fetchWithTimeout, listingErrorKey } from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import {
  ListingMediaUploadUrlResponse,
  OwnerListing,
  OwnerListingList,
  type CreateListingRequest,
  type ListingCosts,
  type ListingPatch,
  type ListingRules,
} from '@flatrimony/shared';
import { api, NetworkError } from '../api';
import { resizeFor } from '../profile/logic';

export type ListingResult =
  | { ok: true; listing: OwnerListing; etag?: string }
  | { ok: false; error: MessageKey; status: number | 'network' };

async function call(
  path: string,
  init: Parameters<typeof api>[1],
  expect: number[],
): Promise<ListingResult> {
  try {
    const res = await api(path, init);
    if (!expect.includes(res.status))
      return { ok: false, error: listingErrorKey(res.status, res.body), status: res.status };
    const parsed = OwnerListing.safeParse(res.body);
    if (!parsed.success) return { ok: false, error: 'listing.editor.errors.generic', status: 500 };
    return { ok: true, listing: parsed.data, ...(res.etag ? { etag: res.etag } : {}) };
  } catch (err) {
    if (err instanceof NetworkError)
      return { ok: false, error: 'listing.editor.errors.network', status: 'network' };
    throw err;
  }
}

export const getListing = (id: string) => call(`/listings/${id}`, {}, [200]);
export const createListing = (body: CreateListingRequest) =>
  call('/listings', { method: 'POST', body }, [201]);
export const patchListing = (id: string, body: ListingPatch, ifMatch?: string) =>
  call(`/listings/${id}`, { method: 'PATCH', body, ...(ifMatch ? { ifMatch } : {}) }, [200]);
export const putRules = (id: string, body: ListingRules, ifMatch?: string) =>
  call(`/listings/${id}/rules`, { method: 'PUT', body, ...(ifMatch ? { ifMatch } : {}) }, [200]);
export const putCosts = (id: string, body: ListingCosts, ifMatch?: string) =>
  call(`/listings/${id}/costs`, { method: 'PUT', body, ...(ifMatch ? { ifMatch } : {}) }, [200]);

export type ListingAction = 'submit' | 'confirm-available' | 'pause' | 'resume';
export const actOn = (id: string, action: ListingAction) =>
  call(`/listings/${id}/${action}`, { method: 'POST' }, [200]);

/** Soft delete (its files go too). */
export async function deleteListing(
  id: string,
): Promise<{ ok: true } | { ok: false; error: MessageKey }> {
  try {
    const res = await api(`/listings/${id}`, { method: 'DELETE' });
    return res.status === 204
      ? { ok: true }
      : { ok: false, error: listingErrorKey(res.status, res.body) };
  } catch {
    return { ok: false, error: 'listing.editor.errors.network' };
  }
}

/** Removes one photo (or the video); a live listing keeps at least 3 photos (409). */
export async function deleteMedia(
  id: string,
  mediaId: string,
): Promise<{ ok: true } | { ok: false; error: MessageKey }> {
  try {
    const res = await api(`/listings/${id}/media/${mediaId}`, { method: 'DELETE' });
    if (res.status === 204) return { ok: true };
    const code = (res.body as { code?: string } | null)?.code;
    return {
      ok: false,
      error:
        code === 'listing.incomplete'
          ? 'listing.editor.photos.errors.liveMinimum'
          : listingErrorKey(res.status, res.body),
    };
  } catch {
    return { ok: false, error: 'listing.editor.errors.network' };
  }
}

/** Uploads and processing on slow 4G take longer than an ordinary request. */
const PHOTO_TIMEOUT_MS = 60_000;

export type PhotoAdd =
  | { ok: true; listing: OwnerListing }
  | { ok: false; cancelled: true }
  | { ok: false; error: MessageKey };

/**
 * Pick a photo (the system photo picker: no storage permission), scale it down and save it as
 * JPEG on the phone, upload it with the signed URL and confirm it at `position` (docs/05 §8.6). The
 * API re-encodes it and removes all metadata, GPS included.
 */
export async function pickAndAddPhoto(listingId: string, position: number): Promise<PhotoAdd> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  });
  if (picked.canceled || !picked.assets[0]) return { ok: false, cancelled: true };
  const asset = picked.assets[0];
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    const size = resizeFor(asset.width, asset.height);
    if (size) context.resize(size);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    const blob = await (await fetch(saved.uri)).blob();

    const url = await api(`/listings/${listingId}/media/upload-url`, {
      method: 'POST',
      body: { kind: 'photo', contentType: 'image/jpeg', sizeBytes: blob.size },
    });
    if (url.status !== 200) return { ok: false, error: photoError(url.status, url.body) };
    const { uploadUrl, storageKey } = ListingMediaUploadUrlResponse.parse(url.body);
    const put = await fetchWithTimeout(
      uploadUrl,
      { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob },
      PHOTO_TIMEOUT_MS,
    );
    if (!put.ok)
      return {
        ok: false,
        error:
          put.status === 413
            ? 'listing.editor.photos.errors.tooLarge'
            : 'listing.editor.photos.errors.failed',
      };
    const confirm = await api(`/listings/${listingId}/media`, {
      method: 'POST',
      body: { kind: 'photo', storageKey, position },
      timeoutMs: PHOTO_TIMEOUT_MS,
    });
    if (confirm.status !== 201)
      return { ok: false, error: photoError(confirm.status, confirm.body) };
    return { ok: true, listing: OwnerListing.parse(confirm.body) };
  } catch {
    return { ok: false, error: 'listing.editor.photos.errors.failed' };
  }
}

function photoError(status: number, body: unknown): MessageKey {
  const reason = (body as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code;
  if (reason === 'too_large') return 'listing.editor.photos.errors.tooLarge';
  if (reason === 'unsupported_format' || reason === 'not_an_image' || reason === 'animated')
    return 'listing.editor.photos.errors.unsupported';
  if (status === 422) return 'listing.editor.photos.errors.failed';
  return listingErrorKey(status, body);
}

/** The caller's listings (My Flat), refreshed on demand. */
export function useMyListings() {
  const [state, setState] = useState<
    | { status: 'loading'; listings: OwnerListing[] | null }
    | { status: 'ready'; listings: OwnerListing[] }
    | { status: 'error'; listings: OwnerListing[] | null }
  >({ status: 'loading', listings: null });

  const refresh = useCallback(async () => {
    setState((s) => ({ status: 'loading', listings: s.listings }));
    try {
      const res = await api('/me/listings');
      const parsed = OwnerListingList.safeParse(res.body);
      if (res.status !== 200 || !parsed.success) throw new Error('listings');
      setState({ status: 'ready', listings: parsed.data.listings });
    } catch {
      setState((s) => ({ status: 'error', listings: s.listings }));
    }
  }, []);

  // Loaded by the screen when it gains focus (My Flat refreshes on every visit).
  return { ...state, refresh };
}
