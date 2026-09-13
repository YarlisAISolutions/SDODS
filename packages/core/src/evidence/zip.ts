import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * The smallest zip reader/writer that round-trips a Playwright trace.
 *
 * Playwright writes traces with yazl: DEFLATE entries whose local headers set the data-descriptor
 * flag and leave sizes and CRC zero, so sizes are read from the central directory. Entries that are
 * not rewritten are copied through compressed, byte for byte. ZIP64 archives (over 4 GB or 65,535
 * entries) are refused rather than misread.
 */
export interface ZipEntry {
  name: string;
  /** raw name bytes, preserved as written */
  nameBytes: Buffer;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  size: number;
  versionMadeBy: number;
  versionNeeded: number;
  internalAttr: number;
  externalAttr: number;
  /** compressed payload */
  data: Buffer;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_DATA_DESCRIPTOR = 0x0008;

export class ZipFormatError extends Error {}

export function isZip(buf: Buffer): boolean {
  return buf.length >= 22 && buf.readUInt32LE(0) === SIG_LOCAL;
}

export function readZip(buf: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipFormatError('not a zip archive (no end of central directory)');
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff)
    throw new ZipFormatError('ZIP64 archives are not supported');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new ZipFormatError(`bad central directory header at ${p}`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameBytes = Buffer.from(buf.subarray(p + 46, p + 46 + nameLen));
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL)
      throw new ZipFormatError(`bad local header at ${localOffset}`);
    const dataStart =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    entries.push({
      name: nameBytes.toString('utf8'),
      nameBytes,
      versionMadeBy: buf.readUInt16LE(p + 4),
      versionNeeded: buf.readUInt16LE(p + 6),
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      compressedSize,
      size: buf.readUInt32LE(p + 24),
      internalAttr: buf.readUInt16LE(p + 36),
      externalAttr: buf.readUInt32LE(p + 38),
      data: buf.subarray(dataStart, dataStart + compressedSize),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function entryContent(entry: ZipEntry): Buffer {
  if (entry.method === 0) return Buffer.from(entry.data);
  if (entry.method === 8) return inflateRawSync(entry.data);
  throw new ZipFormatError(`unsupported compression method ${entry.method} for ${entry.name}`);
}

/** Replace an entry's content, recompressing with DEFLATE. */
export function withContent(entry: ZipEntry, content: Buffer): ZipEntry {
  const data = deflateRawSync(content);
  return {
    ...entry,
    method: 8,
    versionNeeded: Math.max(entry.versionNeeded, 20),
    crc: crc32(content),
    size: content.length,
    compressedSize: data.length,
    data,
  };
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    // Sizes and CRC are known, so the local header carries them and no data descriptor follows.
    const flags = e.flags & ~FLAG_DATA_DESCRIPTOR;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(e.versionNeeded, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc >>> 0, 14);
    local.writeUInt32LE(e.compressedSize, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(e.nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(e.versionMadeBy, 4);
    cd.writeUInt16LE(e.versionNeeded, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt16LE(e.time, 12);
    cd.writeUInt16LE(e.date, 14);
    cd.writeUInt32LE(e.crc >>> 0, 16);
    cd.writeUInt32LE(e.compressedSize, 20);
    cd.writeUInt32LE(e.size, 24);
    cd.writeUInt16LE(e.nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(e.internalAttr, 36);
    cd.writeUInt32LE(e.externalAttr >>> 0, 38);
    cd.writeUInt32LE(offset, 42);

    parts.push(local, e.nameBytes, e.data);
    central.push(cd, e.nameBytes);
    offset += local.length + e.nameBytes.length + e.data.length;
    if (offset > 0xffffffff) throw new ZipFormatError('archive too large (ZIP64 not supported)');
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

let crcTable: Uint32Array | undefined;

export function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
