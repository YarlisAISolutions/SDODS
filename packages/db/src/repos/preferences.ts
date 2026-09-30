import type { Kysely } from 'kysely';
import { enc, nowIso, readJson, readTs } from '../col.js';
import { newId } from '../ids.js';
import type { Database } from '../schema.js';

export interface UserPreference<T = unknown> {
  key: string;
  value: T;
  updatedAt: string | null;
}

export async function getUserPreference<T = unknown>(
  db: Kysely<Database>,
  userId: string,
  key: string,
): Promise<UserPreference<T> | null> {
  const row = await db
    .selectFrom('user_preferences')
    .select(['key', 'value_json', 'updated_at'])
    .where('user_id', '=', userId)
    .where('key', '=', key)
    .executeTakeFirst();
  if (!row) return null;
  return {
    key: row.key,
    value: readJson<T>(row.value_json) as T,
    updatedAt: readTs(row.updated_at),
  };
}

/** Insert or replace one preference; returns the stored row. */
export async function setUserPreference<T = unknown>(
  db: Kysely<Database>,
  userId: string,
  key: string,
  value: T,
): Promise<UserPreference<T>> {
  const now = nowIso();
  const existing = await db
    .selectFrom('user_preferences')
    .select('id')
    .where('user_id', '=', userId)
    .where('key', '=', key)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable('user_preferences')
      .set({ value_json: enc.json(value), updated_at: now } as any)
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db
      .insertInto('user_preferences')
      .values({
        id: newId(),
        user_id: userId,
        key,
        value_json: enc.json(value),
        created_at: now,
        updated_at: now,
      } as any)
      .execute();
  }
  return { key, value, updatedAt: now };
}

export async function deleteUserPreference(
  db: Kysely<Database>,
  userId: string,
  key: string,
): Promise<void> {
  await db
    .deleteFrom('user_preferences')
    .where('user_id', '=', userId)
    .where('key', '=', key)
    .execute();
}
