import type { Command } from 'commander';
import { AutomaxError } from '@automax/core';

/** Placeholder until this command's phase is implemented. */
export function register(program: Command) {
  program
    .command('proposals')
    .description('(not implemented yet in this build)')
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => {
      throw new AutomaxError(
        'NOT_SUPPORTED',
        'automax proposals is not implemented yet in this build.',
        {
          hint: 'This command arrives in a later phase of the AutoMax roadmap.',
          exitCode: 2,
        },
      );
    });
}
