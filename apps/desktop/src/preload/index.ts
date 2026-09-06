/**
 * The only bridge between the bootstrap renderer and the main process.
 *
 * Scope is intentionally tiny — progress events, an error channel, a retry, and some read-only
 * app info. Once the server is healthy the window navigates to the served SPA, which has no
 * preload and talks to the API over HTTP like any browser would.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface Progress {
  phase: string;
  message: string;
  detail?: string;
}
export interface BootstrapFailure {
  message: string;
  detail: string;
}

const api = {
  onProgress: (cb: (p: Progress) => void) => {
    const handler = (_e: unknown, p: Progress) => cb(p);
    ipcRenderer.on('bootstrap:progress', handler);
    return () => ipcRenderer.off('bootstrap:progress', handler);
  },
  onError: (cb: (e: BootstrapFailure) => void) => {
    const handler = (_e: unknown, payload: BootstrapFailure) => cb(payload);
    ipcRenderer.on('bootstrap:error', handler);
    return () => ipcRenderer.off('bootstrap:error', handler);
  },
  onServerLog: (cb: (line: string) => void) => {
    const handler = (_e: unknown, line: string) => cb(line);
    ipcRenderer.on('server:log', handler);
    return () => ipcRenderer.off('server:log', handler);
  },
  retry: () => ipcRenderer.invoke('bootstrap:retry'),
  info: () =>
    ipcRenderer.invoke('app:info') as Promise<{
      workspace: string;
      version: string;
      platform: string;
    }>,
};

contextBridge.exposeInMainWorld('sdods', api);

export type SdodsBridge = typeof api;
