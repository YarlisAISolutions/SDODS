import { ToolRegistry, type AutomaxTool } from '../registry/registry.js';
import { analyzeTools } from './analyze.js';
import { dataTools } from './data.js';
import { featureTools } from './feature.js';
import { issueTools, scheduleTools } from './issue-schedule.js';
import { projectTools } from './project.js';
import { proposalTools } from './proposal.js';
import { runTools } from './run.js';

export const ALL_TOOLS: Array<AutomaxTool<any>> = [
  ...projectTools,
  ...featureTools,
  ...runTools,
  ...dataTools,
  ...analyzeTools,
  ...issueTools,
  ...scheduleTools,
  ...proposalTools,
];

export function createRegistry(extra: Array<AutomaxTool<any>> = []): ToolRegistry {
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
