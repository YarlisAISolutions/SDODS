/**
 * Application menu. Deliberately small: the product UI lives in the served SPA, so this covers
 * only the things the web app cannot do for itself — reaching the workspace on disk, revealing the
 * credentials the app generated, getting at logs when something goes wrong, and updating the app.
 */
import { app, Menu, clipboard, dialog, shell, type MenuItemConstructorOptions } from 'electron';
import { logsDir } from './paths.js';
import type { Credentials } from './auth.js';
import type { UpdateController } from './updater.js';

// A copy of SPONSOR_ENABLED in @sdods/contracts/sponsor, which the desktop app does not bundle;
// tests/sponsor.test.ts keeps the two in step.
const SPONSOR_ENABLED = false;

export interface MenuContext {
  workspace: string;
  serverUrl: string;
  credentials: () => Credentials | null;
  updates?: UpdateController;
  /** Delete and download the Chromium test browser again. */
  reinstallBrowsers?: () => void;
}

export function buildMenu(ctx: MenuContext): void {
  const isMac = process.platform === 'darwin';
  const updates = ctx.updates;

  // "Check for Updates…" is always there, and explains itself on an install that cannot update
  // (a .deb, an unsigned Mac build). The automatic toggle is only offered where it would do anything.
  const updateItems: MenuItemConstructorOptions[] = updates
    ? [
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => void updates.checkNow() },
        {
          label: 'Check for Updates Automatically',
          type: 'checkbox',
          checked: updates.gate.active && updates.autoCheck(),
          enabled: updates.gate.active,
          click: (item) => updates.setAutoCheck(item.checked),
        },
      ]
    : [];

  const sdodsMenu: MenuItemConstructorOptions = {
    label: 'SDODS',
    submenu: [
      {
        label: 'Open Workspace Folder',
        click: () => void shell.openPath(ctx.workspace),
      },
      {
        label: 'Open in Browser',
        click: () => void shell.openExternal(ctx.serverUrl),
      },
      { type: 'separator' },
      {
        // The app generates the admin password and signs in silently, so this is the only way a
        // user can reach their own account from a browser or the CLI.
        label: 'Show Credentials…',
        click: () => {
          const creds = ctx.credentials();
          if (!creds) {
            void dialog.showMessageBox({ message: 'No credentials stored yet.' });
            return;
          }
          void dialog
            .showMessageBox({
              type: 'info',
              message: 'SDODS sign-in',
              detail: `URL:      ${ctx.serverUrl}\nUsername: ${creds.username}\nPassword: ${creds.password}`,
              buttons: ['Copy password', 'Close'],
              defaultId: 0,
              cancelId: 1,
            })
            .then(({ response }) => {
              if (response === 0) clipboard.writeText(creds.password);
            });
        },
      },
      {
        label: 'Open Logs Folder',
        click: () => void shell.openPath(logsDir()),
      },
      ...(ctx.reinstallBrowsers
        ? ([
            {
              // The way out when runs fail with "Executable doesn't exist": a clean download of
              // the exact revision the workspace's Playwright launches, into the app's own cache.
              label: 'Reinstall Test Browsers',
              click: () => ctx.reinstallBrowsers?.(),
            },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      ...updateItems,
      ...(SPONSOR_ENABLED
        ? ([
            { type: 'separator' },
            {
              label: 'Sponsor SDODS…',
              click: () => void shell.openExternal('https://sdods.com/sponsor/'),
            },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    sdodsMenu,
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];

  if (isMac) template[0]!.label = app.getName();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
