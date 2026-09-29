/**
 * Masks credentials pasted into a post before it is stored, shown, or sent to the reviewer.
 *
 * People paste whole config files and HAR snippets when asking why a run fails, and those carry
 * keys. A masked key is still recognisable as "an API key was here", which is all an answerer
 * needs. The patterns are the high-confidence ones: a false positive costs a few characters of a
 * post, a false negative publishes someone's credential.
 */

interface Pattern {
  name: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // `password: hunter2`, `"apiKey": "…"`, `Authorization: Bearer …` — keep the name, mask the value.
  {
    name: 'labelled-secret',
    re: /\b((?:pass(?:word)?|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"',}]{6,})/gi,
  },
  { name: 'bearer', re: /\b(Bearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/g },
  { name: 'url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi },
];

export interface Redaction {
  text: string;
  /** Names of the patterns that matched, one per match. Stored with the review, never the values. */
  found: string[];
}

export function redact(input: string): Redaction {
  const found: string[] = [];
  let text = input;
  for (const { name, re } of PATTERNS) {
    text = text.replace(re, (...m: string[]) => {
      found.push(name);
      // Patterns with a captured label keep the label (and any trailing delimiter) and mask the rest.
      if (name === 'labelled-secret' || name === 'bearer') return `${m[1]}[redacted]`;
      if (name === 'url-credentials') return `${m[1]}[redacted]${m[3]}`;
      return `[redacted ${name}]`;
    });
  }
  return { text, found };
}
