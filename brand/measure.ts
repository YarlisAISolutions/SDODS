/**
 * Measure the lockup's optical spacing instead of eyeballing it.
 *
 * The centre O is a drawn circle, not a glyph, so it does not participate in the font's metrics —
 * its position is a hand-placed number and there is nothing to stop it drifting out of rhythm with
 * the letters either side. The first cut sat noticeably far from the D on its left, so the word
 * read as two: "SD ODS".
 *
 *   node --import tsx brand/measure.ts
 *
 * Reports the two gaps flanking the O and the average gap between letters, so the O can be placed
 * to match the word's own rhythm rather than a guess.
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Box {
  x: number;
  right: number;
  width: number;
}

async function main() {
  const svg = readFileSync(join(import.meta.dirname, 'sdods.svg'), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<body style="margin:0">${svg}</body>`);

    // No named local functions inside evaluate: tsx compiles them through esbuild's keepNames
    // helper, which references a `__name` that does not exist in the browser context.
    const m = (await page.evaluate(`(() => {
      const round = (n) => Math.round(n * 10) / 10;
      // getBBox() reports the element's OWN coordinate system, before its transform. The centre
      // O carries a translate(), so a raw getBBox put it at -21..21 and made the gap arithmetic
      // meaningless. Map the box through the element's CTM, relative to the root, so every number
      // is in the same space.
      const root = document.querySelector('svg');
      const bb = (el) => {
        if (!el) return null;
        const b = el.getBBox();
        const m = root.getScreenCTM().inverse().multiply(el.getScreenCTM());
        const p = root.createSVGPoint();
        p.x = b.x; p.y = b.y;
        const a = p.matrixTransform(m);
        p.x = b.x + b.width;
        const c = p.matrixTransform(m);
        return { x: round(a.x), right: round(c.x), width: round(c.x - a.x) };
      };
      const texts = [...document.querySelectorAll('text')];
      const o = [...document.querySelectorAll('g')].find(
        (g) => g.querySelectorAll(':scope > circle').length === 2,
      );
      const arcs = [...document.querySelectorAll('path')];
      return { sd: bb(texts[0]), ds: bb(texts[1]), o: bb(o || null), arcL: bb(arcs[0]), arcR: bb(arcs[1]) };
    })()`)) as Record<string, Box | null>;

    const { sd, ds, o, arcL, arcR } = m;
    if (!sd || !ds || !o || !arcL || !arcR) throw new Error('could not locate every element');

    const beforeO = +(o.x - sd.right).toFixed(1);
    const afterO = +(ds.x - o.right).toFixed(1);
    // "SD" is two glyphs plus one inter-letter space; the same for "DS". Their advance minus the
    // ink gives roughly the rhythm the O should sit inside.
    const insideGapL = +(arcL.right ? sd.x - arcL.right : 0).toFixed(1);
    const insideGapR = +(arcR.x - ds.right).toFixed(1);

    console.log('lockup spacing (user units)\n');
    console.log(`  SD        ${sd.x} → ${sd.right}   width ${sd.width}`);
    console.log(`  O         ${o.x} → ${o.right}   width ${o.width}`);
    console.log(`  DS        ${ds.x} → ${ds.right}   width ${ds.width}\n`);
    console.log(`  gap SD→O  ${beforeO}`);
    console.log(`  gap O→DS  ${afterO}`);
    console.log(`  imbalance ${+(beforeO - afterO).toFixed(1)}  (0 is centred)\n`);
    console.log(`  arc→SD    ${insideGapL}`);
    console.log(`  DS→arc    ${insideGapR}`);
    console.log(
      `  imbalance ${+(insideGapL - insideGapR).toFixed(1)}  (0 is centred in the aperture)`,
    );
  } finally {
    await browser.close();
  }
}

await main();
