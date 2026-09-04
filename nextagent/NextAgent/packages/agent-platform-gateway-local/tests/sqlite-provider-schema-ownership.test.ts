import {
  createSqliteLongTermMemoryStores,
  createSqliteResidualGatewayStores,
  createSqliteWorkingMemoryStores,
} from '@nextagent/agent-platform-gateway-local';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SQLite provider schema ownership', () => {
  it('keeps Working Memory tables out of the other provider databases', () => {
    const files = createProviderFiles();

    expectTables(files.workingMemory, [
      'request_runs',
      'sessions',
      'messages',
      'attachments',
      'timeline_events',
      'pending_inputs',
      'conversation_annotations',
      'conversation_shares',
    ]);
    expectNoTables(files.workingMemory, [
      'long_term_memory',
      'blobs',
      'attachment_intake_reservations',
      'task_trajectory',
      'todo_states_current',
      'audit_events',
    ]);
  });

  it('keeps Long-term Memory authority and FTS in one database', () => {
    const files = createProviderFiles();

    expectTables(files.longTermMemory, ['long_term_memory', 'long_term_memory_fts']);
    expectNoTables(files.longTermMemory, ['request_runs', 'sessions', 'messages', 'attachments', 'blobs', 'task_trajectory', 'audit_events']);
    expect(tableColumns(files.longTermMemory, 'long_term_memory')).toEqual([
      'tenant_id',
      'subject_id',
      'agent_id',
      'memory_instance',
      'long_term_memory_id',
      'version',
      'category',
      'knowledge_source_type',
      'sharing_state',
      'source_memory_id',
      'confidence',
      'state',
      'brief_index',
      'tags_json',
      'access_count',
      'recall_count',
      'extraction_count',
      'last_accessed_at',
      'archived_at',
      'archive_reason',
      'is_pinned',
      'source_trace_session_id',
      'source_trace_request_id',
      'source_trace_extraction_cycle_id',
      'source_trace_json',
      'content_json',
      'idempotency_key',
      'created_at',
      'updated_at',
    ]);
    expect(primaryKeyColumns(files.longTermMemory, 'long_term_memory')).toEqual([
      'tenant_id',
      'subject_id',
      'agent_id',
      'memory_instance',
      'long_term_memory_id',
    ]);
    expect(tableColumns(files.longTermMemory, 'long_term_memory_fts')).toEqual([
      'tenant_id',
      'subject_id',
      'agent_id',
      'memory_instance',
      'long_term_memory_id',
      'brief_index',
      'tags',
      'content_body',
    ]);
  });

  it('keeps only retained stores in the SQLite provider database', () => {
    const files = createProviderFiles();

    expectTables(files.sqlite, [
      'blobs',
      'attachment_intake_reservations',
      'task_trajectory',
      'todo_state_revisions',
      'todo_states_current',
      'user_question_activity',
    ]);
    expectNoTables(files.sqlite, [
      'request_runs',
      'sessions',
      'messages',
      'attachments',
      'timeline_events',
      'pending_inputs',
      'conversation_annotations',
      'conversation_shares',
      'long_term_memory',
      'audit_events',
    ]);
  });

  it.each([
    ['working-memory', createSqliteWorkingMemoryStores],
    ['long-term-memory', createSqliteLongTermMemoryStores],
    ['sqlite', createSqliteResidualGatewayStores],
  ] as const)('fails closed when the %s database path cannot be created', (_owner, createStores) => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-provider-failure-'));
    roots.push(root);
    const blockingFile = join(root, 'not-a-directory');
    writeFileSync(blockingFile, 'blocked', 'utf8');

    expect(() => createStores({ sqliteFile: join(blockingFile, 'provider.sqlite') })).toThrow();
    expect(existsSync(join(root, 'fallback.sqlite'))).toBe(false);
  });
});

function createProviderFiles(): { readonly workingMemory: string; readonly longTermMemory: string; readonly sqlite: string } {
  const root = mkdtempSync(join(tmpdir(), 'nextagent-provider-schema-'));
  roots.push(root);
  const files = {
    workingMemory: join(root, 'working-memory.sqlite'),
    longTermMemory: join(root, 'long-term-memory.sqlite'),
    sqlite: join(root, 'nextagent.sqlite'),
  };
  createSqliteWorkingMemoryStores({ sqliteFile: files.workingMemory }).close();
  createSqliteLongTermMemoryStores({ sqliteFile: files.longTermMemory }).close();
  createSqliteResidualGatewayStores({ sqliteFile: files.sqlite }).close();
  return files;
}

function expectTables(sqliteFile: string, expected: readonly string[]): void {
  const tables = tableNames(sqliteFile);
  for (const table of expected) {
    expect(tables, `expected ${table} in ${sqliteFile}`).toContain(table);
  }
}

function expectNoTables(sqliteFile: string, forbidden: readonly string[]): void {
  const tables = tableNames(sqliteFile);
  for (const table of forbidden) {
    expect(tables, `did not expect ${table} in ${sqliteFile}`).not.toContain(table);
  }
}

function tableNames(sqliteFile: string): readonly string[] {
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as Array<{ readonly name: string }>).map(
      (row) => row.name,
    );
  } finally {
    db.close();
  }
}

function tableColumns(sqliteFile: string, table: string): readonly string[] {
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ readonly name: string }>).map((row) => row.name);
  } finally {
    db.close();
  }
}

function primaryKeyColumns(sqliteFile: string, table: string): readonly string[] {
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ readonly name: string; readonly pk: number }>)
      .filter((row) => row.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((row) => row.name);
  } finally {
    db.close();
  }
}
