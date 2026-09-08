import type { Thread } from '../types';
import { configThreads } from './config';
import { dataThreads } from './data';
import { defectsThreads } from './defects';
import { harThreads } from './har';
import { healThreads } from './heal';
import { installThreads } from './install';
import { lintThreads } from './lint';
import { mcpThreads } from './mcp';
import { pagesThreads } from './pages';
import { recordingThreads } from './recording';
import { reportingThreads } from './reporting';
import { runningThreads } from './running';
import { visualThreads } from './visual';

/**
 * Every thread, in one array. Split by topic family across thirteen files so that the archive can
 * be written by many hands at once without two of them ever opening the same file — this
 * aggregator is the only place that knows about all of them, and nothing but an added family
 * should ever change it.
 */
export const ALL_THREADS: Thread[] = [
  ...configThreads,
  ...dataThreads,
  ...defectsThreads,
  ...harThreads,
  ...healThreads,
  ...installThreads,
  ...lintThreads,
  ...mcpThreads,
  ...pagesThreads,
  ...recordingThreads,
  ...reportingThreads,
  ...runningThreads,
  ...visualThreads,
];
