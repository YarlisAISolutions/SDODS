/** Header comment written at the top of every recorded spec. */
export interface RecordingMeta {
  project: string;
  env: string;
  name: string;
  recordedAt: string;
  url?: string;
  user?: string;
  role?: string;
  device?: string;
  browser?: string;
  playwright?: string;
  har?: string;
  automaxVersion?: string;
}

export const RECORDING_HEADER_PREFIX = '// @automax-recording ';

export function formatRecordingHeader(meta: RecordingMeta): string {
  const rerun = [
    'automax record',
    `-p ${meta.project}`,
    `-e ${meta.env}`,
    `--name ${meta.name}`,
    meta.role ? `--user ${meta.role}` : '',
    meta.device ? `--device "${meta.device}"` : '',
    meta.browser && meta.browser !== 'chromium' ? `--browser ${meta.browser}` : '',
    meta.har ? '--save-har' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    `${RECORDING_HEADER_PREFIX}${JSON.stringify(meta)}`,
    `// Recorded with AutoMax. Re-record with: ${rerun}`,
    `// Convert to Gherkin (reviewed proposal): automax record convert projects/${meta.project}/recorded/${meta.name}.spec.ts`,
  ].join('\n');
}

export function parseRecordingHeader(source: string): RecordingMeta | undefined {
  const line = source.split(/\r?\n/).find((l) => l.startsWith(RECORDING_HEADER_PREFIX));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice(RECORDING_HEADER_PREFIX.length)) as RecordingMeta;
  } catch {
    return undefined;
  }
}
