import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId } from '@automax/contracts';
import type { IssueLink, IssueLinkStore, ProviderName } from './types.js';

/**
 * JSON-file store so the CLI works without a database (`.automax/issue-links.json`).
 * Pass `null` as the file for an in-memory store (tests). Not safe for concurrent writers across machines.
 */
export class FileIssueLinkStore implements IssueLinkStore {
  private links: IssueLink[] | null = null;

  constructor(private readonly file: string | null) {}

  private load(): IssueLink[] {
    if (this.links) return this.links;
    if (!this.file || !existsSync(this.file)) {
      this.links = [];
      return this.links;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { links?: IssueLink[] };
      this.links = Array.isArray(parsed.links) ? parsed.links : [];
    } catch {
      this.links = [];
    }
    return this.links;
  }

  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: 1, links: this.load() }, null, 2));
  }

  async findOpen(projectSlug: string, provider: ProviderName, fingerprint: string) {
    return this.load().find(
      (l) =>
        l.projectSlug === projectSlug &&
        l.provider === provider &&
        l.fingerprint === fingerprint &&
        l.status !== 'closed',
    );
  }

  async findByKey(projectSlug: string, provider: ProviderName, externalKey: string) {
    return this.load().find(
      (l) =>
        l.projectSlug === projectSlug && l.provider === provider && l.externalKey === externalKey,
    );
  }

  async save(input: Parameters<IssueLinkStore['save']>[0]): Promise<IssueLink> {
    const links = this.load();
    const now = new Date().toISOString();
    const existing = links.find(
      (l) =>
        (input.id !== undefined && l.id === input.id) ||
        (l.projectSlug === input.projectSlug &&
          l.provider === input.provider &&
          l.fingerprint === input.fingerprint &&
          l.externalKey === input.externalKey),
    );
    if (existing) {
      Object.assign(existing, input, { updatedAt: now });
      this.persist();
      return existing;
    }
    const link: IssueLink = {
      ...input,
      id: input.id ?? newId(),
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    links.push(link);
    this.persist();
    return link;
  }

  async list(projectSlug: string, provider?: ProviderName) {
    return this.load().filter(
      (l) => l.projectSlug === projectSlug && (provider ? l.provider === provider : true),
    );
  }
}

export function createMemoryStore(): IssueLinkStore {
  return new FileIssueLinkStore(null);
}
