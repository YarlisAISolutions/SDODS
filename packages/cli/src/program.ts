import { Command } from 'commander';
import { VERSION } from '@sdods/core';
import { SPONSOR_ENABLED, SPONSOR_URL } from '@sdods/contracts/sponsor';
import { registerProjectCommands } from './commands/project.js';
import { registerEnvCommands } from './commands/env.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { register as registerRun } from './commands/run.js';
import { register as registerLint } from './commands/lint.js';
import { register as registerInit } from './commands/init.js';
import { register as registerAnalyze } from './commands/analyze.js';
import { register as registerRecord } from './commands/record.js';
import { register as registerHar } from './commands/har.js';
import { register as registerAuth } from './commands/auth.js';
import { register as registerData } from './commands/data.js';
import { register as registerDb } from './commands/db.js';
import { register as registerReport } from './commands/report.js';
import { register as registerHeal } from './commands/heal.js';
import { register as registerInsights } from './commands/insights.js';
import { register as registerSteps } from './commands/steps.js';
import { register as registerFeatures } from './commands/features.js';
import { register as registerCoverage } from './commands/coverage.js';
import { register as registerBrowsers } from './commands/browsers.js';
import { register as registerWatch } from './commands/watch.js';
import { register as registerTrace } from './commands/trace.js';
import { register as registerBaselines } from './commands/baselines.js';
import { register as registerAgent } from './commands/agent.js';
import { register as registerProposals } from './commands/proposals.js';
import { register as registerMcp } from './commands/mcp.js';
import { register as registerSkills } from './commands/skills.js';
import { register as registerServe } from './commands/serve.js';
import { register as registerUsers } from './commands/users.js';
import { register as registerTokens } from './commands/tokens.js';
import { register as registerSchedule } from './commands/schedule.js';
import { register as registerIntegrations } from './commands/integrations.js';
import { register as registerCompletion } from './commands/completion.js';
import { register as registerUpgrade } from './commands/upgrade.js';
import { register as registerFeedback } from './commands/feedback.js';
import { register as registerLoad } from './commands/load.js';
import { register as registerMatrix } from './commands/matrix.js';

/**
 * All commands are registered eagerly (cheap) but each module keeps heavy imports
 * (server, agents, DB, browser runner) inside its action via dynamic import.
 */
export function buildProgram(): Command {
  const program = new Command('sdods');
  program
    .description(
      'SDODS — automation and orchestration for reliable business workflows: BDD for UI, API and hybrid flows.',
    )
    .version(VERSION, '-V, --version')
    .option('--json', 'machine-readable output')
    .option('-q, --quiet', 'only errors')
    .option('--verbose', 'debug logging')
    .option('--cwd <dir>', 'repo root (default: auto-detect from the current directory)')
    .option('--no-color', 'disable colours')
    .showHelpAfterError('(add --help for usage)')
    .showSuggestionAfterError()
    .configureHelp({ sortSubcommands: true })
    // Root help only: 'after' is not inherited by subcommands.
    .addHelpText(
      'after',
      `\nDocs: https://docs.sdods.com${SPONSOR_ENABLED ? `  ·  Sponsor: ${SPONSOR_URL}` : ''}`,
    );

  registerProjectCommands(program);
  registerEnvCommands(program);
  registerConfigCommands(program);
  registerDoctorCommand(program);
  registerWorkspaceCommands(program);
  registerRun(program);
  registerLint(program);
  registerInit(program);
  registerAnalyze(program);
  registerRecord(program);
  registerHar(program);
  registerAuth(program);
  registerData(program);
  registerDb(program);
  registerReport(program);
  registerHeal(program);
  registerInsights(program);
  registerSteps(program);
  registerFeatures(program);
  registerCoverage(program);
  registerBrowsers(program);
  registerWatch(program);
  registerTrace(program);
  registerBaselines(program);
  registerAgent(program);
  registerProposals(program);
  registerMcp(program);
  registerSkills(program);
  registerServe(program);
  registerUsers(program);
  registerTokens(program);
  registerSchedule(program);
  registerIntegrations(program);
  registerCompletion(program);
  registerUpgrade(program);
  registerFeedback(program);
  registerLoad(program);
  registerMatrix(program);
  return program;
}
