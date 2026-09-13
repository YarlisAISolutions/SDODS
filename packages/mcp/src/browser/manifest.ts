import type { UpstreamToolName } from './shapes.js';

/**
 * The SDODS view of each Playwright MCP tool: what it costs a caller, and who may call it.
 *
 * Kept separate from `shapes.ts` (generated) because these are judgements, not transcription. They
 * are also the only place the wrapper differs from upstream on purpose, so the differences are
 * reviewable in one screen rather than spread across 42 definitions.
 */
export type BrowserAccess = 'read' | 'write';

/** Which `--caps` pack the child needs before the tool exists at all. */
export type CapsPack = 'default' | 'vision' | 'pdf' | 'devtools';

export interface BrowserToolSpec {
  pack: CapsPack;
  access: BrowserAccess;
  /** Overrides the access/domain scope derivation. Used to keep the two RCE-shaped tools apart. */
  scope?: 'browser:admin';
  /** Appended to the upstream description; says what SDODS adds or restricts. */
  note?: string;
}

/**
 * `read` vs `write` rather than `run`: `run` derives `runs:write` through `scopeForToolAccess`,
 * which is the wrong scope for a browser and would hand browser control to anything that may
 * start a test.
 *
 * Two deliberate divergences from upstream's own annotations:
 *  - `browser_take_screenshot` and `browser_pdf_save` write files, and upstream still marks them
 *    read-only. They stay `read` here because they only write into the session's own output
 *    directory, but the note says so rather than leaving it implied.
 *  - Everything that changes page state is `write`, including `browser_navigate`, which upstream
 *    does not flag. Navigating away is not an observation.
 */
export const BROWSER_TOOLS: Record<UpstreamToolName, BrowserToolSpec> = {
  // ---- observe -----------------------------------------------------------------------------
  browser_snapshot: { pack: 'default', access: 'read' },
  browser_find: { pack: 'default', access: 'read' },
  browser_console_messages: { pack: 'default', access: 'read' },
  browser_network_requests: { pack: 'default', access: 'read' },
  browser_network_request: {
    pack: 'default',
    access: 'read',
    note: 'Authorization, cookie and API-key headers are redacted before the result is returned.',
  },
  browser_take_screenshot: {
    pack: 'default',
    access: 'read',
    note: 'Returns the image inline; a `filename` writes into the session output directory only.',
  },
  browser_wait_for: { pack: 'default', access: 'read' },

  // ---- act ---------------------------------------------------------------------------------
  browser_navigate: { pack: 'default', access: 'write' },
  browser_navigate_back: { pack: 'default', access: 'write' },
  browser_click: { pack: 'default', access: 'write' },
  browser_type: { pack: 'default', access: 'write' },
  browser_fill_form: { pack: 'default', access: 'write' },
  browser_press_key: { pack: 'default', access: 'write' },
  browser_hover: { pack: 'default', access: 'write' },
  browser_drag: { pack: 'default', access: 'write' },
  browser_drop: { pack: 'default', access: 'write' },
  browser_select_option: { pack: 'default', access: 'write' },
  browser_file_upload: {
    pack: 'default',
    access: 'write',
    note: 'Paths resolve inside the repository root the server was started in.',
  },
  browser_resize: { pack: 'default', access: 'write' },
  browser_tabs: { pack: 'default', access: 'write' },
  browser_handle_dialog: { pack: 'default', access: 'write' },
  browser_close: {
    pack: 'default',
    access: 'write',
    note: 'Closes the page. The session and its browser stay up — use browser_session_close to end the session.',
  },

  // ---- arbitrary code: the two that are RCE-shaped ------------------------------------------
  browser_evaluate: {
    pack: 'default',
    access: 'write',
    scope: 'browser:admin',
    note: 'Runs caller-supplied JavaScript in the page. Off unless SDODS_BROWSER_ALLOW_UNSAFE is set.',
  },
  browser_run_code_unsafe: {
    pack: 'default',
    access: 'write',
    scope: 'browser:admin',
    note: 'Executes arbitrary JavaScript in the Playwright server process — upstream calls this RCE-equivalent. Off unless SDODS_BROWSER_ALLOW_UNSAFE is set.',
  },

  // ---- vision: coordinate input, no accessibility tree --------------------------------------
  browser_mouse_move_xy: { pack: 'vision', access: 'write' },
  browser_mouse_click_xy: { pack: 'vision', access: 'write' },
  browser_mouse_drag_xy: { pack: 'vision', access: 'write' },
  browser_mouse_down: { pack: 'vision', access: 'write' },
  browser_mouse_up: { pack: 'vision', access: 'write' },
  browser_mouse_wheel: { pack: 'vision', access: 'write' },

  // ---- pdf ----------------------------------------------------------------------------------
  browser_pdf_save: {
    pack: 'pdf',
    access: 'read',
    note: 'Writes into the session output directory only.',
  },

  // ---- devtools: tracing, video, annotation -------------------------------------------------
  browser_start_tracing: { pack: 'devtools', access: 'read' },
  browser_stop_tracing: { pack: 'devtools', access: 'read' },
  browser_start_video: { pack: 'devtools', access: 'read' },
  browser_stop_video: { pack: 'devtools', access: 'read' },
  browser_video_chapter: { pack: 'devtools', access: 'read' },
  browser_video_show_actions: { pack: 'devtools', access: 'read' },
  browser_video_hide_actions: { pack: 'devtools', access: 'read' },
  browser_start_recording: {
    pack: 'devtools',
    access: 'read',
    note: 'Records what a person does in the browser; pair with browser_stop_recording. Not for unattended runs.',
  },
  browser_stop_recording: { pack: 'devtools', access: 'read' },
  browser_highlight: { pack: 'devtools', access: 'write' },
  browser_hide_highlight: { pack: 'devtools', access: 'write' },
  browser_annotate: {
    pack: 'devtools',
    access: 'write',
    note: 'Waits for a person to draw in the browser, so it blocks until they finish. Not for unattended runs.',
  },
  browser_resume: { pack: 'devtools', access: 'write' },
};

/** Tools gated behind the unsafe opt-in. */
export const UNSAFE_TOOLS = (Object.keys(BROWSER_TOOLS) as UpstreamToolName[]).filter(
  (n) => BROWSER_TOOLS[n].scope === 'browser:admin',
);
