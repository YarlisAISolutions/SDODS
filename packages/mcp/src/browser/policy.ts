/**
 * What the wrapper refuses, and what it never lets back out.
 *
 * Applied in the driver rather than in each tool, so a tool cannot forget to call it.
 */

/** Header lines whose value must never reach a transcript. */
const SECRET_HEADER =
  /^(\s*[-*]?\s*)(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token)(\s*:\s*)(.+)$/gim;

/**
 * Network results come back as TEXT, so the keyed-object redactor used elsewhere in SDODS does not
 * apply — headers arrive as `authorization: Bearer ey...` inside a formatted block.
 *
 * Bodies are deliberately not regex-scrubbed: Playwright's own `--secrets` masks known values at
 * capture time, which a post-hoc guess cannot do without also mangling legitimate content.
 */
export function redactHeaders(text: string): string {
  return text.replace(SECRET_HEADER, (_m, lead, name, sep) => `${lead}${name}${sep}***`);
}

/**
 * Arbitrary-code tools are off unless explicitly enabled.
 *
 * A scope alone is not enough: the stdio principal is LOCAL_ADMIN and holds every scope, so on a
 * developer machine `browser_run_code_unsafe` would otherwise always be available. This is the
 * switch an operator can set for a deployment; the scope is what governs HTTP principals.
 */
export function unsafeToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SDODS_BROWSER_ALLOW_UNSAFE;
  return raw === '1' || raw === 'true';
}

export const UNSAFE_DISABLED_HINT =
  'Set SDODS_BROWSER_ALLOW_UNSAFE=1 to enable it. It runs caller-supplied code, which upstream documents as RCE-equivalent.';
