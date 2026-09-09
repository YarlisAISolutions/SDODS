import type { BrowserName } from '@sdods/contracts';

/**
 * The seam a different browser backend would plug into.
 *
 * There is one implementation today (`playwright-driver.ts`, wrapping the Playwright MCP server
 * bundled with the pinned Playwright). It exists as an interface because the obvious alternative —
 * browser-use — is a Python project whose npm namesake is an unrelated single-maintainer package,
 * so adopting it is a dependency decision this repo has not made. When it is made, it is a new
 * file here rather than an edit to 42 tool definitions.
 */
export interface BrowserDriver {
  /** Tool names the backend actually offers, for the drift check. */
  listTools(): Promise<string[]>;
  call(tool: string, args: Record<string, unknown>): Promise<DriverResult>;
  close(): Promise<void>;
  /** What the backend reported about itself, for diagnostics. */
  info(): { server: string; version: string };
}

export interface DriverResult {
  text: string;
  images: Array<{ data: string; mimeType: string }>;
  isError: boolean;
}

/** What a caller may choose when opening a session; everything else comes from project config. */
export interface BrowserSessionSpec {
  sessionId: string;
  project: string;
  env?: string;
  /** `@user:<role>` — reuses the storage state `sdods auth capture` wrote for that role. */
  role?: string;
  browser?: BrowserName;
  headed?: boolean;
  device?: string;
  viewport?: { width: number; height: number };
  caps?: Array<'vision' | 'pdf' | 'devtools'>;
  /** `none` keeps large accessibility snapshots out of every response. */
  snapshotMode?: 'full' | 'none';
  images?: 'allow' | 'omit';
}

export interface SessionInfo {
  sessionId: string;
  project: string;
  env?: string;
  role?: string;
  browser: BrowserName;
  headed: boolean;
  outputDir: string;
  openedAt: string;
  lastUsed: string;
  server: string;
}
