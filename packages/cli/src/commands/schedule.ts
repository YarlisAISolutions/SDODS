import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { collect, info, json, ok, out, table } from '../ui.js';

async function withServices(rootDir: string) {
  const db = await import('@automax/db');
  const srv = await import('@automax/server');
  const adb = await db.openDb();
  const config = srv.loadServerConfig({ rootDir });
  const runManager = new srv.RunManager(config, adb);
  const scheduler = new srv.Scheduler(adb, runManager, {
    info: () => undefined,
    warn: (m) => console.error(m),
  });
  return { db, srv, adb, config, runManager, scheduler };
}

export function register(program: Command) {
  const schedule = program
    .command('schedule')
    .description('Cron schedules for runs (project yaml + database; the server executes them)');

  schedule
    .command('add')
    .description('Create or update a schedule')
    .requiredOption('-p, --project <slug>', 'project')
    .requiredOption('--name <name>', 'schedule name')
    .requiredOption('--cron <expr>', 'cron expression, e.g. "0 2 * * *"')
    .option('--tz <timezone>', 'IANA timezone', 'UTC')
    .option('-e, --env <name>', 'environment')
    .option('-t, --tags <expr>', 'tag expression')
    .option('-l, --layer <layer>', 'layer (repeatable)', collect, [])
    .option('-b, --browser <name>', 'browser (repeatable)', collect, [])
    .option('--process <name>', 'run a named process')
    .option('--overlap <policy>', 'skip | queue | cancel-previous', 'skip')
    .option('--jitter <seconds>', 'random start delay', '0')
    .option('--notify <list>', 'github,jira,webhook', collect, [])
    .option('--disabled', 'create disabled')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const project = ctx.registry.entry(opts.project);
      const s = await withServices(ctx.rootDir);
      try {
        const { HierarchyService } = s.srv;
        await new HierarchyService(s.adb).sync(ctx.registry);
        const row = await s.db.getProjectBySlug(s.adb.db, project.slug);
        if (!row)
          throw new AutomaxError('CONFIG_NOT_FOUND', `Project row for ${project.slug} missing.`, {
            exitCode: 2,
          });
        const next = s.srv.nextTimes(opts.cron, opts.tz, 5);
        if (!next.length)
          throw new AutomaxError('CONFIG_INVALID', `Invalid cron "${opts.cron}".`, { exitCode: 2 });
        const id = await s.db.upsertSchedule(s.adb.db, s.adb.driver, {
          projectId: row.id,
          name: opts.name,
          cronExpr: opts.cron,
          timezone: opts.tz,
          runInput: {
            env: opts.env,
            tags: opts.tags,
            layers: opts.layer.length ? opts.layer : undefined,
            browsers: opts.browser.length ? opts.browser : undefined,
            process: opts.process,
          },
          overlapPolicy: opts.overlap,
          jitterSeconds: Number(opts.jitter),
          enabled: !opts.disabled,
          notify: opts.notify,
          nextRunAt: next[0],
        });
        if (ctx.opts.json) return json({ id, nextFireTimes: next });
        ok(`Schedule ${opts.name} (${opts.cron} ${opts.tz}) saved`);
        info(`Next: ${next.slice(0, 3).join(', ')}`);
        info(
          'The server runs schedules (`automax serve`); for server-less setups use `automax schedule install`.',
        );
      } finally {
        await s.adb.close();
      }
    });

  schedule
    .command('list')
    .description('List schedules with next fire times')
    .option('-p, --project <slug>', 'project')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const s = await withServices(ctx.rootDir);
      try {
        const row = opts.project ? await s.db.getProjectBySlug(s.adb.db, opts.project) : null;
        const list = await s.scheduler.list(row?.id);
        const rows = list.map((x) => ({
          id: x.id,
          project: x.projectSlug ?? '',
          name: x.name,
          cron: x.cronExpr,
          tz: x.timezone,
          enabled: x.enabled ? 'yes' : 'no',
          next: x.nextFireTimes?.[0] ?? '',
          last: x.lastStatus ?? '',
        }));
        if (ctx.opts.json) return json(list);
        table(rows);
      } finally {
        await s.adb.close();
      }
    });

  for (const action of ['pause', 'resume', 'remove'] as const) {
    schedule
      .command(`${action} <name>`)
      .description(`${action[0]!.toUpperCase()}${action.slice(1)} a schedule by name`)
      .requiredOption('-p, --project <slug>', 'project')
      .action(async (name: string, opts, cmd) => {
        const ctx = createContext(cmd);
        const s = await withServices(ctx.rootDir);
        try {
          const row = await s.db.getProjectBySlug(s.adb.db, opts.project);
          const target = (await s.scheduler.list(row?.id)).find((x) => x.name === name);
          if (!target)
            throw new AutomaxError('CONFIG_NOT_FOUND', `Schedule ${name} not found.`, {
              exitCode: 2,
            });
          if (action === 'remove') await s.db.deleteSchedule(s.adb.db, target.id);
          else
            await s.db.updateScheduleState(
              s.adb.db,
              target.id,
              { enabled: action === 'resume' },
              s.adb.driver,
            );
          if (ctx.opts.json) return json({ id: target.id, action });
          ok(`${name}: ${action}d`);
        } finally {
          await s.adb.close();
        }
      });
  }

  schedule
    .command('run-now <name>')
    .description('Fire a schedule immediately (waits for the run to finish)')
    .requiredOption('-p, --project <slug>', 'project')
    .action(async (name: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const s = await withServices(ctx.rootDir);
      try {
        const row = await s.db.getProjectBySlug(s.adb.db, opts.project);
        const target = (await s.scheduler.list(row?.id)).find((x) => x.name === name);
        if (!target)
          throw new AutomaxError('CONFIG_NOT_FOUND', `Schedule ${name} not found.`, {
            exitCode: 2,
          });
        const r = await s.scheduler.fire(target.id, { force: true });
        if (!r.runId) throw new AutomaxError('RUN_FAILED', `Schedule did not start: ${r.skipped}`);
        info(`Started run ${r.runId}; streaming log…`);
        const job = s.runManager.get(r.runId)!;
        for await (const line of job.log.stream(0)) if (!ctx.opts.quiet) out(line.line);
        if (ctx.opts.json)
          return json({ runId: r.runId, status: job.status, exitCode: job.exitCode });
        process.exitCode = job.exitCode ?? 0;
      } finally {
        await s.adb.close();
      }
    });

  schedule
    .command('next')
    .description('Preview upcoming fire times for a cron expression')
    .requiredOption('--cron <expr>', 'cron expression')
    .option('--tz <timezone>', 'IANA timezone', 'UTC')
    .option('--count <n>', 'how many', '5')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const srv = await import('@automax/server');
      const times = srv.nextTimes(opts.cron, opts.tz, Number(opts.count));
      if (!times.length)
        throw new AutomaxError('CONFIG_INVALID', `Invalid cron "${opts.cron}".`, { exitCode: 2 });
      if (ctx.opts.json) return json({ cron: opts.cron, timezone: opts.tz, times });
      for (const t of times) out(t);
    });

  schedule
    .command('history <name>')
    .description('Show recent firings of a schedule')
    .requiredOption('-p, --project <slug>', 'project')
    .action(async (name: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const s = await withServices(ctx.rootDir);
      try {
        const row = await s.db.getProjectBySlug(s.adb.db, opts.project);
        const target = (await s.scheduler.list(row?.id)).find((x) => x.name === name);
        if (!target)
          throw new AutomaxError('CONFIG_NOT_FOUND', `Schedule ${name} not found.`, {
            exitCode: 2,
          });
        const rows = await s.db.listScheduleRuns(s.adb.db, target.id);
        if (ctx.opts.json) return json(rows);
        table(
          rows.map((r) => ({
            firedAt: String(r.fired_at),
            status: r.status,
            runId: r.run_id ?? '',
            note: r.note ?? '',
          })),
        );
      } finally {
        await s.adb.close();
      }
    });

  schedule
    .command('sync')
    .description(
      'Mirror yaml schedules (project schedules[] and processes with a schedule) into the database',
    )
    .action(async (_opts, cmd) => {
      const ctx = createContext(cmd);
      const s = await withServices(ctx.rootDir);
      try {
        await new s.srv.HierarchyService(s.adb).sync(ctx.registry);
        const n = await s.scheduler.syncFromRegistry(ctx.registry);
        if (ctx.opts.json) return json({ synced: n });
        ok(`Synced ${n} schedule(s) from yaml`);
      } finally {
        await s.adb.close();
      }
    });

  schedule
    .command('install')
    .description('Write OS/CI scheduler entries for server-less setups')
    .requiredOption('--target <kind>', 'crontab | launchd | systemd | github')
    .option('-p, --project <slug>', 'project (default: all)')
    .option('--out <dir>', 'output directory for launchd/systemd/github files')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const entries: Array<{
        project: string;
        name: string;
        cron: string;
        tz: string;
        args: string[];
      }> = [];
      for (const e of ctx.registry.entriesList()) {
        if (opts.project && e.slug !== opts.project) continue;
        for (const s of e.config.schedules) {
          const args = [
            '-p',
            e.slug,
            ...(s.env ? ['-e', s.env] : []),
            ...(s.tags ? ['-t', s.tags] : []),
            ...(s.layers ?? []).flatMap((l) => ['-l', l]),
            ...(s.browsers ?? []).flatMap((b) => ['-b', b]),
            ...(s.harMode === 'replay' ? ['--har-replay'] : []),
          ];
          entries.push({ project: e.slug, name: s.name, cron: s.cron, tz: s.timezone, args });
        }
        for (const p of ctx.registry.processesOf(e.slug))
          if (p.schedule)
            entries.push({
              project: e.slug,
              name: `process-${p.name}`,
              cron: p.schedule,
              tz: 'UTC',
              args: ['-p', e.slug, '--process', p.name],
            });
      }
      if (!entries.length)
        throw new AutomaxError('CONFIG_NOT_FOUND', 'No schedules found in project yaml files.', {
          exitCode: 2,
        });
      const bin = 'bun run automax';
      const cwd = ctx.rootDir;
      const outDir = opts.out ?? join(ctx.rootDir, '.automax', 'schedules');
      const written: string[] = [];
      if (opts.target === 'crontab') {
        const lines = entries.map(
          (e) =>
            `# automax ${e.project}/${e.name} (${e.tz})\n${e.cron} cd ${cwd} && ${bin} run ${e.args.join(' ')} --trigger schedule >> .automax/cron-${e.project}-${e.name}.log 2>&1`,
        );
        out(lines.join('\n'));
        info('\nAppend with: (crontab -l; automax schedule install --target crontab) | crontab -');
        return;
      }
      mkdirSync(outDir, { recursive: true });
      for (const e of entries) {
        if (opts.target === 'github') {
          const file = join(
            ctx.rootDir,
            '.github',
            'workflows',
            `scheduled-${e.project}-${e.name}.yml`,
          );
          mkdirSync(join(ctx.rootDir, '.github', 'workflows'), { recursive: true });
          writeFileSync(
            file,
            `name: scheduled ${e.project} ${e.name}\non:\n  schedule:\n    - cron: '${e.cron}'\n  workflow_dispatch: {}\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n      - uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: bun install\n      - run: npx playwright install --with-deps\n      - run: bun run automax run ${e.args.join(' ')} --trigger schedule --run-id sched-${e.name}-\${{ github.run_id }}\n        env:\n          AUTOMAX_SERVER_URL: \${{ secrets.AUTOMAX_SERVER_URL }}\n          AUTOMAX_TOKEN: \${{ secrets.AUTOMAX_TOKEN }}\n      - uses: actions/upload-artifact@v4\n        if: always()\n        with: { name: automax-${e.project}-${e.name}, path: .automax/runs }\n`,
          );
          written.push(file);
        } else if (opts.target === 'launchd') {
          const file = join(outDir, `com.automax.${e.project}.${e.name}.plist`);
          const [min, hour] = e.cron.split(' ');
          writeFileSync(
            file,
            `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>com.automax.${e.project}.${e.name}</string>\n  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>cd ${cwd} && ${bin} run ${e.args.join(' ')} --trigger schedule</string></array>\n  <key>StartCalendarInterval</key><dict>${/^\d+$/.test(min ?? '') ? `<key>Minute</key><integer>${min}</integer>` : ''}${/^\d+$/.test(hour ?? '') ? `<key>Hour</key><integer>${hour}</integer>` : ''}</dict>\n  <key>StandardOutPath</key><string>${cwd}/.automax/launchd-${e.name}.log</string>\n  <key>StandardErrorPath</key><string>${cwd}/.automax/launchd-${e.name}.log</string>\n</dict></plist>\n`,
          );
          written.push(file);
        } else if (opts.target === 'systemd') {
          const base = join(outDir, `automax-${e.project}-${e.name}`);
          writeFileSync(
            `${base}.service`,
            `[Unit]\nDescription=AutoMax ${e.project} ${e.name}\n\n[Service]\nType=oneshot\nWorkingDirectory=${cwd}\nExecStart=/bin/sh -c '${bin} run ${e.args.join(' ')} --trigger schedule'\n`,
          );
          writeFileSync(
            `${base}.timer`,
            `[Unit]\nDescription=AutoMax ${e.project} ${e.name} timer\n\n[Timer]\nOnCalendar=${cronToOnCalendar(e.cron)}\nPersistent=false\n\n[Install]\nWantedBy=timers.target\n`,
          );
          written.push(`${base}.service`, `${base}.timer`);
        } else
          throw new AutomaxError('CONFIG_INVALID', `Unknown target ${opts.target}.`, {
            exitCode: 2,
          });
      }
      if (ctx.opts.json) return json({ written });
      for (const f of written) ok(`wrote ${f}`);
      if (opts.target === 'launchd') info(`Load with: launchctl load ${outDir}/*.plist`);
      if (opts.target === 'systemd')
        info(
          `Install with: sudo cp ${outDir}/* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now <timer>`,
        );
      if (!existsSync(join(ctx.rootDir, '.automax')))
        mkdirSync(join(ctx.rootDir, '.automax'), { recursive: true });
    });

  schedule
    .command('export')
    .description('Print schedules from yaml as JSON')
    .action((_opts, cmd) => {
      const ctx = createContext(cmd);
      json(
        ctx.registry.entriesList().map((e) => ({
          project: e.slug,
          schedules: e.config.schedules,
          processes: ctx.registry.processesOf(e.slug).filter((p) => p.schedule),
        })),
      );
    });
}

/** Best-effort cron → systemd OnCalendar (minute hour dom month dow). */
function cronToOnCalendar(cron: string): string {
  const [min = '*', hour = '*', dom = '*', mon = '*', dow = '*'] = cron.split(/\s+/);
  const days =
    dow === '*'
      ? ''
      : dow
          .split(',')
          .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(d) % 7])
          .join(',') + ' ';
  const f = (v: string) => (v === '*' ? '*' : v.padStart(2, '0'));
  return `${days}*-${mon === '*' ? '*' : mon.padStart(2, '0')}-${dom === '*' ? '*' : dom.padStart(2, '0')} ${f(hour)}:${f(min)}:00`;
}
