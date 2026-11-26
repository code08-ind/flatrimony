/**
 * The movie header of an MP4 (`moov/mvhd`), read from the file's bytes: its duration and, when the
 * recorder wrote one, its creation time. Shared by the Android recorder (what it shows and sends,
 * T3.7) and the API (what it accepts, T3.6), so both judge a walkthrough by the file itself.
 * Reads box headers only; nothing is decoded. Works on any Uint8Array (a Node Buffer is one).
 */

/** Seconds from 1904-01-01 (the MP4 epoch) to 1970-01-01. */
const MP4_EPOCH_OFFSET_S = 2_082_844_800;

const ascii = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/**
 * `{ durationS, createdAt }` (createdAt in ms since 1970, null when the recorder left it 0), or null
 * when the bytes are not an MP4 we can read (no `ftyp` first, no movie header).
 */
export function mp4Header(
  file: Uint8Array,
): { durationS: number; createdAt: number | null } | null {
  if (file.length < 12 || ascii(file, 4) !== 'ftyp') return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const boxes = function* (start: number, end: number) {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      const type = ascii(file, at + 4);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        const big = view.getBigUint64(at + 8);
        if (big > BigInt(end - at)) return;
        size = Number(big);
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return;
      yield { type, body: at + header, end: at + size };
      at += size;
    }
  };
  for (const top of boxes(0, file.length)) {
    if (top.type !== 'moov') continue;
    for (const box of boxes(top.body, top.end)) {
      if (box.type !== 'mvhd') continue;
      const version = file[box.body];
      let created: number, timescale: number, duration: number;
      if (version === 0 && box.body + 20 <= box.end) {
        created = view.getUint32(box.body + 4);
        timescale = view.getUint32(box.body + 12);
        duration = view.getUint32(box.body + 16);
      } else if (version === 1 && box.body + 32 <= box.end) {
        created = Number(view.getBigUint64(box.body + 4));
        timescale = view.getUint32(box.body + 20);
        duration = Number(view.getBigUint64(box.body + 24));
      } else return null;
      if (timescale === 0) return null;
      return {
        durationS: duration / timescale,
        createdAt: created > 0 ? (created - MP4_EPOCH_OFFSET_S) * 1000 : null,
      };
    }
  }
  return null;
}

/** The duration of an MP4 in seconds, or null (see mp4Header). */
export const mp4DurationSeconds = (file: Uint8Array): number | null =>
  mp4Header(file)?.durationS ?? null;
