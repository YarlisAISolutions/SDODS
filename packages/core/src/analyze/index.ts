export { Scan, IGNORED_DIRS, type ScanOptions, type ScannedFile } from './scan.js';
export { analyzeProject, buildChecklist, type AnalyzeOptions } from './analyze.js';
export { proposeProject, slugify, type ProposeOptions } from './propose.js';
export {
  applyProposal,
  importPlaywrightSpecs,
  type ApplyOptions,
  type ApplyResult,
} from './apply.js';
export { computeCoverage, parseFeatures, pomRouteSteps, type CoverageOptions } from './coverage.js';
export * from './detectors.js';
