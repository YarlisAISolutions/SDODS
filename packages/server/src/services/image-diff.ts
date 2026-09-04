import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffResult {
  diffPath: string;
  width: number;
  height: number;
  mismatchPixels: number;
  mismatchRatio: number;
  cached: boolean;
}

/** Pixel diff of two PNGs on a padded common canvas; results cached on disk by content hash. */
export function diffPngs(
  beforePath: string,
  afterPath: string,
  cacheDir: string,
  threshold = 0.1,
): DiffResult {
  const a = PNG.sync.read(readFileSync(beforePath));
  const b = PNG.sync.read(readFileSync(afterPath));
  const key = createHash('sha1')
    .update(readFileSync(beforePath))
    .update(readFileSync(afterPath))
    .update(String(threshold))
    .digest('hex')
    .slice(0, 20);
  mkdirSync(cacheDir, { recursive: true });
  const diffPath = join(cacheDir, `${key}.png`);
  const metaPath = join(cacheDir, `${key}.json`);
  if (existsSync(diffPath) && existsSync(metaPath)) {
    return {
      ...(JSON.parse(readFileSync(metaPath, 'utf8')) as Omit<DiffResult, 'cached' | 'diffPath'>),
      diffPath,
      cached: true,
    };
  }
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pa = pad(a, width, height);
  const pb = pad(b, width, height);
  const out = new PNG({ width, height });
  const mismatchPixels = pixelmatch(pa.data, pb.data, out.data, width, height, {
    threshold,
    includeAA: false,
  });
  writeFileSync(diffPath, PNG.sync.write(out));
  const result = {
    width,
    height,
    mismatchPixels,
    mismatchRatio: mismatchPixels / (width * height),
  };
  writeFileSync(metaPath, JSON.stringify(result));
  return { ...result, diffPath, cached: false };
}

function pad(img: PNG, width: number, height: number): PNG {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height, fill: true });
  out.data.fill(0);
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

export function pngSize(path: string): { width: number; height: number } | null {
  try {
    const buf = readFileSync(path);
    if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}
