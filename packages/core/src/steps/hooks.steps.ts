// Registers the screenshot-narrative, finalize, browser-skip and HAR hooks when bddgen loads the core step glob.
import '../shots/hooks.js';
import { registerHarHooks } from '../har/hooks.js';
import { Before } from '../fixtures/test.js';

registerHarHooks({ Before });
