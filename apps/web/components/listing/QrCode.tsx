'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** The QR quiet zone, in modules (the standard asks for 4). */
const QUIET = 4;

/** The dark modules of `text` as one SVG path (medium error correction), with its size. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  return { size: n + 2 * QUIET, d };
}

/** A QR code drawn as SVG (crisp at any size, dark on white with its quiet zone). */
export function QrCode({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-testid={testId}
      shapeRendering="crispEdges"
    >
      <rect className="qr-bg" width={size} height={size} />
      <path className="qr-dark" d={d} />
    </svg>
  );
}
