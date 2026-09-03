import { createHash, randomBytes } from 'node:crypto';

/**
 * Stable scenario fingerprint shared by run directories, DB dedupe, flaky stats and issue links.
 * Browser is deliberately excluded so one issue covers all browsers.
 */
export interface FingerprintInput {
  project: string;
  featureUri: string;
  scenarioName: string;
  exampleIndex?: number | null;
  layer: string;
}

export function fingerprint(input: FingerprintInput): string {
  const parts = [
    input.project,
    normalizeUri(input.featureUri),
    input.scenarioName.trim(),
    input.exampleIndex == null ? '' : String(input.exampleIndex),
    input.layer,
  ];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

export function normalizeUri(uri: string): string {
  return uri.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** UUID v7 (time-ordered) without external dependencies. */
export function uuidv7(now: number = Date.now()): string {
  const ts = BigInt(now);
  const rand = randomBytes(10);
  const bytes = Buffer.alloc(16);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  rand.copy(bytes, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newRunId(): string {
  return uuidv7();
}

export function newId(): string {
  return uuidv7();
}

/** Short, filesystem-safe id for scratch directories. */
export function shortId(length = 6): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

/** Split an AutoMax-generated Playwright project name into its parts. */
export interface PwProjectParts {
  project: string;
  layer: string;
  browser?: string;
}

export const PW_PROJECT_SEPARATOR = '--';

export function pwProjectName(parts: PwProjectParts): string {
  const segs = [parts.project, parts.layer];
  if (parts.browser) segs.push(parts.browser);
  return segs.join(PW_PROJECT_SEPARATOR);
}

export function parsePwProjectName(name: string): PwProjectParts | null {
  const segs = name.split(PW_PROJECT_SEPARATOR);
  if (segs.length < 2 || segs.length > 3) return null;
  const [project, layer, browser] = segs;
  if (!project || !layer) return null;
  return browser ? { project, layer, browser } : { project, layer };
}
