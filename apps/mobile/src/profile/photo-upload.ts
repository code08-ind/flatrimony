import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { MessageKey } from '@flatrimony/i18n';
import { PhotoUploadUrlResponse } from '@flatrimony/shared';
import { api } from '../api';
import { fetchWithTimeout } from '../net';
import { photoErrorKey, resizeFor } from './logic';

export type PhotoResult =
  { ok: true } | { ok: false; error: MessageKey } | { ok: false; cancelled: true };

/** Uploading and server-side processing take longer than an ordinary request on slow 4G. */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Pick a photo from the library (the system photo picker: no storage permission needed on
 * Android 13+), scale it down and save it as JPEG on the device, upload it with the signed URL from
 * the API and confirm it at `position` (docs/05 §8.3). The API then removes all metadata.
 * `ifMatch` is the profile version `position` was read from: if the photos changed meanwhile (on
 * another device) the confirm answers 412 instead of replacing a photo at that position.
 */
export async function pickAndUploadPhoto(position: number, ifMatch?: string): Promise<PhotoResult> {
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

    const url = await api('/me/photos/upload-url', {
      method: 'POST',
      body: { contentType: 'image/jpeg', sizeBytes: blob.size },
    });
    if (url.status !== 200) return { ok: false, error: photoErrorKey(url.status, url.body) };
    const { uploadUrl, storageKey } = PhotoUploadUrlResponse.parse(url.body);

    const put = await fetchWithTimeout(
      uploadUrl,
      { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob },
      UPLOAD_TIMEOUT_MS,
    );
    if (!put.ok)
      return {
        ok: false,
        error:
          put.status === 413 ? 'profile.photos.errors.tooLarge' : 'profile.photos.errors.failed',
      };

    const confirm = await api('/me/photos', {
      method: 'POST',
      body: { storageKey, position },
      ifMatch,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    // 503 "Photo saved": stored, only the view link failed; the profile reload shows it.
    const savedWithoutLink =
      confirm.status === 503 &&
      (confirm.body as { title?: string } | null)?.title === 'Photo saved';
    if (confirm.status !== 201 && !savedWithoutLink)
      return { ok: false, error: photoErrorKey(confirm.status, confirm.body) };
    return { ok: true };
  } catch {
    return { ok: false, error: 'profile.photos.errors.failed' };
  }
}
