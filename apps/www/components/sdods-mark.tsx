/**
 * The SDODS mark and lockup, inline.
 *
 * Inline rather than `<img src="/img/…">` on purpose. An SVG loaded through `<img>` is an isolated
 * document: `currentColor` resolves against the SVG's own root instead of the page, and page
 * webfonts are unavailable to it. Both of those were live bugs — the lockup's wordmark was baked
 * to `#0B1020` and vanished on the dark background, and its 'Space Grotesk' silently fell back to
 * whatever the OS had.
 *
 * Rendered inline, the structure inherits the surrounding text colour and is correct in both
 * themes with no duplicate light/dark assets. The amber core stays literal: it is the one fixed
 * point of the identity and reads on either ground.
 *
 * Geometry is kept in step with `brand/mark.svg` and `brand/sdods.svg` by
 * `tests/brand-sync.test.ts`.
 */

export function SdodsMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label="SDODS"
      fill="none"
    >
      <g transform="translate(64,64)" strokeLinecap="round">
        <path d="M-40 -26 A 30 30 0 0 0 -40 26" stroke="currentColor" strokeWidth="11" />
        <path d="M40 -26 A 30 30 0 0 1 40 26" stroke="currentColor" strokeWidth="11" />
        <circle cx="0" cy="0" r="20" stroke="currentColor" strokeWidth="11" />
        <circle cx="0" cy="0" r="7" fill="#FFB020" />
      </g>
    </svg>
  );
}

/**
 * The full lockup: the name inside the aperture, with the tagline beneath.
 *
 * The wordmark is real text so it inherits the page's font stack rather than the SVG's isolated
 * one. `aria-hidden` because callers supply the accessible name — the heading text is the title,
 * this is its visual form.
 */
export function SdodsLockup({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 150" className={className} aria-hidden="true" fill="none">
      <g transform="translate(30,0)">
        <g strokeLinecap="round" strokeWidth="10">
          <path d="M28 26 A 58 58 0 0 0 28 110" stroke="currentColor" />
          <path d="M446 26 A 58 58 0 0 1 446 110" stroke="currentColor" />
        </g>
        <text
          x="78"
          y="94"
          fill="currentColor"
          fontSize="76"
          fontWeight="700"
          letterSpacing="10"
          fontFamily="inherit"
        >
          SD
        </text>
        <g transform="translate(237,68)">
          <circle cx="0" cy="0" r="21" stroke="currentColor" strokeWidth="10" />
          <circle cx="0" cy="0" r="7" fill="#FFB020" />
        </g>
        <text
          x="272"
          y="94"
          fill="currentColor"
          fontSize="76"
          fontWeight="700"
          letterSpacing="10"
          fontFamily="inherit"
        >
          DS
        </text>
        <text
          x="237"
          y="129"
          textAnchor="middle"
          fill="currentColor"
          opacity="0.62"
          fontSize="16"
          fontWeight="500"
          letterSpacing="3.1"
          fontFamily="inherit"
        >
          Test automation you can defend.
        </text>
      </g>
    </svg>
  );
}
