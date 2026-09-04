import { ToolRegistry, type SdodsTool } from '../registry/registry.js';
import { analyzeTools } from './analyze.js';
import { dataTools } from './data.js';
import { featureTools } from './feature.js';
import { issueTools, scheduleTools } from './issue-schedule.js';
import { projectTools } from './project.js';
import { proposalTools } from './proposal.js';
import { runTools } from './run.js';

export const ALL_TOOLS: Array<SdodsTool<any>> = [
  ...projectTools,
  ...featureTools,
  ...runTools,
  ...dataTools,
  ...analyzeTools,
  ...issueTools,
  ...scheduleTools,
  ...proposalTools,
];

export function createRegistry(extra: Array<SdodsTool<any>> = []): ToolRegistry {
  return new ToolRegistry().registerAll(ALL_TOOLS).registerAll(extra);
}

export {
  analyzeTools,
  dataTools,
  featureTools,
  issueTools,
  projectTools,
  proposalTools,
  runTools,
  scheduleTools,
};
