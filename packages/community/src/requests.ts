/** What the browser may send, validated before anything else happens. */

export const LIMITS = {
  titleMin: 10,
  titleMax: 200,
  bodyMin: 20,
  bodyMax: 10_000,
  answerMin: 10,
  reasonMax: 500,
} as const;

/** The categories the existing ask form and firestore.rules already use. */
export const CATEGORIES = ['ui', 'api', 'hybrid', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const SLUG = /^[a-z0-9-]{1,120}$/;
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : null);

export interface QuestionRequest {
  title: string;
  body: string;
  category: Category;
}

export function parseQuestion(body: unknown): Parsed<QuestionRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = text(b.title);
  const content = text(b.body);
  const category = b.category ?? 'other';
  if (!title || title.length < LIMITS.titleMin || title.length > LIMITS.titleMax)
    return {
      ok: false,
      error: `The title must be ${LIMITS.titleMin}–${LIMITS.titleMax} characters.`,
    };
  if (!content || content.length < LIMITS.bodyMin || content.length > LIMITS.bodyMax)
    return {
      ok: false,
      error: `The question must be ${LIMITS.bodyMin}–${LIMITS.bodyMax.toLocaleString('en')} characters.`,
    };
  if (!CATEGORIES.includes(category as Category))
    return { ok: false, error: `category must be one of ${CATEGORIES.join(', ')}` };
  return { ok: true, value: { title, body: content, category: category as Category } };
}

export type AnswerTarget = { questionId: string } | { slug: string };

export interface AnswerRequest {
  target: AnswerTarget;
  /** '' for an answer; an answer's id for a reply to it. */
  parentId: string;
  body: string;
}

export function parseAnswer(body: unknown): Parsed<AnswerRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const content = text(b.body);
  const parentId = b.parentId ?? '';
  if (!content || content.length < LIMITS.answerMin || content.length > LIMITS.bodyMax)
    return {
      ok: false,
      error: `The answer must be ${LIMITS.answerMin}–${LIMITS.bodyMax.toLocaleString('en')} characters.`,
    };
  if (typeof parentId !== 'string' || (parentId !== '' && !DOC_ID.test(parentId)))
    return { ok: false, error: 'parentId must be an answer id or empty' };
  const hasQ = typeof b.questionId === 'string';
  const hasS = typeof b.slug === 'string';
  if (hasQ === hasS) return { ok: false, error: 'Send exactly one of questionId or slug' };
  if (hasQ && !DOC_ID.test(b.questionId as string)) return { ok: false, error: 'Bad questionId' };
  if (hasS && !SLUG.test(b.slug as string)) return { ok: false, error: 'Bad slug' };
  return {
    ok: true,
    value: {
      target: hasQ ? { questionId: b.questionId as string } : { slug: b.slug as string },
      parentId,
      body: content,
    },
  };
}

export interface ResolveRequest {
  path: string;
  action: 'approve' | 'reject';
  reason: string;
}

export function parseResolve(body: unknown, pathPattern: RegExp): Parsed<ResolveRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const reason = text(b.reason) ?? '';
  if (typeof b.path !== 'string' || !pathPattern.test(b.path))
    return { ok: false, error: 'Bad post path' };
  if (b.action !== 'approve' && b.action !== 'reject')
    return { ok: false, error: 'action must be approve or reject' };
  if (b.action === 'reject' && !reason)
    return { ok: false, error: 'Say why, so the author knows what to change' };
  if (reason.length > LIMITS.reasonMax) return { ok: false, error: 'The reason is too long' };
  return { ok: true, value: { path: b.path, action: b.action, reason } };
}

export interface RoleRequest {
  uid: string;
  role: 'member' | 'editor' | 'admin';
}

export function parseRole(body: unknown): Parsed<RoleRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.uid !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(b.uid))
    return { ok: false, error: 'Bad uid' };
  if (b.role !== 'member' && b.role !== 'editor' && b.role !== 'admin')
    return { ok: false, error: 'role must be member, editor or admin' };
  return { ok: true, value: { uid: b.uid, role: b.role } };
}
