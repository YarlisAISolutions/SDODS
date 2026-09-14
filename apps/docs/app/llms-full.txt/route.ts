import { llmsFull } from '@/lib/llms';

// Prerendered to out/llms-full.txt by the static export. Maxi reads this file.
export const dynamic = 'force-static';

export async function GET() {
  return new Response(await llmsFull(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
