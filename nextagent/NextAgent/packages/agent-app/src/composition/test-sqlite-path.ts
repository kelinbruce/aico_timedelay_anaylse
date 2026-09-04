import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function createIsolatedTestSqliteFile(): string {
  return join(tmpdir(), 'nextagent-test-data', randomUUID(), 'nextagent.sqlite');
}

export function createIsolatedTestSqlitePaths(): {
  readonly workingMemorySqliteFile: string;
  readonly longTermMemorySqliteFile: string;
  readonly sqliteFile: string;
} {
  const root = join(tmpdir(), 'nextagent-test-data', randomUUID());
  return {
    workingMemorySqliteFile: join(root, 'working-memory.sqlite'),
    longTermMemorySqliteFile: join(root, 'long-term-memory.sqlite'),
    sqliteFile: join(root, 'nextagent.sqlite'),
  };
}
