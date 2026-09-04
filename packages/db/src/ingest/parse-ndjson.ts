import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

export type Envelope = Record<string, any>;

export interface ParseStats {
  lines: number;
  parsed: number;
  skipped: number;
}

/** Tolerant NDJSON reader: blank and corrupt lines are counted and skipped, never fatal. */
export async function* parseNdjson(file: string, stats?: ParseStats): AsyncGenerator<Envelope> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) {
    if (stats) stats.lines++;
    const line = raw.trim();
    if (!line) continue;
    try {
      const env = JSON.parse(line);
      if (env && typeof env === 'object') {
        if (stats) stats.parsed++;
        yield env;
      } else if (stats) stats.skipped++;
    } catch {
      if (stats) stats.skipped++;
    }
  }
}

export function fileSha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
