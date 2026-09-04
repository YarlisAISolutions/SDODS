import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parseAttachmentName, scenarioFiles, type ParsedAttachment } from '@sdods/contracts/names';

export interface StoredFile {
  relPath: string;
  absPath: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
}

export interface AttachmentInput {
  fileName: string;
  mediaType: string;
  body?: string;
  contentEncoding?: 'IDENTITY' | 'BASE64';
  /** absolute or run-relative path when the reporter kept the file external */
  url?: string;
}

/** Decode an attachment body to bytes (base64 or identity). */
export function attachmentBytes(a: AttachmentInput): Buffer | null {
  if (a.url && existsSync(a.url)) return readFileSync(a.url);
  if (a.body === undefined) return null;
  return a.contentEncoding === 'BASE64'
    ? Buffer.from(a.body, 'base64')
    : Buffer.from(a.body, 'utf8');
}

/** Text body as string (JSON attachments are IDENTITY-encoded by playwright-bdd). */
export function attachmentText(a: AttachmentInput): string | null {
  const bytes = attachmentBytes(a);
  return bytes ? bytes.toString('utf8') : null;
}

export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '') || 'attachment';
}

/** Target file name inside the scenario attempt dir for a parsed SDODS attachment. */
export function targetFileFor(
  parsed: ParsedAttachment,
  original: string,
  mediaType: string,
): string {
  switch (parsed.kind) {
    case 'shot-scenario':
      return scenarioFiles.scenarioShot(parsed.phase);
    case 'shot-step':
      return scenarioFiles.stepShot(parsed.stepIndex, parsed.phase);
    case 'visual':
      return `visual/${String(parsed.stepIndex).padStart(2, '0')}-${safeName(parsed.name)}${extFor(mediaType)}`;
    case 'api':
      return scenarioFiles.apiJson(parsed.stepIndex, parsed.callIndex, parsed.part);
    case 'perf':
      return scenarioFiles.perfJson(parsed.stepIndex);
    case 'a11y':
      return scenarioFiles.a11yJson(parsed.stepIndex);
    case 'heal':
      return `heal/${String(parsed.stepIndex).padStart(2, '0')}-${parsed.n}.json`;
    case 'cleanup-errors':
      return 'cleanup-errors.json';
    case 'meta':
      return scenarioFiles.meta;
    case 'pw-visual':
      return `visual/${safeName(parsed.name)}-${parsed.phase}.png`;
    case 'pw-builtin':
      return parsed.name === 'trace'
        ? 'trace.zip'
        : parsed.name === 'video'
          ? `video${extFor(mediaType) || '.webm'}`
          : 'failure-pw.png';
    default:
      return `attachments/${safeName(original)}${extFor(mediaType)}`;
  }
}

export function extFor(mediaType: string): string {
  if (!mediaType) return '';
  if (mediaType.includes('png')) return '.png';
  if (mediaType.includes('jpeg') || mediaType.includes('jpg')) return '.jpg';
  if (mediaType.includes('webm')) return '.webm';
  if (mediaType.includes('zip')) return '.zip';
  if (mediaType.includes('json')) return '.json';
  if (mediaType.includes('html')) return '.html';
  if (mediaType.startsWith('text/')) return '.txt';
  return '';
}

/** Write bytes to `<dir>/<file>` unless an identical file already exists there; returns metadata. */
export function storeFile(
  artifactsRoot: string,
  dir: string,
  file: string,
  bytes: Buffer | null,
  sourcePath?: string,
): StoredFile | null {
  const abs = join(dir, file);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs)) {
    if (bytes) writeFileSync(abs, bytes);
    else if (sourcePath && existsSync(sourcePath)) copyFileSync(sourcePath, abs);
    else return null;
  }
  const data = readFileSync(abs);
  const dims = pngDimensions(data);
  return {
    relPath: relative(artifactsRoot, abs).replace(/\\/g, '/'),
    absPath: abs,
    sizeBytes: statSync(abs).size,
    sha256: createHash('sha256').update(data).digest('hex'),
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  };
}

/** Read width/height from a PNG IHDR chunk. */
export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function artifactKindFor(
  parsed: ParsedAttachment,
  mediaType: string,
): { kind: string; phase: string | null; stepIndex: number | null } {
  switch (parsed.kind) {
    case 'shot-scenario':
      return {
        kind: 'screenshot',
        phase:
          parsed.phase === 'start'
            ? 'scenario-start'
            : parsed.phase === 'end'
              ? 'scenario-end'
              : 'failure',
        stepIndex: null,
      };
    case 'shot-step':
      return { kind: 'screenshot', phase: parsed.phase, stepIndex: parsed.stepIndex };
    case 'visual':
      return { kind: 'visual', phase: 'actual', stepIndex: parsed.stepIndex };
    case 'pw-visual':
      return { kind: 'visual', phase: parsed.phase, stepIndex: null };
    case 'pw-builtin':
      return {
        kind: parsed.name === 'screenshot' ? 'screenshot' : parsed.name,
        phase: parsed.name === 'screenshot' ? 'failure' : null,
        stepIndex: null,
      };
    case 'api':
    case 'heal':
    case 'perf':
    case 'a11y':
    case 'cleanup-errors':
    case 'meta':
      return {
        kind: 'attachment',
        phase: null,
        stepIndex: 'stepIndex' in parsed ? (parsed as any).stepIndex : null,
      };
    default:
      return {
        kind: mediaType.startsWith('image/')
          ? 'screenshot'
          : mediaType.includes('zip')
            ? 'trace'
            : 'attachment',
        phase: null,
        stepIndex: null,
      };
  }
}

export { parseAttachmentName, basename };
