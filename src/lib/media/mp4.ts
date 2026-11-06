/**
 * A small MP4/MOV (ISO base media) reader: duration, display size and video codec, without
 * decoding anything. It reads only box headers and the `moov` box, through a `read(offset,
 * length)` callback, so it works on a browser `File` (slices), a Node buffer, or a Storage object
 * fetched with HTTP Range requests (ADR 0005: no ffprobe on Vercel).
 *
 * Pure: no I/O of its own.
 */

export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

export interface Mp4Info {
  /** Seconds, from the movie header. */
  durationS: number;
  /** Display size: the track size with a 90°/270° rotation applied. */
  width: number;
  height: number;
  /** The sample entry type of the video track, e.g. `avc1`, `hvc1`. */
  codec: string | null;
}

export class Mp4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4Error";
  }
}

/** moov boxes are usually well under 1 MB; anything this big isn't a short video's index. */
const MAX_MOOV_BYTES = 16 * 1024 * 1024;
/** Top-level boxes walked before giving up (ftyp, free, mdat, moov, …). */
const MAX_TOP_LEVEL_BOXES = 64;

interface Box {
  type: string;
  /** Start of the box's content (after its header). */
  start: number;
  /** End of the box (exclusive). */
  end: number;
}

function fourcc(bytes: Uint8Array, at: number): string {
  const dv = view(bytes);
  return String.fromCharCode(
    dv.getUint8(at),
    dv.getUint8(at + 1),
    dv.getUint8(at + 2),
    dv.getUint8(at + 3),
  );
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Child boxes of `bytes[start, end)`. */
function children(bytes: Uint8Array, start: number, end: number): Box[] {
  const dv = view(bytes);
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = dv.getUint32(at);
    const type = fourcc(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(dv.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

function child(bytes: Uint8Array, parent: Box, type: string): Box | undefined {
  return children(bytes, parent.start, parent.end).find((b) => b.type === type);
}

function path(bytes: Uint8Array, parent: Box, ...types: string[]): Box | undefined {
  let box: Box | undefined = parent;
  for (const type of types) {
    if (!box) return undefined;
    box = child(bytes, box, type);
  }
  return box;
}

/** Movie duration in seconds from `mvhd`. */
function movieDuration(bytes: Uint8Array, mvhd: Box): number {
  const dv = view(bytes);
  const version = dv.getUint8(mvhd.start);
  const timescale = dv.getUint32(mvhd.start + (version === 1 ? 20 : 12));
  const duration =
    version === 1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16);
  if (!timescale) throw new Mp4Error("The video has no timescale.");
  return duration / timescale;
}

/** Display width and height from `tkhd`, swapped when the matrix rotates by 90° or 270°. */
function trackSize(bytes: Uint8Array, tkhd: Box): { width: number; height: number } {
  const dv = view(bytes);
  const version = dv.getUint8(tkhd.start);
  const matrixAt = tkhd.start + (version === 1 ? 52 : 40);
  const a = dv.getInt32(matrixAt);
  const b = dv.getInt32(matrixAt + 4);
  const width = Math.round(dv.getUint32(matrixAt + 36) / 65536);
  const height = Math.round(dv.getUint32(matrixAt + 40) / 65536);
  const rotated = Math.abs(b) > Math.abs(a);
  return rotated ? { width: height, height: width } : { width, height };
}

/** Parses a complete `moov` box. */
export function parseMoov(moovBytes: Uint8Array): Mp4Info {
  try {
    return readMoov(moovBytes);
  } catch (err) {
    // A box shorter than its fields: a damaged file.
    if (err instanceof RangeError) throw new Mp4Error("The video's index is damaged.");
    throw err;
  }
}

function readMoov(moovBytes: Uint8Array): Mp4Info {
  const moov: Box = { type: "moov", start: 0, end: moovBytes.length };
  const mvhd = child(moovBytes, moov, "mvhd");
  if (!mvhd) throw new Mp4Error("The video has no movie header.");
  const durationS = movieDuration(moovBytes, mvhd);

  for (const trak of children(moovBytes, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const hdlr = path(moovBytes, trak, "mdia", "hdlr");
    // hdlr: version/flags (4), pre_defined (4), handler_type (4).
    if (!hdlr || hdlr.end - hdlr.start < 12 || fourcc(moovBytes, hdlr.start + 8) !== "vide") {
      continue;
    }
    const tkhd = child(moovBytes, trak, "tkhd");
    if (!tkhd) continue;
    const { width, height } = trackSize(moovBytes, tkhd);
    const stsd = path(moovBytes, trak, "mdia", "minf", "stbl", "stsd");
    // stsd: version/flags (4), entry_count (4), then the first sample entry (size, type).
    const codec =
      stsd && stsd.end - stsd.start >= 16 ? fourcc(moovBytes, stsd.start + 12).trim() : null;
    return { durationS, width, height, codec: codec === "" ? null : codec };
  }
  throw new Mp4Error("The file has no video track.");
}

/**
 * Reads an MP4/MOV file's facts. Walks the top-level boxes (reading 16-byte headers only) to find
 * `moov`, then reads and parses it. Throws `Mp4Error` when the file isn't an MP4/MOV video.
 */
export async function probeMp4(read: ReadRange, size: number): Promise<Mp4Info> {
  let at = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && at + 8 <= size; i++) {
    const head = await read(at, Math.min(16, size - at));
    if (head.length < 8) break;
    const dv = view(head);
    let boxSize = dv.getUint32(0);
    const type = fourcc(head, 4);
    let header = 8;
    if (boxSize === 1) {
      if (head.length < 16) break;
      boxSize = Number(dv.getBigUint64(8));
      header = 16;
    } else if (boxSize === 0) {
      boxSize = size - at;
    }
    if (i === 0 && !/^[\x20-\x7e]{4}$/.test(type)) break;
    if (boxSize < header || at + boxSize > size) break;
    if (type === "moov") {
      if (boxSize > MAX_MOOV_BYTES) throw new Mp4Error("The video's index is too large to read.");
      const moov = await read(at + header, boxSize - header);
      if (moov.length !== boxSize - header) throw new Mp4Error("The video couldn't be read.");
      return parseMoov(moov);
    }
    at += boxSize;
  }
  throw new Mp4Error("This file isn't an MP4 or MOV video.");
}

/** A `ReadRange` over bytes already in memory (tests, small files). */
export function bufferReader(bytes: Uint8Array): ReadRange {
  return (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length));
}

/** A `ReadRange` over a browser `Blob`/`File`. */
export function blobReader(blob: Blob): ReadRange {
  return async (offset, length) =>
    new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}
