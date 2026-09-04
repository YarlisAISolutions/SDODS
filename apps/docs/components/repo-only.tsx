import type { ReactNode } from 'react';
import { REPO_PUBLIC } from '@/lib/links';

/**
 * Hides a block of docs that only makes sense while the repository is public — a `git clone`
 * command, a link into the source tree, the releases page. Flip NEXT_PUBLIC_REPO_PUBLIC to
 * bring every one of them back at once.
 */
export function RepoOnly({ children }: { children: ReactNode }) {
  return REPO_PUBLIC ? <>{children}</> : null;
}
