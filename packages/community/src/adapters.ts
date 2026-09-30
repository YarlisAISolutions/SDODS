/**
 * What a deployment needs to write its own adapters: a CommunityStore for its database, a
 * Verifier and RoleClaims for its identity provider. `@sdods/community/adapters`.
 *
 * The package root (`@sdods/community`) is for running the service; this entry point is for
 * implementing its ports, and exports the helpers every store shares so documents keep one shape
 * whichever database holds them.
 */
export type {
  IssuerOptions,
  OidcVerifierOptions,
  Role,
  RoleClaims,
  Verifier,
  Viewer,
} from './auth.js';
export { votePath, type Doc, type Transact, type Write } from './engagement.js';
export type { VoteValue } from './reputation.js';
export {
  POST_PATH,
  collectionOf,
  feedbackRecord,
  fieldsFor,
  newId,
  toPendingEdit,
  toPublicAnswer,
  toPublicProfile,
  toPublicQuestion,
  toPublicRevision,
  toQueueItem,
  type CommunityStore,
  type Feedback,
  type NewPost,
  type PendingEdit,
  type PublicAnswer,
  type PublicProfile,
  type PublicQuestion,
  type PublicRevision,
  type QueueItem,
  type ReviewLog,
  type ReviewSummary,
  type Target,
  type UserRecord,
} from './store.js';
