import type { ReactNode } from 'react';
import { SCENES, type SceneName } from './scenes';

/**
 * Places one illustration in the prose. The caption is the sentence the drawing is making, so a
 * reader who only looks at the pictures still gets the argument of the page.
 */
export function Art({ scene, caption }: { scene: SceneName; caption?: string }) {
  const Scene = SCENES[scene];
  return (
    <figure className="my-7">
      <Scene />
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Two tile-sized scenes side by side on wide screens, stacked on a phone. */
export function ArtRow({ children }: { children: ReactNode }) {
  return <div className="my-7 grid gap-5 sm:grid-cols-2 [&_figure]:my-0">{children}</div>;
}
