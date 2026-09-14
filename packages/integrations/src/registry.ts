import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { ProjectConfig } from '@sdods/contracts';
import { GitHubProvider } from './github.js';
import { JiraProvider } from './jira.js';
import { readSecrets, secretPresence } from './secrets.js';
import type { CustomProviderModule, IntegrationProvider, ProviderName } from './types.js';

export interface ProviderEntry {
  name: ProviderName;
  provider: IntegrationProvider;
  enabled: boolean;
  /** env var name → present? (values are never exposed) */
  secrets: Record<string, boolean>;
  initError?: string;
}

export interface GetProvidersOptions {
  env?: NodeJS.ProcessEnv;
  only?: ProviderName[];
  projectRoot?: string;
  /** initialise providers (needs secrets); false = list only */
  init?: boolean;
}

/** Build providers from a project's `integrations` section. Missing secrets become `initError`, not throws. */
export async function getProviders(
  project: Pick<ProjectConfig, 'integrations'>,
  opts: GetProvidersOptions = {},
): Promise<ProviderEntry[]> {
  const env = opts.env ?? process.env;
  const entries: ProviderEntry[] = [];
  const want = (name: ProviderName) => !opts.only || opts.only.includes(name);

  const gh = project.integrations.github;
  if (gh && want('github')) {
    const provider = new GitHubProvider();
    const names = {
      tokenEnv: gh.tokenEnv,
      evidenceTokenEnv: gh.evidence?.host === 'branch' ? gh.evidence.tokenEnv : undefined,
    };
    const entry: ProviderEntry = {
      name: 'github',
      provider,
      enabled: gh.enabled,
      secrets: secretPresence(names, env),
    };
    if (gh.enabled && opts.init !== false) {
      try {
        await provider.init(gh, readSecrets(names, env));
      } catch (e) {
        entry.initError = (e as Error).message;
      }
    }
    entries.push(entry);
  }

  const jira = project.integrations.jira;
  if (jira && want('jira')) {
    const provider = new JiraProvider();
    const entry: ProviderEntry = {
      name: 'jira',
      provider,
      enabled: jira.enabled,
      secrets: secretPresence(
        {
          tokenEnv: jira.tokenEnv,
          emailEnv: jira.authMode === 'basic' ? jira.emailEnv : undefined,
        },
        env,
      ),
    };
    if (jira.enabled && opts.init !== false) {
      try {
        await provider.init(
          jira,
          readSecrets({ tokenEnv: jira.tokenEnv, emailEnv: jira.emailEnv }, env),
        );
      } catch (e) {
        entry.initError = (e as Error).message;
      }
    }
    entries.push(entry);
  }

  for (const custom of project.integrations.custom) {
    const specifier = custom.module.startsWith('.')
      ? pathToFileURL(resolve(opts.projectRoot ?? process.cwd(), custom.module)).href
      : custom.module;
    try {
      const mod = (await import(specifier)) as CustomProviderModule;
      const provider = mod.createProvider
        ? mod.createProvider(custom.options)
        : mod.default
          ? new mod.default(custom.options)
          : null;
      if (!provider)
        throw new Error(
          `module ${custom.module} exports neither createProvider nor a default class`,
        );
      if (!want(provider.name)) continue;
      const entry: ProviderEntry = { name: provider.name, provider, enabled: true, secrets: {} };
      if (opts.init !== false) {
        try {
          await provider.init(custom.options ?? {}, {});
        } catch (e) {
          entry.initError = (e as Error).message;
        }
      }
      entries.push(entry);
    } catch (e) {
      entries.push({
        name: custom.module,
        provider: null as unknown as IntegrationProvider,
        enabled: true,
        secrets: {},
        initError: (e as Error).message,
      });
    }
  }
  return entries;
}
