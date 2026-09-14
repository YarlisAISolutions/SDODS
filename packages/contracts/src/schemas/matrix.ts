import { z } from 'zod';

/**
 * `projects/<slug>/roles.matrix.yaml` — the expected outcome of each role on each surface.
 *
 * `sdods matrix expand` turns every `@matrix:<name>` Scenario Outline into one `Examples:` block per
 * role, tagged `@user:<role>`, so an actor × surface grid is data rather than hundreds of
 * hand-written scenarios. Only the shape lives here; cross-field rules (every row has the same
 * columns, every role resolves to an outcome, `expect` keys are declared roles) are checked by
 * `loadRolesMatrices` in @sdods/core so they can be reported as lint findings.
 */

export const ROLES_MATRIX_FILE = 'roles.matrix.yaml';

/** A matrix name as it appears in `@matrix:<name>`. Checked by the loader for a readable message. */
export const MATRIX_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const MatrixCellSchema = z.union([z.string(), z.number(), z.boolean()]);

export const RolesMatrixRowSchema = z
  .object({
    /** One outcome for every role, or a per-role map; roles left out fall back to `default`. */
    expect: z.union([z.string().min(1), z.record(z.string(), z.string().min(1))]).optional(),
    /** Outcome for the roles this row's `expect` map does not name. Overrides the matrix default. */
    default: z.string().min(1).optional(),
  })
  // Every other key is an Examples column (`surface: /settings/billing` → `<surface>`).
  .catchall(MatrixCellSchema);

export const RolesMatrixSchema = z
  .object({
    description: z.string().optional(),
    /** The actors, in the order their Examples blocks are written. Each must be a declared role. */
    roles: z.array(z.string().regex(/^[^\s@|]+$/, 'a role cannot contain spaces, @ or |')).min(1),
    /** Outcome for any role a row does not name. */
    default: z.string().min(1).optional(),
    /** When set, every outcome must be one of these (catches `alowed`). */
    outcomes: z.array(z.string().min(1)).min(1).optional(),
    /** Example title, written as the `# title-format:` of each generated block. */
    title: z.string().min(1).optional(),
    rows: z.array(RolesMatrixRowSchema).min(1),
  })
  .strict();

export const RolesMatrixFileSchema = z
  .object({
    /** Keys are matrix names (`MATRIX_NAME_RE`), referenced as `@matrix:<name>`. */
    matrices: z.record(z.string(), RolesMatrixSchema),
  })
  .strict();

export type RolesMatrixRowInput = z.infer<typeof RolesMatrixRowSchema>;
export type RolesMatrixInput = z.infer<typeof RolesMatrixSchema>;
export type RolesMatrixFile = z.infer<typeof RolesMatrixFileSchema>;
