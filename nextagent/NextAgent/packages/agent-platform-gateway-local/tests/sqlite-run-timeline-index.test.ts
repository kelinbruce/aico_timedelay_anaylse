import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const RUN_TIMELINE_INDEX = 'idx_timeline_events_run_sequence';
const EXPECTED_COLUMNS = ['tenant_id', 'subject_id', 'agent_id', 'session_id', 'run_id', 'sequence'];

describe('timeline_events run-scoped query index', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates the run-scoped index for a new database and keeps reopen idempotent', () => {
    const sqliteFile = createDatabasePath(directories);

    createSqliteGatewayStores({ sqliteFile }).close?.();
    createSqliteGatewayStores({ sqliteFile }).close?.();

    expect(readIndexColumns(sqliteFile)).toEqual(EXPECTED_COLUMNS);
    expect(readRunQueryPlan(sqliteFile)).toContain(`USING INDEX ${RUN_TIMELINE_INDEX}`);
  });

  it('adds the run-scoped index to an existing timeline_events table without changing its columns', () => {
    const sqliteFile = createDatabasePath(directories);
    const legacy = new DatabaseSync(sqliteFile);
    legacy.exec(`
      CREATE TABLE timeline_events (
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        idempotency_key TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, subject_id, agent_id, session_id, sequence)
      );
    `);
    const originalColumns = readTableColumns(legacy);
    legacy.close();

    createSqliteGatewayStores({ sqliteFile }).close?.();

    const diagnostic = new DatabaseSync(sqliteFile, { readOnly: true });
    try {
      expect(readTableColumns(diagnostic)).toEqual(originalColumns);
      expect(readIndexColumnsFromDatabase(diagnostic)).toEqual(EXPECTED_COLUMNS);
    } finally {
      diagnostic.close();
    }
  });
});

function createDatabasePath(directories: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'nextagent-timeline-index-'));
  directories.push(directory);
  return join(directory, 'gateway.sqlite');
}

function readIndexColumns(sqliteFile: string): string[] {
  const database = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    return readIndexColumnsFromDatabase(database);
  } finally {
    database.close();
  }
}

function readIndexColumnsFromDatabase(database: DatabaseSync): string[] {
  const rows = database.prepare(`PRAGMA index_info(${RUN_TIMELINE_INDEX})`).all() as Array<{
    readonly name: string;
  }>;
  return rows.map((row) => row.name);
}

function readTableColumns(database: DatabaseSync): string[] {
  const rows = database.prepare('PRAGMA table_info(timeline_events)').all() as Array<{
    readonly name: string;
  }>;
  return rows.map((row) => row.name);
}

function readRunQueryPlan(sqliteFile: string): string {
  const database = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `
      EXPLAIN QUERY PLAN
      SELECT json
      FROM timeline_events
      WHERE tenant_id = ?
        AND subject_id = ?
        AND agent_id = ?
        AND session_id = ?
        AND sequence > ?
        AND run_id = ?
      ORDER BY sequence ASC
      LIMIT ?
    `,
      )
      .all('tenant', 'subject', 'agent', 'session', 0, 'run', 100) as Array<{
      readonly detail: string;
    }>;
    return rows.map((row) => row.detail).join('\n');
  } finally {
    database.close();
  }
}
