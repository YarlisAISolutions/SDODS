import type { Person } from './types';

export const HANDLES = [
  'reeta-nandal',
  'tomas-brekke',
  'priya-venkatesh',
  'daniel-oyelaran',
  'mkuiper',
  'hsu-wei-lin',
  'annika-solheim',
  'rgarrido',
  'j-okonkwo',
  'lena-hartwig',
  'sam-orbison',
  'nadia-belkacem',
  'petrov-k',
  'ify-adeyemi',
  'thom-vasseur',
  'bea-lindqvist',
  'dperera',
  'avery-hollis',
  'kmoreau',
  'tobi-schrader',
  'vikram-r',
  'elsa-nyman',
  'gcastellano',
  'mina-farouk',
  'owen-brackley',
  'sunita-kale',
  'lars-vinter',
  'ade-oyinlola',
  'renata-kohl',
  'yusuf-demir',
  'chandra-p',
  'helle-borg',
  'nikhil-sane',
  'fiona-mcallister',
  'bruno-teixeira',
  'anouk-devries',
  'sergio-alcaraz',
  'tanvi-bhatt',
  'koen-vermeulen',
  'rasha-halabi',
  'devon-marsh',
  'ingrid-solberg',
  'paulo-mendes',
  'zeynep-arslan',
] as const;

export type Handle = (typeof HANDLES)[number];

/**
 * The people who post here.
 *
 * Three tiers, because a forum that reads right has a shape: a few maintainers who answer
 * everywhere, a dozen regulars each anchored to a couple of subjects, and a long tail who turn up
 * once with a broken build and are never seen again.
 *
 * Avatars are derived from the handle (initials on a hashed hue) rather than stored, so nothing
 * here implies a photograph of a real person.
 */
