'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

/** Renders a Mermaid diagram on the client; used for ```mermaid fences and <Mermaid chart="..."/>. */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  const [svg, setSvg] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        fontFamily: 'inherit',
        theme: resolvedTheme === 'dark' ? 'dark' : 'neutral',
        // Mermaid 12 defaults to ELK and the `neo` look. The diagrams on these pages (the C4 set
        // in particular) were sized against dagre, so keep that layout and the classic look.
        layout: 'dagre',
        look: 'classic',
      });
      try {
        const { svg: out } = await mermaid.render(
          `mermaid-${id.replace(/[^a-zA-Z0-9]/g, '')}`,
          chart.replaceAll('\\n', '\n'),
          containerRef.current ?? undefined,
        );
        if (!cancelled) setSvg(out);
      } catch (e) {
        if (!cancelled) setSvg(`<pre>${String(e)}</pre>`);
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  return (
    <div
      // A wide diagram scrolls sideways, and a scroll container is only usable from the
      // keyboard if it can be focused.
      tabIndex={0}
      role="region"
      aria-label="Diagram"
      className="sdods-mermaid my-6 overflow-x-auto"
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
