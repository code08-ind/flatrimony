'use client';

/**
 * The owner's listing calls (docs/05 §8.6) for the web listing editor and My Flat (T3.9b), through
 * this site's /api/v1. Each answers with the listing as it is now and its ETag, or the message for
 * a refusal. The same calls as the Android app (apps/mobile/src/listing/api.ts).
 */
import { useCallback, useState } from 'react';
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
import { api, NetworkError } from './api';

export type ListingResult =
  | { ok: true; listing: OwnerListing; etag?: string }
  | { ok: false; error: MessageKey; status: number | 'network' };

type Init = Parameters<typeof api>[1];

async function call(path: string, init: Init, expect: number[]): Promise<ListingResult> {
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

type Done = { ok: true } | { ok: false; error: MessageKey };

/** Soft delete (its files go too). */
export async function deleteListing(id: string): Promise<Done> {
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
export async function deleteMedia(id: string, mediaId: string): Promise<Done> {
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

/** The longest side of an uploaded photo (the Android app's PHOTO_UPLOAD_MAX_SIDE). */
export const PHOTO_MAX_SIDE = 1600;
/** The browser's wait for the photo confirm: MEDIA_API_TIMEOUT_MS in lib/server/proxy.ts. */
export const PHOTO_CONFIRM_TIMEOUT_MS = 90_000;
/** The PUT of the file itself to storage, on slow connections. */
const PHOTO_PUT_TIMEOUT_MS = 60_000;

/** The size to draw a photo at so its longest side is at most `max` (never scaled up). */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type PhotoAdd =
  { ok: true; listing: OwnerListing; etag?: string } | { ok: false; error: MessageKey };

/**
 * A photo the owner picked becomes a JPEG of at most 1600 px drawn on a canvas (upright, and
 * without its metadata, GPS included); it is PUT to storage with the signed upload URL the API
 * hands out through this site, then confirmed at `position` (docs/05 §8.6). The API re-encodes it
 * again and checks it.
 */
export async function addPhoto(listingId: string, file: File, position: number): Promise<PhotoAdd> {
  let blob: Blob;
  try {
    blob = await toJpeg(file);
  } catch {
    return { ok: false, error: 'listing.editor.photos.errors.unreadable' };
  }
  try {
    const url = await api(`/listings/${listingId}/media/upload-url`, {
      method: 'POST',
      body: { kind: 'photo', contentType: 'image/jpeg', sizeBytes: blob.size },
    });
    if (url.status !== 200) return { ok: false, error: photoError(url.status, url.body) };
    const parsed = ListingMediaUploadUrlResponse.safeParse(url.body);
    if (!parsed.success) return { ok: false, error: 'listing.editor.photos.errors.failed' };
    const { uploadUrl, storageKey } = parsed.data;
    const put = await fetchWithTimeout(
      uploadUrl,
      { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob },
      PHOTO_PUT_TIMEOUT_MS,
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
      timeoutMs: PHOTO_CONFIRM_TIMEOUT_MS,
    });
    if (confirm.status !== 201)
      return { ok: false, error: photoError(confirm.status, confirm.body) };
    const listing = OwnerListing.safeParse(confirm.body);
    return listing.success
      ? { ok: true, listing: listing.data, ...(confirm.etag ? { etag: confirm.etag } : {}) }
      : { ok: false, error: 'listing.editor.photos.errors.failed' };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof NetworkError
          ? 'listing.editor.errors.network'
          : 'listing.editor.photos.errors.failed',
    };
  }
}

async function toJpeg(file: File): Promise<Blob> {
  // EXIF orientation is applied while decoding, so the photo is drawn the right way up.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85),
    );
  } finally {
    bitmap.close();
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
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    listings: OwnerListing[] | null;
  }>({ status: 'loading', listings: null });

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

  return { ...state, refresh };
}
