/**
 * Core step library. Importing this module registers every shared step and the screenshot hooks.
 * bddgen loads these files through `coreStepsGlob()`; this index exists for programmatic use.
 */
import './params.js';
import './api.steps.js';
import './ui.steps.js';
import './data.steps.js';
import './hybrid.steps.js';
import '../shots/hooks.js';

export { coreStepsGlob, coreStepsDir } from './glob.js';
