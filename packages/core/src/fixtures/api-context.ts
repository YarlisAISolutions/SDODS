import type { ApiSnapshot } from '@sdods/contracts';

/**
 * A `Map` of HTTP header names to values whose names are case-insensitive, as HTTP's are.
 *
 * Names are stored lower-cased, so `set('X-API-Key')` followed by `delete('x-api-key')` removes
 * the header, `get('cookie')` finds a header set as `Cookie`, and when a scenario sets the same
 * header under two casings the last `set` wins. The client lower-cases names when it builds a
 * request anyway, so what goes on the wire and into the evidence is unchanged.
 *
 * A plain `new Map(headers)` clone keeps the lower-cased names; restore it by `set`-ting each
 * entry back into this map rather than replacing it.
 */
export class HeaderMap extends Map<string, string> {
  // No constructor: Map's constructor adds iterable entries through `this.set`, so they normalise too.
  override set(name: string, value: string): this {
    return super.set(name.toLowerCase(), value);
  }
  override get(name: string): string | undefined {
    return super.get(name.toLowerCase());
  }
  override has(name: string): boolean {
    return super.has(name.toLowerCase());
  }
  override delete(name: string): boolean {
    return super.delete(name.toLowerCase());
  }
}

/** Per-scenario API state: last response, chained variables, pending headers/query. No module globals. */
export class ApiContext {
  readonly vars = new VarStore();
  /** Pending request headers. Names are case-insensitive (stored lower-cased). */
  readonly headers = new HeaderMap();
  readonly query = new Map<string, string>();
  readonly history: ApiSnapshot[] = [];
  /**
   * Scenario-level auth override.
   *
   * Three states, and the difference between the last two is load-bearing:
   *   a value   use this credential
   *   undefined UNSET — fall back to the environment's `api.auth`
   *   null      explicitly NONE — send the request unauthenticated
   *
   * Before this distinction existed, `I use no authentication` assigned
   * `undefined` and therefore fell straight back to the environment credential,
   * silently authenticating the very request the scenario was asserting is
   * refused. Any suite whose env declared `api.auth` had a no-op step.
   */
  auth:
    | { type: 'bearer'; token: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'header'; name: string; value: string }
    | null
    | undefined;
  /**
   * Send through a request context with an empty cookie jar instead of the shared `request`
   * fixture. On @ui/@hybrid the shared context starts from the leased role's storageState, so a
   * "credential X alone is refused" assertion would otherwise pass on the session cookie.
   * Set by `I use an isolated API client`.
   */
  isolated = false;
  /** step index → number of calls made during that step (for attachment numbering) */
  readonly callsByStep = new Map<number, number>();

  get lastResponse(): ApiSnapshot['response'] | undefined {
    return this.history.at(-1)?.response;
  }

  last(): ApiSnapshot {
    const snap = this.history.at(-1);
    if (!snap) {
      throw new Error(
        'No API request has been made in this scenario yet. Send a request before asserting on the response.',
      );
    }
    return snap;
  }

  record(snapshot: ApiSnapshot, stepIndex: number): number {
    this.history.push(snapshot);
    const n = (this.callsByStep.get(stepIndex) ?? 0) + 1;
    this.callsByStep.set(stepIndex, n);
    return n;
  }

  resetRequestState() {
    this.headers.clear();
    this.query.clear();
  }
}

export class VarStore {
  private readonly map = new Map<string, unknown>();

  set(name: string, value: unknown) {
    this.map.set(name, value);
  }
  setAll(values: Record<string, unknown>) {
    for (const [k, v] of Object.entries(values)) this.map.set(k, v);
  }
  get<T = unknown>(name: string): T | undefined {
    return this.map.get(name) as T | undefined;
  }
  has(name: string) {
    return this.map.has(name);
  }
  toObject(): Record<string, unknown> {
    return Object.fromEntries(this.map);
  }
}
