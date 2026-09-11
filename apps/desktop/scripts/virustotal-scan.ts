/**
 * Submit the built installers to VirusTotal and report what its engines say.
 *
 * The point is **false positives**, not malware. An unsigned Electron app that bundles a Node
 * runtime and spawns child processes looks, to a heuristic scanner, a lot like something it should
 * flag. Finding that out from a user who has already downloaded 130 MB and been told the file is a
 * trojan is the worst way to learn it. This runs on every tagged build, in parallel with the
 * release job, so whoever publishes the draft can read the verdict first.
 *
 * Deliberately **never fails on detections.** Low-tier engines flag builds like this routinely, and
 * any threshold picked today is wrong by the next release. The output is a table a person reads;
 * the existing draft-release gate is what stops a bad build. Only infrastructure problems — a
 * rejected key, a network failure — are worth a non-zero exit.
 *
 *   VIRUSTOTAL_API_KEY=... node --import tsx scripts/virustotal-scan.ts artifacts/*.exe
 *
 * With no key it prints a line and exits 0, matching how the signing credentials behave: absent
 * means "not configured", not "broken".
 */
import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { appendFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const API = 'https://www.virustotal.com/api/v3';

/**
 * The public API allows 4 requests/minute. 16s between calls keeps us under it with room for
 * clock skew. Uploads are excluded: they go to a signed storage URL, not the API host.
 */
const RATE_LIMIT_MS = 16_000;

/** `POST /files` caps at 32 MB. Everything we ship is larger, hence the upload_url dance below. */
const DIRECT_UPLOAD_MAX = 32 * 1024 * 1024;

/** Analysis of a 250 MB binary is not quick. Past this we report "queued" and link out. */
const POLL_BUDGET_MS = 25 * 60_000;

interface Stats {
  malicious: number;
  suspicious: number;
  undetected: number;
  harmless: number;
}

interface Result {
  file: string;
  sha256: string;
  size: number;
  stats?: Stats;
  /** Set when there is no verdict to show: still analyzing, too large to submit, or an error. */
  note?: string;
}

let lastCall = 0;

/** Serialise API calls far enough apart to stay inside the public quota. */
async function throttle(): Promise<void> {
  const wait = lastCall + RATE_LIMIT_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function api(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  await throttle();
  return fetch(`${API}${path}`, {
    ...init,
    headers: { 'x-apikey': key, ...(init.headers ?? {}) },
  });
}

/** Hash without reading the whole file into memory — the universal Windows installer is ~250 MB. */
function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Ask VirusTotal whether it has already seen this exact build.
 *
 * On a fresh tag this always misses — the bytes are new, so nothing can know them — and every file
 * goes on to be uploaded. That is expected, and the lookup is still worth doing: re-running a
 * workflow on the same tag then costs one cheap request per file instead of re-uploading 1.5 GB.
 * Do not "optimise" it away on the grounds that it never hits on the run you happened to watch.
 */
async function lookup(hash: string, key: string): Promise<Stats | null> {
  const res = await api(`/files/${hash}`, key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lookup failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { data: { attributes: { last_analysis_stats: Stats } } };
  return body.data.attributes.last_analysis_stats;
}

/**
 * Upload a file too big for `POST /files`.
 *
 * `GET /files/upload_url` hands back a one-shot URL that accepts up to 650 MB. Whether it is
 * available on the free tier has changed over time and the docs contradict themselves, so a 403
 * is treated as a tier limitation rather than an error: the file is reported as unscannable on
 * this key and the run continues. Every installer we ship is over the 32 MB direct limit, so on a
 * key without this endpoint the scan degrades to hash lookups only — which is worth saying out
 * loud in the summary rather than quietly producing an empty table.
 */
async function upload(path: string, key: string): Promise<string> {
  const size = (await stat(path)).size;

  let target = `${API}/files`;
  if (size > DIRECT_UPLOAD_MAX) {
    const res = await api('/files/upload_url', key);
    if (res.status === 403)
      throw new TierError('needs a VirusTotal tier that allows large uploads');
    if (!res.ok) throw new Error(`upload_url failed (${res.status}): ${await res.text()}`);
    target = ((await res.json()) as { data: string }).data;
  }

  // openAsBlob streams from disk instead of buffering the whole installer in memory.
  const form = new FormData();
  form.append('file', await openAsBlob(path), basename(path));

  // Not throttled: the signed upload URL is separate infrastructure from the rate-limited API.
  const res = await fetch(target, { method: 'POST', headers: { 'x-apikey': key }, body: form });
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

/** A limitation of the API key, not a failure of the run. */
class TierError extends Error {}

async function analysis(id: string, key: string): Promise<Stats | null> {
  const res = await api(`/analyses/${id}`, key);
  if (!res.ok) throw new Error(`analysis poll failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as {
    data: { attributes: { status: string; stats: Stats } };
  };
  return body.data.attributes.status === 'completed' ? body.data.attributes.stats : null;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function render(results: Result[]): string {
  const rows = results
    .map((r) => {
      const link = `https://www.virustotal.com/gui/file/${r.sha256}`;
      const verdict = r.stats
        ? `${r.stats.malicious} malicious · ${r.stats.suspicious} suspicious · ${r.stats.undetected} clean`
        : (r.note ?? 'no result');
      const flag = r.stats && r.stats.malicious + r.stats.suspicious > 0 ? ' ⚠️' : '';
      return `| \`${r.file}\` | ${mb(r.size)} | ${verdict}${flag} | [report](${link}) |`;
    })
    .join('\n');

  const flagged = results.filter((r) => r.stats && r.stats.malicious + r.stats.suspicious > 0);
  const scanned = results.filter((r) => r.stats);
  // "No detections" across a table of errors would be an outright lie: nothing was scanned, so
  // nothing could be detected. Say which of the two happened.
  const note = flagged.length
    ? `\n⚠️ ${flagged.length} file(s) drew at least one detection. A handful of heuristic hits is normal for an unsigned Electron app — open the reports and check **which** engines, and whether they are ones anyone runs, before treating it as real.\n`
    : scanned.length
      ? `\n✅ No detections across ${scanned.length} file(s).\n`
      : '\n**Nothing was scanned** — every file is listed with a reason above. This is not a clean result.\n';

  return [
    '## VirusTotal',
    '',
    '| File | Size | Engines | |',
    '| --- | --- | --- | --- |',
    rows,
    note,
  ].join('\n');
}

async function main(): Promise<void> {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) {
    console.log('virustotal: skipped — VIRUSTOTAL_API_KEY is not set');
    return;
  }

  const files = process.argv.slice(2);
  if (!files.length) {
    console.log('virustotal: nothing to scan');
    return;
  }

  const results: Result[] = [];
  const pending: { result: Result; id: string }[] = [];

  // Submit everything first, then poll. Uploading one file and waiting for its verdict before
  // starting the next would serialise ~25 minutes of analysis behind ~25 minutes of uploads.
  for (const file of files) {
    const name = basename(file);
    const result: Result = { file: name, sha256: '', size: (await stat(file)).size };
    results.push(result);
    try {
      result.sha256 = await sha256(file);
      const known = await lookup(result.sha256, key);
      if (known) {
        result.stats = known;
        console.log(`virustotal: ${name} already known`);
        continue;
      }
      pending.push({ result, id: await upload(file, key) });
      console.log(`virustotal: ${name} uploaded`);
    } catch (err) {
      result.note =
        err instanceof TierError ? `not submitted — ${err.message}` : `error — ${String(err)}`;
      console.log(`virustotal: ${name} — ${result.note}`);
    }
  }

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (pending.length && Date.now() < deadline) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const { result, id } = pending[i];
      try {
        const stats = await analysis(id, key);
        if (stats) {
          result.stats = stats;
          pending.splice(i, 1);
          console.log(`virustotal: ${result.file} analysed`);
        }
      } catch (err) {
        result.note = `error — ${String(err)}`;
        pending.splice(i, 1);
      }
    }
  }
  for (const { result } of pending) {
    result.note = 'still analysing — open the report';
  }

  const summary = render(results);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

// Detections never fail the job; only the harness failing to run does.
main().catch((err) => {
  console.error(`virustotal: ${err}`);
  process.exit(1);
});
