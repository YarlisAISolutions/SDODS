import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundledSkillsDir,
  frontmatter,
  installSkills,
  listBundledSkills,
} from '../src/skills-catalog.js';

describe('bundled skills', () => {
  it('each skill has a spec-valid name that matches its folder, and a description', () => {
    const skills = listBundledSkills();
    expect(skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(['sdods', 'sdods-record', 'sdods-run', 'sdods-start-ui']),
    );
    for (const s of skills) {
      expect(s.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.name.length).toBeLessThanOrEqual(64);
      expect(s.dir.endsWith(`/${s.name}`)).toBe(true);
      expect(s.description.length).toBeGreaterThan(40);
      expect(s.description.length).toBeLessThanOrEqual(1024);
    }
  });

  it('never tells an installed user to run `npx sdods`, a package that does not exist', () => {
    for (const s of listBundledSkills()) {
      expect(readFileSync(join(s.dir, 'SKILL.md'), 'utf8')).not.toMatch(/npx (-y )?sdods\b/);
    }
  });

  it('parses single-line frontmatter', () => {
    expect(frontmatter('---\nname: x\ndescription: "hi"\n---\nbody')).toEqual({
      name: 'x',
      description: 'hi',
    });
    expect(frontmatter('no frontmatter')).toEqual({});
  });
});

describe('installSkills', () => {
  it('copies into .claude/skills and .agents/skills by default, then skips unless forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-skills-'));
    const first = installSkills({ rootDir: root, skills: ['sdods-run'] });
    expect(first.map((r) => [r.target, r.status])).toEqual([
      ['claude', 'installed'],
      ['agents', 'installed'],
    ]);
    expect(existsSync(join(root, '.claude/skills/sdods-run/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.agents/skills/sdods-run/SKILL.md'))).toBe(true);

    const edited = join(root, '.claude/skills/sdods-run/SKILL.md');
    writeFileSync(edited, 'local edit');
    expect(installSkills({ rootDir: root, skills: ['sdods-run'] })[0]?.status).toBe('skipped');
    expect(readFileSync(edited, 'utf8')).toBe('local edit');
    expect(installSkills({ rootDir: root, skills: ['sdods-run'], force: true })[0]?.status).toBe(
      'replaced',
    );
    expect(readFileSync(edited, 'utf8')).toBe(
      readFileSync(join(bundledSkillsDir(), 'sdods-run/SKILL.md'), 'utf8'),
    );
  });

  it('installs globally under the home directory, using ~/.copilot for Copilot', () => {
    const home = mkdtempSync(join(tmpdir(), 'sdods-home-'));
    const r = installSkills({
      rootDir: '/unused',
      global: true,
      home,
      targets: ['copilot', 'gemini'],
      skills: ['sdods'],
    });
    expect(r.map((x) => x.path)).toEqual([
      join(home, '.copilot/skills/sdods'),
      join(home, '.gemini/skills/sdods'),
    ]);
  });

  it('rejects an unknown skill name', () => {
    expect(() => installSkills({ rootDir: tmpdir(), skills: ['nope'] })).toThrow(/Unknown skill/);
  });
});
