import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BrowserName, Layer, Project, StartRunInput } from '../api/types';
import { readPref, writePref } from './utils';

/**
 * The last run selection, remembered per user × workspace × project.
 *
 * Stored on the server (`/api/me/preferences/runForm:<workspace>:<project>`) and cached in
 * localStorage under `sdods:runForm:<workspace>:<project>`. The server copy is the one that lasts:
 * browser storage belongs to an origin, and the desktop app's origin is `127.0.0.1:<port>`, which
 * changes whenever its preferred port is taken. The local copy makes the dialog fill instantly and
 * keeps working when the server has no session to store against (auth disabled, API tokens).
 *
 * `feature` and `scenario` are never stored: they come from where the dialog was opened.
 */
export interface RunFormSelection {
  env?: string;
  tags?: string;
  layers?: Layer[];
  browsers?: BrowserName[];
  process?: string;
  workers?: number;
  headed?: boolean;
  harMode?: StartRunInput['harMode'];
}

interface Stored extends RunFormSelection {
  v: 1;
  savedAt: string;
}

export const runFormPrefKey = (workspace: string, project: string) =>
  `runForm:${workspace}:${project}`;

const newer = (a: Stored | null, b: Stored | null) =>
  !a ? b : !b ? a : (a.savedAt ?? '') >= (b.savedAt ?? '') ? a : b;

function isStored(v: unknown): v is Stored {
  return Boolean(v) && typeof v === 'object' && (v as Stored).v === 1;
}

/**
 * A saved selection checked against the project as it is now: an environment, layer or browser
 * that was removed since is dropped rather than sent to a run that would reject it.
 */
export function sanitizeSelection(
  saved: RunFormSelection | null,
  project: Pick<Project, 'envs' | 'layers' | 'browsers'>,
  processes?: string[],
): RunFormSelection {
  if (!saved) return {};
  const out: RunFormSelection = {};
  if (saved.env && project.envs.available.includes(saved.env)) out.env = saved.env;
  if (saved.tags) out.tags = saved.tags;
  const layers = (saved.layers ?? []).filter((l) => project.layers.includes(l));
  if (layers.length) out.layers = layers;
  const browsers = (saved.browsers ?? []).filter((b) => project.browsers.includes(b));
  if (browsers.length) out.browsers = browsers;
  if (saved.process && processes?.includes(saved.process)) out.process = saved.process;
  if (saved.workers && saved.workers > 0) out.workers = saved.workers;
  if (saved.headed) out.headed = true;
  if (saved.harMode && saved.harMode !== 'off') out.harMode = saved.harMode;
  return out;
}

/** What a form holds that is worth remembering. */
export function selectionOf(form: StartRunInput): RunFormSelection {
  return {
    env: form.env || undefined,
    tags: form.tags || undefined,
    layers: form.layers?.length ? form.layers : undefined,
    browsers: form.browsers?.length ? form.browsers : undefined,
    process: form.process || undefined,
    workers: form.workers,
    headed: form.headed || undefined,
    harMode: form.harMode && form.harMode !== 'off' ? form.harMode : undefined,
  };
}

export function useRunFormPref(workspace: string | undefined, project: string | undefined) {
  const key = workspace && project ? runFormPrefKey(workspace, project) : null;
  const qc = useQueryClient();
  const server = useQuery({
    queryKey: ['preference', key],
    queryFn: async () => {
      try {
        const res = await api<{ value: unknown }>(
          `/api/me/preferences/${encodeURIComponent(key!)}`,
        );
        return isStored(res.value) ? res.value : null;
      } catch {
        return null; // no session to store against: the local copy is all there is
      }
    },
    enabled: Boolean(key),
    staleTime: 60_000,
  });
  const local = useMemo(() => {
    if (!key) return null;
    const v = readPref<unknown>(key, null);
    return isStored(v) ? v : null;
  }, [key]);

  const save = useCallback(
    (selection: RunFormSelection) => {
      if (!key) return;
      const value: Stored = { ...selection, v: 1, savedAt: new Date().toISOString() };
      writePref(key, value);
      qc.setQueryData(['preference', key], value);
      void api(`/api/me/preferences/${encodeURIComponent(key)}`, {
        method: 'PUT',
        json: { value },
      }).catch(() => undefined);
    },
    [key, qc],
  );

  return {
    /** The newest of the server and local copies; null when nothing was saved. */
    saved: newer(server.data ?? null, local) as RunFormSelection | null,
    /** True until the server copy has been asked for, so the form does not fill in twice. */
    loading: Boolean(key) && server.isLoading,
    save,
  };
}