export const PEOPLE: Person[] = [
  // --- maintainers -----------------------------------------------------------------------------
  {
    handle: 'reeta-nandal',
    display: 'Reeta Nandal',
    role: 'maintainer',
    joined: '2020-06-02',
    rep: 41280,
    tagline: 'Works on the runner and the config layer. Will ask you for the exit code.',
  },
  {
    handle: 'tomas-brekke',
    display: 'Tomas Brekke',
    role: 'maintainer',
    joined: '2020-06-02',
    rep: 33915,
    tagline: 'Locators, the healer, and a long-running argument against XPath.',
  },
  {
    handle: 'priya-venkatesh',
    display: 'Priya Venkatesh',
    role: 'maintainer',
    joined: '2020-08-14',
    rep: 29604,
    tagline: 'Test data, user pools and the parts of CI nobody wants to own.',
  },
  {
    handle: 'daniel-oyelaran',
    display: 'Daniel Oyelaran',
    role: 'maintainer',
    joined: '2021-03-09',
    rep: 24177,
    tagline: 'Packaging and distribution. If the installer broke, it is probably his week.',
  },

  // --- regulars --------------------------------------------------------------------------------
  {
    handle: 'mkuiper',
    display: 'Marijn Kuiper',
    role: 'regular',
    joined: '2020-09-21',
    rep: 18840,
    tagline: 'Runs a 4,000-scenario suite on a build farm and has opinions about shards.',
  },
  {
    handle: 'hsu-wei-lin',
    display: 'Hsu Wei-lin',
    role: 'regular',
    joined: '2020-11-03',
    rep: 15230,
    tagline: 'API contracts, OpenAPI and schema assertions.',
  },
  {
    handle: 'annika-solheim',
    display: 'Annika Solheim',
    role: 'regular',
    joined: '2021-01-18',
    rep: 14002,
    tagline: 'Accessibility. Reads the axe rule text so you do not have to.',
  },
  {
    handle: 'rgarrido',
    display: 'Rafa Garrido',
    role: 'regular',
    joined: '2021-02-27',
    rep: 12996,
    tagline: 'Page objects, fixtures, and refactoring other people’s step files.',
  },
  {
    handle: 'j-okonkwo',
    display: 'Jide Okonkwo',
    role: 'regular',
    joined: '2021-05-30',
    rep: 11745,
    tagline: 'HAR replay and offline suites. Distrusts any test that needs the internet.',
  },
  {
    handle: 'lena-hartwig',
    display: 'Lena Hartwig',
    role: 'regular',
    joined: '2021-09-12',
    rep: 10388,
    tagline: 'Flaky triage. Keeps a spreadsheet of every quarantined scenario.',
  },
  {
    handle: 'sam-orbison',
    display: 'Sam Orbison',
    role: 'regular',
    joined: '2022-01-24',
    rep: 9420,
    tagline: 'Windows. The only person here who enjoys PowerShell.',
  },
  {
    handle: 'nadia-belkacem',
    display: 'Nadia Belkacem',
    role: 'regular',
    joined: '2022-04-06',
    rep: 8611,
    tagline: 'Visual baselines, and why yours differ between a laptop and a runner.',
  },
  {
    handle: 'petrov-k',
    display: 'Kostya Petrov',
    role: 'regular',
    joined: '2022-08-19',
    rep: 7903,
    tagline: 'MCP, editor wiring and agent proposals.',
  },
  {
    handle: 'ify-adeyemi',
    display: 'Ify Adeyemi',
    role: 'regular',
    joined: '2023-02-11',
    rep: 6584,
    tagline: 'Reporting, traces and getting artefacts out of a container.',
  },
  {
    handle: 'thom-vasseur',
    display: 'Thom Vasseur',
    role: 'regular',
    joined: '2023-06-28',
    rep: 5470,
    tagline: 'Recording flows and converting them into something maintainable.',
  },
  {
    handle: 'bea-lindqvist',
    display: 'Bea Lindqvist',
    role: 'regular',
    joined: '2024-01-15',
    rep: 4318,
    tagline: 'Tagging policy pedant, and the suite is faster for it.',
  },

  // --- the long tail ---------------------------------------------------------------------------
  {
    handle: 'dperera',
    display: 'Dinuka Perera',
    role: 'member',
    joined: '2020-09-08',
    rep: 412,
    tagline: 'QA lead at a logistics shop.',
  },
  {
    handle: 'avery-hollis',
    display: 'Avery Hollis',
    role: 'member',
    joined: '2020-10-27',
    rep: 188,
    tagline: 'Moved a Selenium suite over and lived to tell it.',
  },
  {
    handle: 'kmoreau',
    display: 'Karine Moreau',
    role: 'member',
    joined: '2021-01-06',
    rep: 655,
    tagline: 'Two API suites and a tolerance for YAML.',
  },
  {
    handle: 'tobi-schrader',
    display: 'Tobi Schrader',
    role: 'member',
    joined: '2021-04-19',
    rep: 97,
    tagline: 'Contract testing, mostly.',
  },
  {
    handle: 'vikram-r',
    display: 'Vikram Rajagopal',
    role: 'member',
    joined: '2021-07-02',
    rep: 1240,
    tagline: 'Runs the nightly and reads the report every morning.',
  },
  {
    handle: 'elsa-nyman',
    display: 'Elsa Nyman',
    role: 'member',
    joined: '2021-10-14',
    rep: 333,
    tagline: 'Design-system team, here for the visual diffs.',
  },
  {
    handle: 'gcastellano',
    display: 'Gio Castellano',
    role: 'member',
    joined: '2022-02-08',
    rep: 521,
    tagline: 'Consultant. Sets these up and hands them over.',
  },
  {
    handle: 'mina-farouk',
    display: 'Mina Farouk',
    role: 'member',
    joined: '2022-03-30',
    rep: 760,
    tagline: 'Test data and GDPR-shaped problems.',
  },
  {
    handle: 'owen-brackley',
    display: 'Owen Brackley',
    role: 'member',
    joined: '2022-06-21',
    rep: 144,
    tagline: 'One flaky checkout scenario, three years running.',
  },
  {
    handle: 'sunita-kale',
    display: 'Sunita Kale',
    role: 'member',
    joined: '2022-09-05',
    rep: 982,
    tagline: 'Platform team. Owns the runners.',
  },
  {
    handle: 'lars-vinter',
    display: 'Lars Vinter',
    role: 'member',
    joined: '2022-11-17',
    rep: 276,
    tagline: 'Ships on Linux, tests on a Mac, regrets it.',
  },
  {
    handle: 'ade-oyinlola',
    display: 'Ade Oyinlola',
    role: 'member',
    joined: '2023-01-23',
    rep: 419,
    tagline: 'Mobile web, mostly emulated devices.',
  },
  {
    handle: 'renata-kohl',
    display: 'Renata Kohl',
    role: 'member',
    joined: '2023-03-14',
    rep: 608,
    tagline: 'Banking. Everything needs an audit trail.',
  },
  {
    handle: 'yusuf-demir',
    display: 'Yusuf Demir',
    role: 'member',
    joined: '2023-05-09',
    rep: 201,
    tagline: 'Learning this in public.',
  },
  {
    handle: 'chandra-p',
    display: 'Chandra Pillai',
    role: 'member',
    joined: '2023-08-01',
    rep: 873,
    tagline: 'Migrated 900 Cypress specs. Ask about it.',
  },
  {
    handle: 'helle-borg',
    display: 'Helle Borg',
    role: 'member',
    joined: '2023-10-24',
    rep: 352,
    tagline: 'Accessibility auditor, external.',
  },
  {
    handle: 'nikhil-sane',
    display: 'Nikhil Sane',
    role: 'member',
    joined: '2024-02-06',
    rep: 487,
    tagline: 'Runs everything in Docker, including this.',
  },
  {
    handle: 'fiona-mcallister',
    display: 'Fiona McAllister',
    role: 'member',
    joined: '2024-04-18',
    rep: 159,
    tagline: 'Two-person team, no dedicated QA.',
  },
  {
    handle: 'bruno-teixeira',
    display: 'Bruno Teixeira',
    role: 'member',
    joined: '2024-07-30',
    rep: 694,
    tagline: 'Marketplace app, many roles, many pools.',
  },
  {
    handle: 'anouk-devries',
    display: 'Anouk de Vries',
    role: 'member',
    joined: '2024-09-12',
    rep: 238,
    tagline: 'Cares about the report more than the run.',
  },
  {
    handle: 'sergio-alcaraz',
    display: 'Sergio Alcaraz',
    role: 'member',
    joined: '2025-01-21',
    rep: 415,
    tagline: 'Self-hosted everything.',
  },
  {
    handle: 'tanvi-bhatt',
    display: 'Tanvi Bhatt',
    role: 'member',
    joined: '2025-03-04',
    rep: 126,
    tagline: 'First automation job, arrived in March.',
  },
  {
    handle: 'koen-vermeulen',
    display: 'Koen Vermeulen',
    role: 'member',
    joined: '2025-05-27',
    rep: 309,
    tagline: 'Editor tooling and MCP wiring.',
  },
  {
    handle: 'rasha-halabi',
    display: 'Rasha Halabi',
    role: 'member',
    joined: '2025-08-11',
    rep: 572,
    tagline: 'Release engineering. Gates are her problem.',
  },
  {
    handle: 'devon-marsh',
    display: 'Devon Marsh',
    role: 'member',
    joined: '2025-11-06',
    rep: 183,
    tagline: 'Evaluating this against two competitors.',
  },
  {
    handle: 'ingrid-solberg',
    display: 'Ingrid Solberg',
    role: 'member',
    joined: '2026-02-17',
    rep: 241,
    tagline: 'Took over a suite nobody had run in a year.',
  },
  {
    handle: 'paulo-mendes',
    display: 'Paulo Mendes',
    role: 'member',
    joined: '2026-04-08',
    rep: 97,
    tagline: 'Wants everything offline and reproducible.',
  },
  {
    handle: 'zeynep-arslan',
    display: 'Zeynep Arslan',
    role: 'member',
    joined: '2026-06-22',
    rep: 64,
    tagline: 'New to the tool, thorough about it.',
  },
];

const BY_HANDLE = new Map(PEOPLE.map((p) => [p.handle, p]));

export function person(handle: string): Person | undefined {
  return BY_HANDLE.get(handle as Handle);
}

/**
 * A stable hue per handle, so an avatar looks deliberate and never changes between builds.
 * Not cryptographic; it only has to spread 40 names around the wheel.
 */
export function avatarHue(handle: string): number {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** "Reeta Nandal" -> "RN". Falls back to the first two letters of a single-word name. */
export function initials(display: string): string {
  const parts = display.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return display.slice(0, 2).toUpperCase();
}
