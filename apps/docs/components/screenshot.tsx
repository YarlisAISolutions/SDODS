import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { withBase } from '@/lib/base-path';

/**
 * Screenshot from `public/screenshots/` (run output collected at build time, or web UI captures).
 * Resolves the base path so the same MDX works on the custom domain and on project GitHub Pages.
 */
export function Screenshot({
  src,
  alt,
  caption,
  width = 1280,
  height = 720,
}: {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  return (
    <figure className="my-6">
      <ImageZoom
        src={withBase(src)}
        alt={alt}
        width={width}
        height={height}
        className="rounded-lg border border-fd-border"
      />
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
