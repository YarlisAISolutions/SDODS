/**
 * Constants electron-vite substitutes at build time (`define` in electron.vite.config.ts).
 *
 * Read them through `typeof` guards: under vitest nothing substitutes them, and a bare reference
 * would throw a ReferenceError instead of reading as "not set".
 */

/** True when this build is Developer ID signed. Arms the macOS updater. */
declare const __DESKTOP_SIGNED__: boolean;
