/**
 * Every way SDODS can be installed, and which of them are actually usable right now.
 *
 * sdods.com is a static export, so it cannot ask npm, GHCR or GitHub at request time — and doing
 * it at build time would make every site deploy depend on three third parties being up. So the
 * channel list is a committed fact, refreshed by `scripts/sync-channels.ts`, which resolves each
 * one against the real registry before writing it here.
 *
 * `live: false` is a real, supported state, not a placeholder. A channel is only live once the
 * thing it points at exists: the npm package is published, the Homebrew tap has the formula, the
 * image is pushed and public, the release the manifests reference is out of draft. The install
 * page renders live channels only — a tab whose command 404s is worse than a missing tab, because
 * the visitor blames the tool rather than the page.
 */

export type ChannelId =
  | 'script-unix'
  | 'script-windows'
  | 'homebrew'
  | 'npm'
  | 'docker'
  | 'linux-packages'
  | 'scoop'
  | 'winget'
  | 'apt';

/** Which platforms a channel can actually install on, for the user-agent default. */
export type ChannelOs = 'macos' | 'linux' | 'windows';

/** What the channel installs. The CLI, the server image and the desktop app are three products. */
export type ChannelKind = 'cli' | 'server' | 'desktop';

export interface Channel {
  id: ChannelId;
  /** Tab label, or the heading of an alternate inside another channel's panel. */
  label: string;
  os: ChannelOs[];
  kind: ChannelKind;
  /** The one command to copy. One line: a wrapped command has already caused a real paste error. */
  command: string;
  /** Shown under the command on the full page, not in compact mode. */
  note: string;
  /**
   * When set, this channel renders inside that channel's panel instead of owning a tab. Scoop and
   * winget are alternates under the Windows script and apt under the Linux packages tab: they are
   * real channels with their own publish state, but a visitor choosing how to install on Windows
   * is choosing once, not three times.
   */
  under?: ChannelId;
  /** False until the thing this points at is published. Non-live channels are not rendered. */
  live: boolean;
}

/**
 * Generated. Do not edit by hand — run `bun run channels:sync` from the repo root, which checks
 * each channel against its registry and rewrites the `live:` flags and the version-bearing text.
 */
export const INSTALL_CHANNELS: Channel[] = [
  {
    id: 'script-unix',
    label: 'macOS / Linux',
    os: ['macos', 'linux'],
    kind: 'cli',
    command: 'curl -fsSL https://sdods.com/install.sh | sh',
    note: 'Options go after -s --, for example: | sh -s -- --workspace ~/my-tests --mcp claude',
    live: true,
  },
  {
    id: 'script-windows',
    label: 'Windows',
    os: ['windows'],
    kind: 'cli',
    command: 'irm https://sdods.com/install.ps1 | iex',
    note: 'With options: & ([scriptblock]::Create((irm https://sdods.com/install.ps1))) -Workspace C:\\my-tests',
    live: true,
  },
  {
    id: 'homebrew',
    label: 'Homebrew',
    os: ['macos', 'linux'],
    kind: 'cli',
    command: 'brew install siri1410/sdods/sdods',
    note: 'Installs the published CLI against your own Node. brew upgrade sdods updates it.',
    live: true,
  },
  {
    id: 'npm',
    label: 'npm',
    os: ['macos', 'linux', 'windows'],
    kind: 'cli',
    command: 'npm install -g @sdods/cli',
    note: 'Needs Node 22+. Currently @sdods/cli@0.2.2 — the same package the installer script fetches.',
    live: true,
  },
  {
    id: 'docker',
    label: 'Docker',
    os: ['macos', 'linux', 'windows'],
    kind: 'server',
    command: 'docker run --rm -p 8080:8080 -v sdods-data:/data ghcr.io/siri1410/sdods-server',
    note: 'The server and web UI, browser engines included. Any CLI command works as the argument.',
    live: false,
  },
  {
    id: 'linux-packages',
    label: 'Linux packages',
    os: ['linux'],
    kind: 'desktop',
    command: 'sudo apt install ./SDODS-linux-amd64.deb',
    note: 'The desktop app as a .deb, downloaded from the releases page first.',
    live: false,
  },
  {
    id: 'scoop',
    label: 'Scoop',
    os: ['windows'],
    kind: 'desktop',
    command: 'scoop bucket add sdods https://github.com/siri1410/scoop-sdods',
    note: 'Then: scoop install sdods — the desktop app, updated by scoop update.',
    under: 'script-windows',
    live: false,
  },
  {
    id: 'winget',
    label: 'winget',
    os: ['windows'],
    kind: 'desktop',
    command: 'winget install SDODS.SDODS',
    note: 'The desktop app, from the Windows Package Manager community repository.',
    under: 'script-windows',
    live: false,
  },
  {
    id: 'apt',
    label: 'apt repository',
    os: ['linux'],
    kind: 'desktop',
    command: 'sudo apt update && sudo apt install sdods',
    note: 'After adding the signed SDODS repository once — the docs have the two setup lines.',
    under: 'linux-packages',
    live: false,
  },
];

/** Channels that own a tab, in tab order. Non-live channels are never rendered. */
export const TAB_CHANNELS = INSTALL_CHANNELS.filter((c) => c.live && !c.under);

/** The alternates to show inside a given tab's panel. */
export function alternatesFor(id: ChannelId): Channel[] {
  return INSTALL_CHANNELS.filter((c) => c.live && c.under === id);
}

/** The tab a visitor on this platform should land on: always a script, never a package manager. */
export function defaultTabFor(os: ChannelOs): ChannelId {
  return os === 'windows' ? 'script-windows' : 'script-unix';
}
