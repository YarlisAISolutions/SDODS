import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodType } from 'zod';
import type { Principal } from '../types.js';
import multipart from '@fastify/multipart';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import {
  audit,
  deleteSchedule,
  getDatasetRows,
  getProjectBySlug,
  listDatasets,
  listIntegrations,
  listSchedules,
  poolStatus,
  setProjectArchived,
  upsertDataset,
  upsertIntegration,
  upsertSchedule,
} from '@sdods/db';
import { PROJECT_FILE, WORKSPACE_FILE } from '@sdods/core/config';
import {
  GitHubIntegrationSchema,
  JiraIntegrationSchema,
  McpServerSchema,
  ProjectConfigSchema,
} from '@sdods/contracts';
import {
  CreateProjectBody,
  EnvBody,
  EnvNameSchema,
  FeatureWriteBody,
  ImportProjectBody,
  IntegrationsBody,
} from '../schemas/index.js';
import { badRequest, conflict, forbidden, notFound, parse, unprocessable } from '../errors.js';
import { ProjectFs } from '../services/project-fs.js';
import { runCliJson } from '../services/cli.js';
import { StepCatalog } from '../services/step-catalog.js';

export async function projectRoutes(app: FastifyInstance) {
  if (!app.hasContentTypeParser('multipart/form-data'))
    await app.register(multipart, { limits: { fileSize: app.config.ingestMaxMb * 1024 * 1024 } });
  const catalog = new StepCatalog(app.config);

  const entryOf = (slug: string) => {
    const reg = app.registry;
    if (!reg.has(slug)) throw notFound(`Project ${slug}`);
    return reg.entry(slug);
  };
  const fsOf = (slug: string) => new ProjectFs(entryOf(slug).root);

  /**
   * A workspace has to exist in *both* places to be usable. The DB check alone is not enough:
   * `POST /api/workspaces` writes only the DB, while `ProjectRegistry.discover` throws
   * CONFIG_INVALID when a project names a workspace that `sdods.workspace.yaml` does not declare.
   * Assigning a project to a DB-only workspace therefore breaks the registry for *every* project
   * on the next reload, not just this one.
   */
  const assertWorkspaceDeclared = (slug: string, fail = badRequest) => {
    const declared = app.registry.workspaceFile.workspaces.map((w) => w.slug);
    if (!declared.includes(slug))
      throw fail(`Workspace "${slug}" is not declared in ${WORKSPACE_FILE}.`, { declared });
  };

  const assertCanWriteWorkspace = async (slug: string, principal: Principal) => {
    assertWorkspaceDeclared(slug);
    const ws = (await app.hierarchy.workspaces()).find((w) => w.slug === slug);
    if (!ws) throw badRequest(`Unknown workspace ${slug}`);
    const role = await app.workspaceRoleFor(principal, ws.id);
    if (role !== 'admin' && role !== 'editor')
      throw forbidden('Editor role in the target workspace required.');
    return ws;
  };

  /** A slug that comes back after a delete must not stay flagged: `upsertProject` leaves it be. */
  const unarchive = async (slug: string) => {
    const row = await getProjectBySlug(app.adb.db, slug);
    if (row?.archived) await setProjectArchived(app.adb.db, app.adb.driver, row.id, false);
  };

  // ── projects (filtered by workspace access) ────────────────────────────
  app.get('/api/projects', { preHandler: [app.requireScope('projects:read')] }, async (req) => {
    const p = req.principal!;
    const out = [];
    for (const e of app.registry.entriesList()) {
      const row = await getProjectBySlug(app.adb.db, e.slug);
      const role = await app.workspaceRoleFor(p, row?.workspaceId ?? null);
      if (!role) continue;
      out.push({
        slug: e.slug,
        name: e.config.name,
        description: e.config.description ?? null,
        workspace: e.workspace,
        organization: e.organization,
        layers: e.config.layers,
        browsers: e.config.browsers,
        envs: e.config.envs,
        modules: e.config.modules.map((m) => ({
          name: m.name,
          title: m.title ?? m.name,
          testingTypes: m.testingTypes,
          tags: m.tags,
        })),
        // Full objects, like `modules` above and like the project detail route: the client type
        // is ProcessConfig[], and flattening to names here made the projects list render
        // "processes: , , ," because every `.name` came back undefined.
        processes: app.registry.processesOf(e.slug),
        role,
        id: row?.id ?? null,
      });
    }
    return out;
  });

  app.post(
    '/api/projects',
    { preHandler: [app.requireScope('projects:write')] },
    async (req, reply) => {
      const body = parse(CreateProjectBody, req.body);
      if (body.workspace) await assertCanWriteWorkspace(body.workspace, req.principal!);
      const args = ['project', 'create', body.slug];
      if (body.name) args.push('--name', body.name);
      if (body.description) args.push('--description', body.description);
      if (body.layers?.length) args.push('--layers', body.layers.join(','));
      if (body.browsers?.length) args.push('--browsers', body.browsers.join(','));
      if (body.uiUrl) args.push('--ui-url', body.uiUrl);
      if (body.apiUrl) args.push('--api-url', body.apiUrl);
      if (body.env) args.push('--env', body.env);
      if (body.testId) args.push('--test-id', body.testId);
      const res = await runCliJson(app.config, args);
      if (!res.ok) throw badRequest(res.error?.message ?? 'project create failed', res.error);
      if (body.workspace) {
        const fs = new ProjectFs(join(app.config.projectsDir, body.slug));
        fs.updateYaml(PROJECT_FILE, (doc) => doc.set('workspace', body.workspace));
      }
      const registry = app.reloadRegistry();
      await app.hierarchy.sync(registry);
      await unarchive(body.slug);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'project.create',
        targetType: 'project',
        targetId: body.slug,
      });
      reply.code(201);
      return res.data;
    },
  );

  app.get(
    '/api/projects/:slug',
    { preHandler: [app.requireScope('projects:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const e = entryOf(slug);
      const yaml = readFileSync(e.file, 'utf8');
      return {
        slug,
        root: e.root,
        workspace: e.workspace,
        organization: e.organization,
        config: e.config,
        yaml,
        processes: app.registry.processesOf(slug),
        envsOnDisk: e.envsOnDisk,
      };
    },
  );

  app.put(
    '/api/projects/:slug',
    { preHandler: [app.requireScope('projects:write'), app.requireWorkspaceRole('editor')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const body = req.body as { yaml?: string; config?: unknown };
      const fs = fsOf(slug);
      let text: string;
      if (typeof body?.yaml === 'string') {
        const parsed = ProjectConfigSchema.safeParse(parseYaml(body.yaml));
        if (!parsed.success) throw unprocessable('Invalid project yaml.', parsed.error.issues);
        if (parsed.data.slug !== slug) throw unprocessable('slug cannot change.');
        if (parsed.data.workspace) assertWorkspaceDeclared(parsed.data.workspace, unprocessable);
        text = body.yaml;
      } else if (body?.config) {
        const parsed = ProjectConfigSchema.safeParse(body.config);
        if (!parsed.success) throw unprocessable('Invalid project config.', parsed.error.issues);
        if (parsed.data.workspace) assertWorkspaceDeclared(parsed.data.workspace, unprocessable);
        text = toYaml(body.config, { lineWidth: 100 });
      } else throw badRequest('Provide yaml or config.');
      // Checked before the write, not after: `reloadRegistry` throws CONFIG_INVALID for a project
      // naming an undeclared workspace, and it throws for *every* project -- so saving one bad
      // value here would empty the whole dashboard until someone fixed the yaml by hand.
      fs.write(PROJECT_FILE, text);
      const registry = app.reloadRegistry();
      await app.hierarchy.sync(registry);
      await app.scheduler.syncFromRegistry(registry);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'project.update',
        targetType: 'project',
        targetId: slug,
      });
      return { ok: true, config: registry.get(slug) };
    },
  );

  app.delete(
    '/api/projects/:slug',
    // admin, not editor: this is the only project route that removes anything.
    { preHandler: [app.requireScope('projects:write'), app.requireWorkspaceRole('admin')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const { confirm } = req.query as { confirm?: string };
      const entry = entryOf(slug);
      // Defence in depth behind the UI's type-the-slug dialog: a mistyped curl should not delete.
      if (confirm !== slug)
        throw badRequest(`Pass ?confirm=${slug} to delete this project.`, {
          hint: 'The confirmation must equal the slug.',
        });

      const row = await getProjectBySlug(app.adb.db, slug);
      // Tear the schedules down *before* the files. `Scheduler.syncFromRegistry` only ever upserts
      // from the registry, and `reload()` arms every row `list()` returns without checking that
      // the project still exists -- so schedules left behind would keep firing runs against a
      // directory that is gone.
      const schedules = row ? await listSchedules(app.adb.db, row.id) : [];
      for (const s of schedules) await deleteSchedule(app.adb.db, s.id);
      if (schedules.length) await app.scheduler.reload();

      const res = await runCliJson<{ slug: string; from: string; to: string | null }>(app.config, [
        'project',
        'delete',
        slug,
        '--yes',
      ]);
      if (!res.ok) {
        // Put the schedules back: nothing was removed, so leaving them deleted would silently
        // stop a working project's cron.
        for (const s of schedules) await upsertSchedule(app.adb.db, app.adb.driver, s);
        if (schedules.length) await app.scheduler.reload();
        throw badRequest(res.error?.message ?? 'project delete failed', res.error);
      }

      // Keep the row. Runs, results and insights reference project_id, and the whole point of
      // trashing rather than purging is that the history survives.
      if (row) await setProjectArchived(app.adb.db, app.adb.driver, row.id, true);
      const registry = app.reloadRegistry();
      await app.hierarchy.sync(registry);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'project.delete',
        targetType: 'project',
        targetId: slug,
      });
      return {
        ok: true,
        slug,
        from: entry.root,
        trashedTo: res.data?.to ?? null,
        schedulesRemoved: schedules.length,
      };
    },
  );

  /**
   * Register a project that already exists: a directory on the server host, a git URL, or a
   * multipart `.zip` upload. `dryRun` reports what would happen -- it is the same route rather
   * than a GET because a GET that clones a repository is not a read, and could not carry a zip.
   */
  app.post(
    '/api/projects/import',
    { preHandler: [app.requireScope('projects:write')] },
    async (req, reply) => {
      const isMultipart = req.isMultipart();
      let args: string[];
      let dryRun: boolean;
      let temp: string | null = null;

      try {
        if (isMultipart) {
          const file = await req.file();
          if (!file) throw badRequest('Upload the project archive as multipart field "file".');
          if (!/\.zip$/i.test(file.filename))
            throw badRequest('Only .zip archives can be uploaded.', {
              filename: file.filename,
            });
          const fields = file.fields as Record<string, { value?: string } | undefined>;
          const workspace = fields.workspace?.value;
          // A zip is content the caller already has; editor in the target workspace is enough.
          if (workspace) await assertCanWriteWorkspace(String(workspace), req.principal!);
          temp = mkdtempSync(join(tmpdir(), 'sdods-upload-'));
          const zip = join(temp, file.filename.replace(/[^\w.-]/g, '_'));
          writeFileSync(zip, await file.toBuffer());
          dryRun = fields.dryRun?.value === 'true';
          args = ['project', 'import', zip];
          if (fields.slug?.value) args.push('--slug', String(fields.slug.value));
          if (workspace) args.push('--workspace', String(workspace));
          if (fields.force?.value === 'true') args.push('--force');
        } else {
          const body = parse(ImportProjectBody, req.body);
          // A path or git source is read with the *server's* credentials, so it is not something
          // an editor should be able to aim anywhere on the host.
          const principal = req.principal!;
          if (principal.role !== 'admin')
            throw forbidden(
              `Importing from a ${body.kind} source requires an admin. Upload a .zip instead.`,
            );
          if (body.workspace) await assertCanWriteWorkspace(body.workspace, principal);
          dryRun = body.dryRun === true;
          args = ['project', 'import', body.source];
          if (body.slug) args.push('--slug', body.slug);
          if (body.workspace) args.push('--workspace', body.workspace);
          if (body.force) args.push('--force');
        }
        if (dryRun) args.push('--dry-run');

        const res = await runCliJson<{ slug: string; root: string; collides: boolean }>(
          app.config,
          args,
        );
        if (!res.ok) {
          const message = res.error?.message ?? 'project import failed';
          // A slug collision is the one failure a client can act on by renaming.
          if (/already exists/i.test(message)) throw conflict(message);
          throw badRequest(message, res.error);
        }
        if (dryRun) return res.data;

        const registry = app.reloadRegistry();
        await app.hierarchy.sync(registry);
        if (res.data?.slug) await unarchive(res.data.slug);
        await audit(app.adb.db, {
          actorUserId: req.principal!.userId,
          actorType: 'user',
          action: 'project.import',
          targetType: 'project',
          targetId: res.data?.slug ?? 'unknown',
        });
        reply.code(201);
        return res.data;
      } finally {
        if (temp) rmSync(temp, { recursive: true, force: true });
      }
    },
  );

  // ── environments ───────────────────────────────────────────────────────
  app.get(
    '/api/projects/:slug/envs',
    { preHandler: [app.requireScope('envs:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const e = entryOf(slug);
      return e.config.envs.available.map((name) => {
        const file = join(e.root, 'envs', `${name}.yaml`);
        const raw = existsSync(file)
          ? (parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>)
          : null;
        let resolved: { ui?: string; api?: string; error?: string };
        try {
          const cfg = app.registry.resolve(slug, name, {}, { ...process.env });
          resolved = { ui: cfg.env.ui.baseUrl, api: cfg.env.api.baseUrl };
        } catch (err) {
          resolved = { error: (err as Error).message.split('\n')[0] };
        }
        return {
          name,
          default: name === e.config.envs.default,
          exists: Boolean(raw),
          raw,
          ...resolved,
        };
      });
    },
  );

  app.put(
    '/api/projects/:slug/envs/:name',
    { preHandler: [app.requireScope('envs:write'), app.requireWorkspaceRole('editor')] },
    async (req) => {
      const { slug, name } = req.params as { slug: string; name: string };
      parse(EnvNameSchema, name, 'environment name');
      const fs = fsOf(slug);
      const rel = `envs/${name}.yaml`;
      const body = req.body as { yaml?: string } & Partial<ReturnType<typeof EnvBody.parse>>;
      if (typeof body.yaml === 'string') {
        fs.write(rel, body.yaml);
      } else {
        const b = parse(EnvBody, body);
        if (fs.exists(rel)) {
          // Edit in place: headers, auth, aliases and comments in the file are not the form's to
          // drop. Writing the template here used to erase them on every save.
          fs.updateYaml(rel, (doc) => {
            doc.setIn(['ui', 'baseUrl'], b.uiUrl);
            doc.setIn(['api', 'baseUrl'], b.apiUrl);
            if (b.poolSize !== undefined) doc.setIn(['users', 'poolSize'], b.poolSize);
            if (b.vars) doc.setIn(['vars'], doc.createNode(b.vars));
          });
        } else {
          fs.write(
            rel,
            toYaml({
              name,
              ui: { baseUrl: b.uiUrl },
              api: {
                baseUrl: b.apiUrl,
                headers: { Accept: 'application/json' },
                auth: { type: 'none' },
              },
              users: { poolSize: b.poolSize ?? 2 },
              vars: b.vars ?? {},
            }),
          );
        }
        if (b.makeDefault)
          fs.updateYaml(PROJECT_FILE, (doc) => doc.setIn(['envs', 'default'], name));
      }
      fs.updateYaml(PROJECT_FILE, (doc) => {
        const cur =
          (
            doc.getIn(['envs', 'available']) as { items?: Array<{ value?: string }> } | undefined
          )?.items?.map((i) => String(i.value ?? i)) ?? [];
        if (!cur.includes(name)) doc.setIn(['envs', 'available'], [...cur, name]);
      });
      app.reloadRegistry();
      return { ok: true };
    },
  );

  app.delete(
    '/api/projects/:slug/envs/:name',
    { preHandler: [app.requireScope('envs:write'), app.requireWorkspaceRole('editor')] },
    async (req) => {
      const { slug, name } = req.params as { slug: string; name: string };
      const fs = fsOf(slug);
      fs.updateYaml(PROJECT_FILE, (doc) => {
        const cur =
          (
            doc.getIn(['envs', 'available']) as { items?: Array<{ value?: string }> } | undefined
          )?.items?.map((i) => String(i.value ?? i)) ?? [];
        doc.setIn(
          ['envs', 'available'],
          cur.filter((n) => n !== name),
        );
      });
      app.reloadRegistry();
      return { ok: true, note: `envs/${name}.yaml kept on disk; remove it manually if unused.` };
    },
  );

  // ── datasets & user pool ───────────────────────────────────────────────
  app.get(
    '/api/projects/:slug/datasets',
    { preHandler: [app.requireScope('datasets:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const e = entryOf(slug);
      const project = await getProjectBySlug(app.adb.db, slug);
      const dbSets = project ? await listDatasets(app.adb.db, project.id) : [];
      const fileSets = Object.entries(e.config.data.sources).map(([name, src]) => ({
        name,
        source: src,
        storage: 'file' as const,
      }));
      return { file: fileSets, db: dbSets };
    },
  );

  app.get(
    '/api/projects/:slug/datasets/:id/rows',
    { preHandler: [app.requireScope('datasets:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const q = req.query as { offset?: string; limit?: string };
      return getDatasetRows(app.adb.db, id, {
        offset: Number(q.offset ?? 0),
        limit: Math.min(Number(q.limit ?? 100), 1000),
      });
    },
  );

  app.post(
    '/api/projects/:slug/datasets',
    { preHandler: [app.requireScope('datasets:write'), app.requireWorkspaceRole('editor')] },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const e = entryOf(slug);
      const file = await req.file();
      if (!file) throw badRequest('Upload a CSV, JSON or YAML file as multipart field "file".');
      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const name = String(fields.name?.value ?? file.filename.replace(/\.[^.]+$/, '')).replace(
        /[^a-z0-9_-]/gi,
        '-',
      );
      const envKey = String(fields.env?.value ?? '*');
      const storage = (fields.storage?.value === 'file' ? 'file' : 'db') as 'db' | 'file';
      const buf = await file.toBuffer();
      const text = buf.toString('utf8');
      const kind = file.filename.endsWith('.json')
        ? 'json'
        : file.filename.match(/\.ya?ml$/)
          ? 'yaml'
          : 'csv';
      let rows: Record<string, unknown>[];
      try {
        rows =
          kind === 'csv'
            ? (parseCsv(text, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                bom: true,
              }) as Record<string, unknown>[])
            : kind === 'json'
              ? normalizeRows(JSON.parse(text))
              : normalizeRows(parseYaml(text));
      } catch (err) {
        throw unprocessable(`Cannot parse ${kind}: ${(err as Error).message}`);
      }
      const preview = fields.preview?.value === '1';
      if (preview)
        return {
          name,
          kind,
          rows: rows.slice(0, 50),
          rowCount: rows.length,
          columns: Object.keys(rows[0] ?? {}),
        };
      if (storage === 'file') {
        const rel = `data/${envKey === '*' ? 'common' : envKey}/${name}.${kind}`;
        new ProjectFs(e.root).write(rel, text);
        reply.code(201);
        return { name, storage, path: rel, rowCount: rows.length };
      }
      const project = await getProjectBySlug(app.adb.db, slug);
      if (!project) throw notFound('Project row');
      const id = await upsertDataset(app.adb.db, app.adb.driver, {
        projectId: project.id,
        envKey,
        name,
        kind,
        storage: 'db',
        rows: rows as never,
        createdBy: req.principal!.userId,
      } as never);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'dataset.upload',
        targetType: 'dataset',
        targetId: String(id),
        details: { name, rows: rows.length },
      });
      reply.code(201);
      return { id, name, storage, rowCount: rows.length };
    },
  );

  app.get(
    '/api/projects/:slug/users-pool',
    { preHandler: [app.requireScope('datasets:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const q = req.query as { env?: string };
      const e = entryOf(slug);
      const project = await getProjectBySlug(app.adb.db, slug);
      const env = q.env ?? e.config.envs.default;
      const status = project
        ? await poolStatus(app.adb.db, project.id, env).catch(() => null)
        : null;
      return { pool: e.config.data.userPool ?? null, env, status };
    },
  );

  // ── features, steps, lint ──────────────────────────────────────────────
  app.get(
    '/api/projects/:slug/features',
    { preHandler: [app.requireScope('features:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const fs = fsOf(slug);
      const files = fs.tree('features', (p) => p.endsWith('.feature'));
      return files.map((f) => {
        const text = fs.read(f.path);
        const tags = [...new Set(text.match(/@[A-Za-z0-9_:.-]+/g) ?? [])];
        const scenarios = (text.match(/^\s*(Scenario|Scenario Outline|Example):/gm) ?? []).length;
        return {
          ...f,
          module: app.registry.moduleOfFeature(slug, f.path)?.name ?? null,
          tags,
          scenarios,
        };
      });
    },
  );

  app.get(
    '/api/projects/:slug/features/*',
    { preHandler: [app.requireScope('features:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug, '*': rest } = req.params as { slug: string; '*': string };
      const rel = rest.startsWith('features/') ? rest : `features/${rest}`;
      return { path: rel, content: fsOf(slug).read(rel) };
    },
  );

  app.post(
    '/api/projects/:slug/features/validate',
    { preHandler: [app.requireScope('features:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const body = parse(FeatureWriteBody, req.body);
      return validateFeature(app, slug, body.content);
    },
  );

  app.put(
    '/api/projects/:slug/features/*',
    { preHandler: [app.requireScope('features:write'), app.requireWorkspaceRole('editor')] },
    async (req) => {
      const { slug, '*': rest } = req.params as { slug: string; '*': string };
      const rel = rest.startsWith('features/') ? rest : `features/${rest}`;
      if (!rel.endsWith('.feature')) throw badRequest('Only .feature files can be written here.');
      const body = parse(FeatureWriteBody, req.body);
      const result = await validateFeature(app, slug, body.content);
      if (result.errors.length) throw unprocessable('Feature has lint errors.', result);
      fsOf(slug).write(rel, body.content);
      catalog.invalidate(slug);
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'feature.write',
        targetType: 'feature',
        targetId: `${slug}:${rel}`,
      });
      return { ok: true, path: rel, warnings: result.warnings };
    },
  );

  app.get(
    '/api/projects/:slug/steps',
    { preHandler: [app.requireScope('features:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      return catalog.list(slug, entryOf(slug).root);
    },
  );

  app.post(
    '/api/projects/:slug/lint',
    { preHandler: [app.requireScope('features:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const res = await runCliJson(app.config, ['lint', '-p', slug]);
      return res.data ?? { errors: [], warnings: [], note: res.error?.message };
    },
  );

  // ── processes ──────────────────────────────────────────────────────────
  app.get(
    '/api/projects/:slug/processes',
    { preHandler: [app.requireScope('processes:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      entryOf(slug);
      return app.registry.processesOf(slug);
    },
  );

  app.post(
    '/api/projects/:slug/processes/:name/run',
    { preHandler: [app.requireScope('runs:write'), app.requireWorkspaceRole('editor')] },
    async (req, reply) => {
      const { slug, name } = req.params as { slug: string; name: string };
      const proc = app.registry.processOf(slug, name);
      const job = await app.runManager.start(
        { project: slug, process: name, env: proc.env, trigger: 'ui' },
        req.principal!.userId,
      );
      reply.code(202);
      return { runId: job.runId, process: name };
    },
  );

  // ── integrations (config only; secrets by env var name) ────────────────
  app.get(
    '/api/projects/:slug/integrations',
    { preHandler: [app.requireScope('integrations:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const e = entryOf(slug);
      const project = await getProjectBySlug(app.adb.db, slug);
      const rows = project ? await listIntegrations(app.adb.db, project.id).catch(() => []) : [];
      const presence = (name?: string) => (name ? Boolean(process.env[name]) : false);
      return {
        github: e.config.integrations.github
          ? {
              ...e.config.integrations.github,
              tokenPresent: presence(e.config.integrations.github.tokenEnv),
            }
          : null,
        jira: e.config.integrations.jira
          ? {
              ...e.config.integrations.jira,
              tokenPresent: presence(e.config.integrations.jira.tokenEnv),
              emailPresent: presence(e.config.integrations.jira.emailEnv),
            }
          : null,
        mcp: e.config.mcp.servers,
        rows,
      };
    },
  );

  app.put(
    '/api/projects/:slug/integrations',
    { preHandler: [app.requireScope('integrations:write'), app.requireWorkspaceRole('admin')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const body = parse(IntegrationsBody, req.body);
      // Validate before writing: an invalid block would make the project yaml fail to load, and
      // with it every project in the workspace.
      const check = (schema: ZodType, v: unknown, what: string) => {
        const r = schema.safeParse(v);
        if (!r.success)
          throw unprocessable(
            `Invalid ${what} configuration.`,
            r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
      };
      if (body.github) check(GitHubIntegrationSchema, body.github, 'GitHub');
      if (body.jira) check(JiraIntegrationSchema, body.jira, 'Jira');
      for (const [name, cfg] of Object.entries(body.mcp ?? {})) {
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name))
          throw badRequest(`MCP server name "${name}" must be letters, digits, - and _.`);
        if (cfg !== null) check(McpServerSchema, cfg, `MCP server ${name}`);
      }
      const fs = fsOf(slug);
      fs.updateYaml(PROJECT_FILE, (doc) => {
        if (body.github) doc.setIn(['integrations', 'github'], body.github);
        if (body.jira) doc.setIn(['integrations', 'jira'], body.jira);
        // Servers merge by name (null removes one), so saving one server keeps the others.
        for (const [name, cfg] of Object.entries(body.mcp ?? {})) {
          if (cfg === null) doc.deleteIn(['mcp', 'servers', name]);
          else doc.setIn(['mcp', 'servers', name], cfg);
        }
      });
      const registry = app.reloadRegistry();
      const cfg = registry.get(slug);
      const project = await getProjectBySlug(app.adb.db, slug);
      if (project) {
        for (const provider of ['github', 'jira'] as const) {
          const c = cfg.integrations[provider];
          if (c)
            await upsertIntegration(app.adb.db, app.adb.driver, {
              projectId: project.id,
              provider,
              config: c as unknown as Record<string, unknown>,
              secretEnv: { tokenEnv: c.tokenEnv },
              enabled: c.enabled,
            } as never).catch(() => undefined);
        }
      }
      await audit(app.adb.db, {
        actorUserId: req.principal!.userId,
        actorType: 'user',
        action: 'integration.update',
        targetType: 'project',
        targetId: slug,
      });
      return { ok: true };
    },
  );

  app.post(
    '/api/projects/:slug/integrations/:provider/test',
    { preHandler: [app.requireScope('integrations:write'), app.requireWorkspaceRole('admin')] },
    async (req) => {
      const { slug, provider } = req.params as { slug: string; provider: string };
      const res = await runCliJson(app.config, [
        'integrations',
        'test',
        '-p',
        slug,
        '--provider',
        provider,
      ]);
      return res.data ?? { ok: false, error: res.error };
    },
  );

  app.post(
    '/api/projects/:slug/integrations/sync',
    { preHandler: [app.requireScope('integrations:write'), app.requireWorkspaceRole('editor')] },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const res = await runCliJson(app.config, ['integrations', 'sync', '-p', slug]);
      return res.data ?? { ok: false, error: res.error };
    },
  );

  // ── record (local machine only) ────────────────────────────────────────
  /** A recorded spec, by file name under recorded/ (what the record job's result names). */
  app.get(
    '/api/projects/:slug/recorded/:file',
    { preHandler: [app.requireScope('features:read'), app.requireWorkspaceRole('viewer')] },
    async (req) => {
      const { slug, file } = req.params as { slug: string; file: string };
      if (!/^[\w.-]+\.spec\.ts$/.test(file) || file.startsWith('.'))
        throw badRequest('Expected a recorded spec file name such as checkout.spec.ts.');
      const rel = `recorded/${file}`;
      return { path: rel, content: fsOf(slug).read(rel) };
    },
  );

  app.post(
    '/api/projects/:slug/record',
    { preHandler: [app.requireScope('features:write'), app.requireWorkspaceRole('editor')] },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = (req.body ?? {}) as {
        env?: string;
        name?: string;
        url?: string;
        device?: string;
        user?: string;
        browser?: string;
        saveHar?: boolean;
      };
      const job = app.agentManager.startRaw(
        [
          '--json',
          'record',
          '-p',
          slug,
          ...(body.env ? ['-e', body.env] : []),
          ...(body.name ? ['--name', body.name] : []),
          ...(body.url ? ['--url', body.url] : []),
          ...(body.device ? ['--device', body.device] : []),
          ...(body.user ? ['--user', body.user] : []),
          ...(body.browser ? ['--browser', body.browser] : []),
          ...(body.saveHar ? ['--save-har'] : []),
        ],
        req.principal!.userId,
        { project: slug, kind: 'convert' },
      );
      reply.code(202);
      return {
        jobId: job.id,
        note: 'Recording opens a browser window on the machine running the server.',
      };
    },
  );
}

async function validateFeature(app: FastifyInstance, slug: string, content: string) {
  const errors: Array<{ rule: string; message: string; line?: number }> = [];
  const warnings: Array<{ rule: string; message: string; line?: number }> = [];
  try {
    const mcp = await import('@sdods/mcp');
    const parsed = mcp.parseGherkin(content) as unknown as {
      errors?: string[];
      tags?: string[];
      scenarios?: Array<{ name: string; tags: string[]; line?: number }>;
    };
    for (const e of parsed.errors ?? []) errors.push({ rule: 'gherkin', message: e });
    const e = app.registry.entry(slug);
    const suites = e.config.tags.suites.map((s) => `@${s}`);
    for (const s of parsed.scenarios ?? []) {
      const tags = [...new Set([...(parsed.tags ?? []), ...s.tags])];
      const layers = tags.filter((t) => ['@ui', '@api', '@hybrid'].includes(t));
      if (layers.length !== 1)
        errors.push({
          rule: 'tags/layer',
          message: `"${s.name}" needs exactly one of @ui, @api, @hybrid (has ${layers.length}).`,
          line: s.line,
        });
      const suite = tags.filter((t) => suites.includes(t));
      if (suite.length !== 1)
        errors.push({
          rule: 'tags/suite',
          message: `"${s.name}" needs exactly one suite tag (${suites.join(', ')}).`,
          line: s.line,
        });
    }
  } catch (err) {
    warnings.push({ rule: 'lint', message: `Lint unavailable: ${(err as Error).message}` });
  }
  return { errors, warnings };
}

function normalizeRows(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === 'object' && Array.isArray((v as { rows?: unknown }).rows))
    return (v as { rows: Record<string, unknown>[] }).rows;
  throw new Error('expected an array or { rows: [] }');
}
