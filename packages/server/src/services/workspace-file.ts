import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { WORKSPACE_FILE, type ProjectRegistry } from '@sdods/core/config';
import { conflict, unprocessable } from '../errors.js';

/**
 * Declare a workspace in sdods.workspace.yaml, the file the project registry trusts. A workspace
 * that only existed in the database could not hold a project: create and import checked the file
 * and refused it. Writes are validated by reloading the registry and rolled back if that fails.
 */
export function declareWorkspace(
  registry: ProjectRegistry,
  reload: () => ProjectRegistry,
  org: { slug: string; name: string },
  ws: { slug: string; name: string; description?: string | null },
): ProjectRegistry {
  const file = registry.workspaceFilePath ?? join(registry.rootDir, WORKSPACE_FILE);
  const declared = registry.workspaceFile;
  if (registry.workspaceFilePath && declared.organization.slug !== org.slug)
    throw unprocessable(
      `${WORKSPACE_FILE} belongs to organization "${declared.organization.slug}", not "${org.slug}".`,
    );
  if (declared.workspaces.some((w) => w.slug === ws.slug))
    throw conflict(`Workspace "${ws.slug}" already exists.`);

  const entry = {
    slug: ws.slug,
    name: ws.name,
    ...(ws.description ? { description: ws.description } : {}),
    organization: org.slug,
  };
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (before !== null) {
    const doc = parseDocument(before);
    doc.addIn(['workspaces'], doc.createNode(entry));
    writeFileSync(file, doc.toString({ lineWidth: 100 }));
  } else {
    // No file yet: the registry was using its built-in default, which has to be written out too
    // or the default workspace would disappear with the first new one.
    writeFileSync(
      file,
      stringify({
        organization: { slug: org.slug, name: org.name },
        workspaces: [...declared.workspaces.map((w) => ({ ...w, organization: org.slug })), entry],
        defaultWorkspace: declared.defaultWorkspace,
      }),
    );
  }
  try {
    return reload();
  } catch (e) {
    if (before === null) rmSync(file, { force: true });
    else writeFileSync(file, before);
    reload();
    throw unprocessable(`Could not declare workspace "${ws.slug}": ${(e as Error).message}`);
  }
}
