export type Row = Record<string, string | number | boolean | null>;

export interface DataProvider {
  load<T extends Row = Row>(dataset: string): Promise<T[]>;
  row<T extends Row = Row>(dataset: string, index: number): Promise<T>;
  find<T extends Row = Row>(dataset: string, where: Partial<T>): Promise<T | undefined>;
  factory<T = Record<string, unknown>>(name: string, overrides?: Partial<T>): Promise<T>;
  registerCleanup(fn: () => Promise<void>, description?: string): void;
  runCleanups(): Promise<Array<{ description?: string; error: string }>>;
}

export interface LeasedUser {
  id: string;
  username: string;
  password: string;
  role: string;
  index: number;
  extra: Row;
  leaseKey: string;
  owner: string;
}

export interface LeaseStore {
  tryAcquire(userId: string, owner: string, ttlMs: number): Promise<boolean>;
  release(userId: string, owner: string): Promise<void>;
  releaseAll(owner: string): Promise<void>;
  owners(): Promise<Record<string, string>>;
}

export interface UserPool {
  lease(role: string, parallelIndex: number): Promise<LeasedUser>;
  release(user: LeasedUser): Promise<void>;
  releaseAll(): Promise<void>;
  status(): Promise<Array<{ id: string; username: string; role: string; owner?: string }>>;
}
