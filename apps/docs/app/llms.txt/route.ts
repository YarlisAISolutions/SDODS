import { llmsIndex } from '@/lib/llms';

// Prerendered to out/llms.txt by the static export.
export const dynamic = 'force-static';

export function GET() {
  return new Response(llmsIndex(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
