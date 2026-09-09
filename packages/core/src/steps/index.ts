/**
 * Core step library. Importing this module registers every shared step and the screenshot hooks.
 * bddgen loads these files through `coreStepsGlob()`; this index exists for programmatic use.
 */
import './params.js';
import './api.steps.js';
import './ui.steps.js';
import './data.steps.js';
import './hybrid.steps.js';
import './iframe.steps.js';
import './tabs.steps.js';
import './db.steps.js';
import './clock.steps.js';
import './webhook.steps.js';
import './a11y.steps.js';
import './browser.steps.js';
import './dom.steps.js';
import './net.steps.js';
import './perf.steps.js';
import '../shots/hooks.js';

export { coreStepsGlob, coreStepsPatterns, coreStepNames, coreStepsDir } from './glob.js';
