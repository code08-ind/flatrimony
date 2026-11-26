/** A minimal MP4 for tests: an `ftyp` box, then `moov` holding a movie header with the duration. */
export function fakeMp4(
  durationS: number,
  {
    version = 0,
    padding = 4096,
    /** ms since 1970; null leaves it 0 (unknown), as some recorders do. */
    createdAt = Date.now() as number | null,
  } = {},
): Buffer {
  const created = createdAt === null ? 0 : Math.floor(createdAt / 1000) + 2_082_844_800;
  const box = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const timescale = 1000;
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2mp41', 'latin1'));
  let mvhd: Buffer;
  if (version === 0) {
    mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(created, 4);
    mvhd.writeUInt32BE(timescale, 12);
    mvhd.writeUInt32BE(Math.round(durationS * timescale), 16);
  } else {
    mvhd = Buffer.alloc(112);
    mvhd[0] = 1;
    mvhd.writeBigUInt64BE(BigInt(created), 4);
    mvhd.writeUInt32BE(timescale, 20);
    mvhd.writeBigUInt64BE(BigInt(Math.round(durationS * timescale)), 24);
  }
  // Some media data first, so the movie header is not at a fixed place.
  const mdat = box('mdat', Buffer.alloc(padding, 0x42));
  return Buffer.concat([ftyp, mdat, box('moov', box('mvhd', mvhd))]);
}
