/**
 * An OAuth access token for the service account the process runs as, from the GCE / Cloud Run
 * metadata server. Cached until a minute before it expires.
 */
export function metadataToken(fetchImpl: typeof fetch = fetch): () => Promise<string> {
  let cached: { token: string; expires: number } | undefined;
  return async () => {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  };
}
