import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { parseDocument } from 'yaml';
import { AutomaxError, PROJECT_FILE } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, table } from '../ui.js';

export function registerEnvCommands(program: Command) {
  const env = program.command('env').description('Manage project environments');

  env
    .command('list')
    .description('List environments of a project')
    .requiredOption('-p, --project <slug>', 'project slug')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const e = ctx.registry.entry(opts.project);
      const rows = e.config.envs.available.map((name) => {
        let ui = '';
        let api = '';
        let status = 'ok';
        try {
          const cfg = ctx.registry.resolve(e.slug, name, {}, { ...process.env });
          ui = cfg.env.ui.baseUrl;
          api = cfg.env.api.baseUrl;
        } catch (err) {
          status = (err as Error).message.split('\n')[0]!;
        }
        return { name, default: name === e.config.envs.default ? '*' : '', ui, api, status };
      });
      if (ctx.opts.json) return json(rows);
      table(rows);
    });

  env
    .command('add <name>')
    .description('Create envs/<name>.yaml and register it in envs.available')
    .requiredOption('-p, --project <slug>', 'project slug')
    .requiredOption('--ui-url <url>', 'UI base URL')
    .requiredOption('--api-url <url>', 'API base URL')
    .option('--default', 'make it the default environment')
    .option('--pool-size <n>', 'user pool size', '2')
    .action((name: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const e = ctx.registry.entry(opts.project);
      const file = join(e.root, 'envs', `${name}.yaml`);
      if (existsSync(file))
        throw new AutomaxError('CONFIG_INVALID', `${file} already exists.`, { exitCode: 2 });
      writeFileSync(
        file,
        `name: ${name}\nui:\n  baseUrl: ${opts.uiUrl}\napi:\n  baseUrl: ${opts.apiUrl}\n  headers: { Accept: application/json }\n  auth: { type: none }\nusers:\n  poolSize: ${Number(opts.poolSize)}\nvars: {}\n`,
      );
      const projectFile = join(e.root, PROJECT_FILE);
      const doc = parseDocument(readFileSync(projectFile, 'utf8'));
      const available = doc.getIn(['envs', 'available']);
      const list = Array.isArray((available as any)?.items)
        ? ((available as any).items.map((i: any) => String(i.value ?? i)) as string[])
        : [];
      if (!list.includes(name)) doc.setIn(['envs', 'available'], [...list, name]);
      if (opts.default) doc.setIn(['envs', 'default'], name);
      writeFileSync(projectFile, doc.toString({ lineWidth: 100 }));
      if (ctx.opts.json) return json({ project: e.slug, env: name, file });
      ok(`Added environment ${name} → ${file}`);
    });
}
