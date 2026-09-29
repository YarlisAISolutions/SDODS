/**
 * Edits with revision history, and suggested edits.
 *
 * Who edits how, as on Stack Overflow:
 * - the author, editors and admins, and anyone with `editRep` reputation, edit directly;
 * - everyone else suggests an edit, which an editor approves (the suggester earns +2) or rejects.
 *
 * Every applied edit becomes a revision in `revisions/{id}` (post, revision number, title, body, who,
 * comment). The first edit also records the original as revision 0, so the history is complete from
 * the post's first version. Edits name the revision they started from (`baseRevision`): if the post
 * moved on in the meantime the edit is refused, not silently merged over someone else's change.
 *
 * The content itself is reviewed by the AI reviewer before any of this runs (server.ts), exactly
 * like a new post: an edit cannot turn an approved post into spam.
 */

import { forEditing } from './badges.js';
import { userWrites, type Doc, type Transact, type Write } from './engagement.js';
import { REP, type RepChange } from './reputation.js';

export type EditOutcome =
  | { ok: true; applied: true; revision: number }
  | { ok: true; applied: false; suggestionId: string }
  | { ok: false; error: 'not_found' | 'conflict' | 'not_editable' };

export type ResolveEditOutcome =
  { ok: true; applied: boolean } | { ok: false; error: 'not_found' | 'conflict' };

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const isQuestion = (path: string) => /^questions\/[^/]+$/.test(path);

interface Change {
  title?: string;
  body: string;
  comment: string;
}

/** The writes that apply a change to a post and record it as the next revision. */
function applyWrites(
  post: Doc,
  path: string,
  change: Change,
  by: { uid: string; name: string },
  now: Date,
  newId: () => string,
): { writes: Write[]; revision: number } {
  const current = num(post.revision, 0);
  const writes: Write[] = [];
  if (current === 0) {
    // The original, recorded once so the history starts at the first version.
    writes.push({
      path: `revisions/${newId()}`,
      fields: {
        post: path,
        revision: 0,
        ...(isQuestion(path) ? { title: str(post.title) ?? '' } : {}),
        body: str(post.body) ?? '',
        by: str(post.uid) ?? '',
        byName: str(post.name) ?? '',
        comment: 'Original',
        status: 'applied',
        createdAt: typeof post.createdAt === 'string' ? new Date(post.createdAt) : now,
      },
    });
  }
  const revision = current + 1;
  const fields: Doc = { body: change.body, revision, editedAt: now, editedBy: by.uid };
  if (isQuestion(path) && change.title) fields.title = change.title;
  writes.push({ path, fields, mask: Object.keys(fields) });
  writes.push({
    path: `revisions/${newId()}`,
    fields: {
      post: path,
      revision,
      ...(isQuestion(path) ? { title: change.title ?? str(post.title) ?? '' } : {}),
      body: change.body,
      by: by.uid,
      byName: by.name,
      comment: change.comment,
      status: 'applied',
      createdAt: now,
    },
  });
  return { writes, revision };
}

/**
 * An edit from `by`. `direct` says whether this person may edit without review (the caller decides
 * from role and reputation; the author always may).
 */
export async function editPost(
  transact: Transact,
  newId: () => string,
  e: {
    by: { uid: string; name: string };
    direct: boolean;
    /** Force a suggestion even for someone who could edit directly (the reviewer was unsure). */
    needsReview: boolean;
    path: string;
    baseRevision: number;
    change: Change;
  },
  now = new Date(),
): Promise<EditOutcome> {
  return transact<EditOutcome>(async (get) => {
    const post = await get(e.path);
    if (!post || post.status !== 'published')
      return { writes: [], result: { ok: false, error: 'not_found' } };
    // Replies stay as written: editing someone's conversational reply rewrites what they said.
    if (str(post.parentId) && str(post.uid) !== e.by.uid)
      return { writes: [], result: { ok: false, error: 'not_editable' } };
    if (num(post.revision, 0) !== e.baseRevision)
      return { writes: [], result: { ok: false, error: 'conflict' } };

    const direct = (e.direct || str(post.uid) === e.by.uid) && !e.needsReview;
    if (!direct) {
      const id = newId();
      return {
        writes: [
          {
            path: `revisions/${id}`,
            fields: {
              post: e.path,
              baseRevision: e.baseRevision,
              ...(isQuestion(e.path) && e.change.title ? { title: e.change.title } : {}),
              body: e.change.body,
              by: e.by.uid,
              byName: e.by.name,
              comment: e.change.comment,
              status: 'pending',
              createdAt: now,
            },
          },
        ],
        result: { ok: true, applied: false, suggestionId: id },
      };
    }

    const { writes, revision } = applyWrites(post, e.path, e.change, e.by, now, newId);
    writes.push(
      ...(await userWrites(
        get,
        [],
        [{ uid: e.by.uid, award: (have) => forEditing(have, now) }],
        { path: e.path, by: e.by.uid, at: now },
        newId,
      )),
    );
    return { writes, result: { ok: true, applied: true, revision } };
  });
}

/** An editor approves or rejects a suggested edit. */
export async function resolveEdit(
  transact: Transact,
  newId: () => string,
  r: { id: string; editor: string; action: 'approve' | 'reject'; reason: string },
  now = new Date(),
): Promise<ResolveEditOutcome> {
  return transact<ResolveEditOutcome>(async (get) => {
    const revPath = `revisions/${r.id}`;
    const rev = await get(revPath);
    if (!rev || rev.status !== 'pending')
      return { writes: [], result: { ok: false, error: 'not_found' } };
    const resolution = { resolvedBy: r.editor, resolvedAt: now, reason: r.reason };

    if (r.action === 'reject')
      return {
        writes: [
          {
            path: revPath,
            fields: { status: 'rejected', ...resolution },
            mask: ['status', 'resolvedBy', 'resolvedAt', 'reason'],
          },
        ],
        result: { ok: true, applied: false },
      };

    const path = String(rev.post);
    const post = await get(path);
    if (!post || post.status !== 'published')
      return { writes: [], result: { ok: false, error: 'not_found' } };
    // The post changed after the suggestion was made: applying it would undo the newer edit.
    if (num(post.revision, 0) !== num(rev.baseRevision, 0))
      return { writes: [], result: { ok: false, error: 'conflict' } };

    const by = { uid: String(rev.by), name: String(rev.byName ?? '') };
    const change: Change = {
      ...(typeof rev.title === 'string' ? { title: rev.title } : {}),
      body: String(rev.body),
      comment: String(rev.comment ?? ''),
    };
    const { writes, revision } = applyWrites(post, path, change, by, now, newId);
    // The suggestion itself becomes a record of the decision; the applied revision is a new row.
    writes.push({
      path: revPath,
      fields: { status: 'approved', appliedAs: revision, ...resolution },
      mask: ['status', 'appliedAs', 'resolvedBy', 'resolvedAt', 'reason'],
    });
    const bonus: RepChange[] =
      by.uid && by.uid !== str(post.uid)
        ? [{ uid: by.uid, delta: REP.suggestedEdit, reason: 'edit-approved' }]
        : [];
    writes.push(
      ...(await userWrites(
        get,
        bonus,
        [{ uid: by.uid, award: (have) => forEditing(have, now) }],
        { path, by: r.editor, at: now },
        newId,
      )),
    );
    return { writes, result: { ok: true, applied: true } };
  });
}
