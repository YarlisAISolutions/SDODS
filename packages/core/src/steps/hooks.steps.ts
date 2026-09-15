// Registers the screenshot-narrative, finalize, browser-skip, HAR, @a11y and @perf hooks when bddgen loads the core step glob.
import '../shots/hooks.js';
// After the screenshot hooks: after-hooks run in reverse order, so these run before sdods:finalize.
import '../quality/hooks.js';
import { registerHarHooks } from '../har/hooks.js';
import { Before } from '../fixtures/test.js';

registerHarHooks({ Before });
