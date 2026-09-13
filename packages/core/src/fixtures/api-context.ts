import type { ApiSnapshot } from '@sdods/contracts';

/** Per-scenario API state: last response, chained variables, pending headers/query. No module globals. */
export class ApiContext {
  readonly vars = new VarStore();
  readonly headers = new Map<string, string>();
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
