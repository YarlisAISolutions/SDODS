import { buildProgram } from './program.js';
import { renderError } from './ui.js';

const program = buildProgram();
try {
  await program.parseAsync(process.argv);
} catch (e) {
  const code = renderError(e, program.opts().json === true);
  process.exitCode = code;
}
