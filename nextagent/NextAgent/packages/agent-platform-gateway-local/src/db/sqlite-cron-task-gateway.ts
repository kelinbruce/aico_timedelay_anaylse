import {
  AgentError,
  CRON_MAX_TASKS_PER_SCOPE,
  brand,
  cronTaskLimitReachedError,
  type AgentId,
  type EpochMillis,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  BindCronTriggerRunRequest,
  BindCronTriggerRunResult,
  ClaimCronTriggerRequest,
  ClaimCronTriggerResult,
  CronTaskAgentScopeQuery,
  ClaimedCronTriggerDeliveryRecord,
  CronTaskAgentListRequest,
  CronTaskAgentLookupRequest,
  CronClaimedTriggerListRequest,
  CronDueTaskListRequest,
  CronTaskGatewayPort,
  CronTaskListRequest,
  CronTaskLookupRequest,
  CronTaskTriggerListRequest,
  CronTaskRecord,
  CronTaskWriteOptions,
  CronTriggerDeliveryLookupRequest,
  CronTriggerLookupRequest,
  CronTriggerRecord,
} from '@nextagent/agent-contracts/gateway';
import { DatabaseSync } from 'node:sqlite';

interface CronTaskRow {
  task_id: string;
  tenant_id: string;
  subject_id: string;
  agent_id: string;
  cron: string;
  prompt: string;
  target_kind: CronTaskRecord['targetKind'] | null;
  target_name: string | null;
  recurring: number;
  status: CronTaskRecord['status'];
  next_run_at: number;
  version: number;
  created_at: number;
  updated_at: number;
  created_by_name: string | null;
}

interface CronTriggerRow {
  trigger_id: string;
  task_id: string;
  tenant_id: string;
  subject_id: string;
  agent_id: string;
  session_id: string | null;
  scheduled_at: number;
  status: CronTriggerRecord['status'];
  request_run_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ClaimedCronTriggerDeliveryRow {
  t_task_id: string;
  t_tenant_id: string;
  t_subject_id: string;
  t_agent_id: string;
  t_cron: string;
  t_prompt: string;
  t_target_kind: CronTaskRecord['targetKind'] | null;
  t_target_name: string | null;
  t_recurring: number;
  t_status: CronTaskRecord['status'];
  t_next_run_at: number;
  t_version: number;
  t_created_at: number;
  t_updated_at: number;
  t_created_by_name: string | null;
  ct_trigger_id: string;
  ct_task_id: string;
  ct_tenant_id: string;
  ct_subject_id: string;
  ct_agent_id: string;
  ct_session_id: string | null;
  ct_scheduled_at: number;
  ct_status: CronTriggerRecord['status'];
  ct_request_run_id: string | null;
  ct_created_at: number;
  ct_updated_at: number;
}

interface TableColumnInfo {
  name: string;
  notnull: number;
  pk: number;
}

export class SqliteCronTaskGateway implements CronTaskGatewayPort {
  private readonly db: DatabaseSync;

  constructor(sqliteFile: string) {
    this.db = new DatabaseSync(sqliteFile);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  async createTask(record: CronTaskRecord, options: CronTaskWriteOptions = {}): Promise<CronTaskRecord> {
    assertValidTaskTargetRecord(record);
    return this.transaction(() => {
      if (options.idempotencyKey !== undefined) {
        const replay = this.selectTaskByIdempotency(record, String(options.idempotencyKey));
        if (replay !== undefined) {
          return replay;
        }
      } else {
        const existing = this.selectTaskByLookup(record);
        if (existing !== undefined) {
          return existing;
        }
      }
      if (record.status === 'ACTIVE' && this.countActiveTasksForAgentSync(record) >= CRON_MAX_TASKS_PER_SCOPE) {
        throw cronTaskLimitReachedError();
      }
      this.db
        .prepare(
          `INSERT OR IGNORE INTO cron_tasks(
        task_id, tenant_id, subject_id, agent_id, cron, prompt, target_kind, target_name, recurring, status,
        next_run_at, version, created_at, updated_at, created_by_name, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.taskId,
          record.tenantId,
          record.subjectId,
          record.agentId,
          record.cron,
          record.prompt,
          record.targetKind ?? null,
          record.targetName ?? null,
          record.recurring ? 1 : 0,
          record.status,
          record.nextRunAt,
          record.version,
          record.createdAt,
          record.updatedAt,
          record.createdByName ?? null,
          options.idempotencyKey ?? null,
        );
      const stored =
        options.idempotencyKey === undefined ? this.selectTaskByLookup(record) : this.selectTaskByIdempotency(record, String(options.idempotencyKey));
      if (stored === undefined) {
        throw new Error('CRON_TASK_CREATE_FAILED');
      }
      return stored;
    });
  }

  async loadTask(request: CronTaskLookupRequest): Promise<CronTaskRecord | undefined> {
    return this.selectTaskByLookup(request);
  }

  async loadTaskForAgent(request: CronTaskAgentLookupRequest): Promise<CronTaskRecord | undefined> {
    return taskFromRow(
      this.db
        .prepare(`${taskSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND status <> 'DELETED'`)
        .get(request.tenantId, request.subjectId, request.agentId, request.taskId) as CronTaskRow | undefined,
    );
  }

  async listTasks(request: CronTaskListRequest): Promise<readonly CronTaskRecord[]> {
    const rows = this.db
      .prepare(
        `${taskSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?${request.includeDeleted ? '' : " AND status <> 'DELETED'"} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, request.limit ?? 100, request.offset ?? 0) as unknown as CronTaskRow[];
    return rows.map(taskFromRequiredRow);
  }

  async listTasksForAgent(request: CronTaskAgentListRequest): Promise<readonly CronTaskRecord[]> {
    const rows = this.db
      .prepare(
        `${taskSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?${request.includeDeleted ? '' : " AND status <> 'DELETED'"} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(request.tenantId, request.subjectId, request.agentId, request.limit ?? 100, request.offset ?? 0) as unknown as CronTaskRow[];
    return rows.map(taskFromRequiredRow);
  }

  async countTasksForAgent(request: CronTaskAgentListRequest): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM cron_tasks WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?${request.includeDeleted ? '' : " AND status <> 'DELETED'"}`,
      )
      .get(request.tenantId, request.subjectId, request.agentId) as { readonly total: number } | undefined;
    return row?.total ?? 0;
  }

  async countActiveTasksForAgent(request: CronTaskAgentScopeQuery): Promise<number> {
    return this.countActiveTasksForAgentSync(request);
  }

  async updateTask(record: CronTaskRecord, options: CronTaskWriteOptions = {}): Promise<CronTaskRecord | undefined> {
    assertValidTaskTargetRecord(record);
    const expected = options.expectedVersion;
    const result = this.db
      .prepare(
        `UPDATE cron_tasks
      SET cron = ?, prompt = ?, target_kind = ?, target_name = ?, recurring = ?, status = ?, next_run_at = ?, version = ?, updated_at = ?
      WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND status <> 'DELETED'${expected === undefined ? '' : ' AND version = ?'}`,
      )
      .run(
        record.cron,
        record.prompt,
        record.targetKind ?? null,
        record.targetName ?? null,
        record.recurring ? 1 : 0,
        record.status,
        record.nextRunAt,
        record.version,
        record.updatedAt,
        record.tenantId,
        record.subjectId,
        record.agentId,
        record.taskId,
        ...(expected === undefined ? [] : [expected]),
      );
    if (result.changes === 0) {
      return undefined;
    }
    return this.loadTask(record);
  }

  async deleteTask(request: CronTaskLookupRequest, options: CronTaskWriteOptions = {}): Promise<CronTaskRecord | undefined> {
    const expected = options.expectedVersion;
    this.db
      .prepare(
        `UPDATE cron_tasks SET status = 'DELETED', version = version + 1, updated_at = ?
      WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND status <> 'DELETED'${expected === undefined ? '' : ' AND version = ?'}`,
      )
      .run(Date.now(), request.tenantId, request.subjectId, request.agentId, request.taskId, ...(expected === undefined ? [] : [expected]));
    return this.loadTask(request);
  }

  async listDueTasks(request: CronDueTaskListRequest): Promise<readonly CronTaskRecord[]> {
    const rows = this.db
      .prepare(`${taskSelect} WHERE status = 'ACTIVE' AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?`)
      .all(request.dueAtOrBefore, request.limit) as unknown as CronTaskRow[];
    return rows.map(taskFromRequiredRow);
  }

  async listClaimedTriggers(request: CronClaimedTriggerListRequest): Promise<readonly ClaimedCronTriggerDeliveryRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT ${taskColumns('t')}, ${triggerColumns('ct')}
      FROM cron_triggers ct
      JOIN cron_tasks t ON t.tenant_id = ct.tenant_id AND t.subject_id = ct.subject_id AND t.agent_id = ct.agent_id AND t.task_id = ct.task_id
      WHERE ct.status = 'CLAIMED' AND ct.request_run_id IS NULL
      ORDER BY ct.created_at ASC
      LIMIT ?`,
      )
      .all(request.limit) as unknown as ClaimedCronTriggerDeliveryRow[];
    return rows.map((row) => ({
      task: taskFromRequiredRow(taskRowFromClaimedDeliveryRow(row)),
      trigger: triggerFromRequiredRow(triggerRowFromClaimedDeliveryRow(row)),
    }));
  }

  async loadTriggerDelivery(request: CronTriggerDeliveryLookupRequest): Promise<ClaimedCronTriggerDeliveryRecord | undefined> {
    const rows = this.db
      .prepare(
        `SELECT ${taskColumns('t')}, ${triggerColumns('ct')}
      FROM cron_triggers ct
      JOIN cron_tasks t ON t.tenant_id = ct.tenant_id AND t.subject_id = ct.subject_id AND t.agent_id = ct.agent_id AND t.task_id = ct.task_id
      WHERE ct.task_id = ? AND ct.trigger_id = ?
      LIMIT 2`,
      )
      .all(request.taskId, request.triggerId) as unknown as ClaimedCronTriggerDeliveryRow[];
    if (rows.length > 1) {
      throw new AgentError({
        code: 'CRON_TRIGGER_DELIVERY_AMBIGUOUS',
        message: 'Cron trigger delivery lookup is ambiguous.',
        category: 'AUTHORIZATION',
        retryable: false,
      });
    }
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          task: taskFromRequiredRow(taskRowFromClaimedDeliveryRow(row)),
          trigger: triggerFromRequiredRow(triggerRowFromClaimedDeliveryRow(row)),
        };
  }

  async loadTrigger(request: CronTriggerLookupRequest): Promise<CronTriggerRecord | undefined> {
    return triggerFromRow(
      this.db
        .prepare(`${triggerSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND trigger_id = ?`)
        .get(request.tenantId, request.subjectId, request.agentId, request.taskId, request.triggerId) as CronTriggerRow | undefined,
    );
  }

  async listTriggersForTask(request: CronTaskTriggerListRequest): Promise<readonly CronTriggerRecord[]> {
    const rows = this.db
      .prepare(
        `${triggerSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? ORDER BY scheduled_at DESC, created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        request.tenantId,
        request.subjectId,
        request.agentId,
        request.taskId,
        request.limit ?? 100,
        request.offset ?? 0,
      ) as unknown as CronTriggerRow[];
    return rows.map(triggerFromRequiredRow);
  }

  async countTriggersForTask(request: CronTaskTriggerListRequest): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM cron_triggers WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ?')
      .get(request.tenantId, request.subjectId, request.agentId, request.taskId) as { readonly total: number } | undefined;
    return row?.total ?? 0;
  }

  async claimCronTrigger(request: ClaimCronTriggerRequest): Promise<ClaimCronTriggerResult> {
    return this.transaction(() => {
      const existing = this.selectTriggerByAnchor(request);
      if (existing !== undefined) {
        return { status: 'ALREADY_CLAIMED', trigger: existing };
      }
      const task = this.selectTaskForClaim(request);
      if (task === undefined) {
        return { status: 'TASK_NOT_FOUND' };
      }
      if (task.status !== 'ACTIVE') {
        return { status: 'TASK_NOT_ACTIVE', task };
      }
      this.db
        .prepare(
          `INSERT INTO cron_triggers(trigger_id, task_id, tenant_id, subject_id, agent_id, scheduled_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?)`,
        )
        .run(request.triggerId, task.taskId, task.tenantId, task.subjectId, task.agentId, request.scheduledAt, request.claimedAt, request.claimedAt);
      const nextStatus = task.recurring ? 'ACTIVE' : 'COMPLETED';
      const nextRunAt = task.recurring ? request.nextRunAt : undefined;
      if (task.recurring && nextRunAt === undefined) {
        throw new Error('CRON_NEXT_RUN_REQUIRED');
      }
      this.db
        .prepare(
          'UPDATE cron_tasks SET status = ?, next_run_at = ?, version = version + 1, updated_at = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND version = ?',
        )
        .run(nextStatus, nextRunAt ?? task.nextRunAt, request.claimedAt, task.tenantId, task.subjectId, task.agentId, task.taskId, task.version);
      const trigger = this.selectTriggerByAnchor(request);
      const updatedTask = this.selectTaskForClaim(request);
      return { status: 'CLAIMED', ...(trigger === undefined ? {} : { trigger }), ...(updatedTask === undefined ? {} : { task: updatedTask }) };
    });
  }

  async bindCronTriggerRun(request: BindCronTriggerRunRequest): Promise<BindCronTriggerRunResult> {
    return this.transaction(() => {
      const trigger = this.selectTriggerById(request);
      if (trigger === undefined) {
        return { status: 'TRIGGER_NOT_FOUND' };
      }
      if (trigger.requestRunId !== undefined) {
        return { status: trigger.requestRunId === request.requestRunId ? 'ALREADY_BOUND' : 'RUN_CONFLICT', trigger };
      }
      this.db
        .prepare(
          "UPDATE cron_triggers SET session_id = ?, request_run_id = ?, status = 'ACCEPTED', updated_at = ? WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND trigger_id = ? AND request_run_id IS NULL",
        )
        .run(
          request.sessionId,
          request.requestRunId,
          request.acceptedAt,
          request.tenantId,
          request.subjectId,
          request.agentId,
          request.taskId,
          request.triggerId,
        );
      const bound = this.selectTriggerById(request);
      return { status: 'BOUND', ...(bound === undefined ? {} : { trigger: bound }) };
    });
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const taskColumns = this.tableColumns('cron_tasks');
    const triggerColumns = this.tableColumns('cron_triggers');
    const legacyTaskSchema = taskColumns.some((column) => column.name === 'session_id');
    const legacyTriggerSchema = triggerColumns.some((column) => column.name === 'session_id' && (column.notnull === 1 || column.pk > 0));
    if (legacyTaskSchema || legacyTriggerSchema) {
      this.rebuildLegacySessionScopedSchema(taskColumns.length > 0, triggerColumns.length > 0);
    }
    this.db.exec(`${cronSchemaSql}
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_tasks_idempotency ON cron_tasks(tenant_id, subject_id, agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_cron_tasks_scope ON cron_tasks(tenant_id, subject_id, agent_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_cron_tasks_agent_scope ON cron_tasks(tenant_id, subject_id, agent_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_cron_tasks_agent_lookup ON cron_tasks(tenant_id, subject_id, agent_id, task_id, status);
    CREATE INDEX IF NOT EXISTS idx_cron_tasks_due ON cron_tasks(status, next_run_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_trigger_anchor ON cron_triggers(tenant_id, subject_id, agent_id, task_id, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_cron_trigger_delivery ON cron_triggers(status, request_run_id, created_at);`);
    this.ensureTargetColumns();
  }

  private ensureTargetColumns(): void {
    const columns = new Set(this.tableColumns('cron_tasks').map((column) => column.name));
    if (!columns.has('target_kind')) {
      this.db.exec('ALTER TABLE cron_tasks ADD COLUMN target_kind TEXT;');
    }
    if (!columns.has('target_name')) {
      this.db.exec('ALTER TABLE cron_tasks ADD COLUMN target_name TEXT;');
    }
    if (!columns.has('created_by_name')) {
      this.db.exec('ALTER TABLE cron_tasks ADD COLUMN created_by_name TEXT;');
    }
  }

  private rebuildLegacySessionScopedSchema(hasTasks: boolean, hasTriggers: boolean): void {
    this.db.exec('PRAGMA foreign_keys = OFF;');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DROP TABLE IF EXISTS cron_triggers_legacy_session_migration; DROP TABLE IF EXISTS cron_tasks_legacy_session_migration;');
      if (hasTriggers) {
        this.db.exec('ALTER TABLE cron_triggers RENAME TO cron_triggers_legacy_session_migration;');
      }
      if (hasTasks) {
        this.db.exec('ALTER TABLE cron_tasks RENAME TO cron_tasks_legacy_session_migration;');
      }
      this.db.exec(cronSchemaSql);
      if (hasTasks) {
        this.db.exec(`INSERT OR IGNORE INTO cron_tasks(
          task_id, tenant_id, subject_id, agent_id, cron, prompt, target_kind, target_name, recurring, status,
          next_run_at, version, created_at, updated_at, created_by_name, idempotency_key
        )
        SELECT task_id, tenant_id, subject_id, agent_id, cron, prompt, NULL, NULL, recurring, status,
          next_run_at, version, created_at, updated_at, NULL, idempotency_key
        FROM cron_tasks_legacy_session_migration
        ORDER BY created_at ASC;`);
      }
      if (hasTriggers) {
        this.db.exec(`INSERT OR IGNORE INTO cron_triggers(
          trigger_id, task_id, tenant_id, subject_id, agent_id, session_id, scheduled_at,
          status, request_run_id, created_at, updated_at
        )
        SELECT trigger_id, task_id, tenant_id, subject_id, agent_id, session_id, scheduled_at,
          status, request_run_id, created_at, updated_at
        FROM cron_triggers_legacy_session_migration
        ORDER BY created_at ASC;`);
      }
      this.db.exec('DROP TABLE IF EXISTS cron_triggers_legacy_session_migration; DROP TABLE IF EXISTS cron_tasks_legacy_session_migration;');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  private tableColumns(tableName: 'cron_tasks' | 'cron_triggers'): readonly TableColumnInfo[] {
    return this.db.prepare(`PRAGMA table_info(${tableName})`).all() as unknown as TableColumnInfo[];
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private selectTaskByIdempotency(scope: CronTaskRecord, key: string): CronTaskRecord | undefined {
    return taskFromRow(
      this.db
        .prepare(`${taskSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND idempotency_key = ?`)
        .get(scope.tenantId, scope.subjectId, scope.agentId, key) as CronTaskRow | undefined,
    );
  }

  private selectTaskByLookup(request: CronTaskLookupRequest): CronTaskRecord | undefined {
    return taskFromRow(
      this.db
        .prepare(`${taskSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ?`)
        .get(request.tenantId, request.subjectId, request.agentId, request.taskId) as CronTaskRow | undefined,
    );
  }

  private countActiveTasksForAgentSync(request: CronTaskAgentScopeQuery): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total
        FROM cron_tasks
        WHERE tenant_id = ?
          AND subject_id = ?
          AND agent_id = ?
          AND status = 'ACTIVE'`,
      )
      .get(request.tenantId, request.subjectId, request.agentId) as { readonly total: number } | undefined;
    return row?.total ?? 0;
  }

  private selectTaskForClaim(request: Pick<ClaimCronTriggerRequest, 'tenantId' | 'subjectId' | 'agentId' | 'taskId'>): CronTaskRecord | undefined {
    return this.selectTaskByLookup(request);
  }

  private selectTriggerByAnchor(request: ClaimCronTriggerRequest): CronTriggerRecord | undefined {
    return triggerFromRow(
      this.db
        .prepare(`${triggerSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND scheduled_at = ?`)
        .get(request.tenantId, request.subjectId, request.agentId, request.taskId, request.scheduledAt) as CronTriggerRow | undefined,
    );
  }

  private selectTriggerById(request: BindCronTriggerRunRequest): CronTriggerRecord | undefined {
    return triggerFromRow(
      this.db
        .prepare(`${triggerSelect} WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND task_id = ? AND trigger_id = ?`)
        .get(request.tenantId, request.subjectId, request.agentId, request.taskId, request.triggerId) as CronTriggerRow | undefined,
    );
  }
}

const cronSchemaSql = `CREATE TABLE IF NOT EXISTS cron_tasks (
      task_id TEXT NOT NULL, tenant_id TEXT NOT NULL, subject_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      cron TEXT NOT NULL, prompt TEXT NOT NULL, target_kind TEXT, target_name TEXT, recurring INTEGER NOT NULL, status TEXT NOT NULL,
      next_run_at INTEGER NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, created_by_name TEXT, idempotency_key TEXT,
      PRIMARY KEY(tenant_id, subject_id, agent_id, task_id)
    );
    CREATE TABLE IF NOT EXISTS cron_triggers (
      trigger_id TEXT NOT NULL, task_id TEXT NOT NULL, tenant_id TEXT NOT NULL, subject_id TEXT NOT NULL,
      agent_id TEXT NOT NULL, session_id TEXT, scheduled_at INTEGER NOT NULL, status TEXT NOT NULL,
      request_run_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(tenant_id, subject_id, agent_id, task_id, trigger_id),
      FOREIGN KEY(tenant_id, subject_id, agent_id, task_id) REFERENCES cron_tasks(tenant_id, subject_id, agent_id, task_id)
    );`;

const taskSelect =
  'SELECT task_id, tenant_id, subject_id, agent_id, cron, prompt, target_kind, target_name, recurring, status, next_run_at, version, created_at, updated_at, created_by_name FROM cron_tasks';
const triggerSelect =
  'SELECT trigger_id, task_id, tenant_id, subject_id, agent_id, session_id, scheduled_at, status, request_run_id, created_at, updated_at FROM cron_triggers';

function taskColumns(alias: string): string {
  return `${alias}.task_id AS ${alias}_task_id, ${alias}.tenant_id AS ${alias}_tenant_id, ${alias}.subject_id AS ${alias}_subject_id, ${alias}.agent_id AS ${alias}_agent_id, ${alias}.cron AS ${alias}_cron, ${alias}.prompt AS ${alias}_prompt, ${alias}.target_kind AS ${alias}_target_kind, ${alias}.target_name AS ${alias}_target_name, ${alias}.recurring AS ${alias}_recurring, ${alias}.status AS ${alias}_status, ${alias}.next_run_at AS ${alias}_next_run_at, ${alias}.version AS ${alias}_version, ${alias}.created_at AS ${alias}_created_at, ${alias}.updated_at AS ${alias}_updated_at, ${alias}.created_by_name AS ${alias}_created_by_name`;
}

function triggerColumns(alias: string): string {
  return `${alias}.trigger_id AS ${alias}_trigger_id, ${alias}.task_id AS ${alias}_task_id, ${alias}.tenant_id AS ${alias}_tenant_id, ${alias}.subject_id AS ${alias}_subject_id, ${alias}.agent_id AS ${alias}_agent_id, ${alias}.session_id AS ${alias}_session_id, ${alias}.scheduled_at AS ${alias}_scheduled_at, ${alias}.status AS ${alias}_status, ${alias}.request_run_id AS ${alias}_request_run_id, ${alias}.created_at AS ${alias}_created_at, ${alias}.updated_at AS ${alias}_updated_at`;
}

function taskFromRow(row?: CronTaskRow): CronTaskRecord | undefined {
  return row === undefined ? undefined : taskFromRequiredRow(row);
}

function taskFromRequiredRow(row: CronTaskRow): CronTaskRecord {
  const target = targetFromRow(row);
  return {
    taskId: row.task_id,
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    cron: row.cron,
    prompt: row.prompt,
    ...target,
    recurring: row.recurring === 1,
    status: row.status,
    nextRunAt: brand<number, 'EpochMillis'>(row.next_run_at),
    version: row.version,
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
    ...(row.created_by_name === null ? {} : { createdByName: row.created_by_name }),
  };
}
function targetFromRow(row: CronTaskRow): Pick<CronTaskRecord, 'targetKind' | 'targetName'> {
  if (row.target_kind === null && row.target_name === null) {
    return {};
  }
  if ((row.target_kind !== 'SKILL' && row.target_kind !== 'WORKFLOW') || row.target_name === null || row.target_name.length === 0) {
    throw new AgentError({
      code: 'CRON_TASK_TARGET_INVALID',
      message: 'Cron task target is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return { targetKind: row.target_kind, targetName: row.target_name };
}
function assertValidTaskTargetRecord(record: CronTaskRecord): void {
  const hasKind = record.targetKind !== undefined;
  const hasName = record.targetName !== undefined;
  if (!hasKind && !hasName) {
    return;
  }
  if ((record.targetKind !== 'SKILL' && record.targetKind !== 'WORKFLOW') || record.targetName === undefined || record.targetName.length === 0) {
    throw new AgentError({
      code: 'CRON_TASK_TARGET_INVALID',
      message: 'Cron task target is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}
function taskRowFromClaimedDeliveryRow(row: ClaimedCronTriggerDeliveryRow): CronTaskRow {
  return {
    task_id: row.t_task_id,
    tenant_id: row.t_tenant_id,
    subject_id: row.t_subject_id,
    agent_id: row.t_agent_id,
    cron: row.t_cron,
    prompt: row.t_prompt,
    target_kind: row.t_target_kind,
    target_name: row.t_target_name,
    recurring: row.t_recurring,
    status: row.t_status,
    next_run_at: row.t_next_run_at,
    version: row.t_version,
    created_at: row.t_created_at,
    updated_at: row.t_updated_at,
    created_by_name: row.t_created_by_name,
  };
}
function triggerFromRow(row?: CronTriggerRow): CronTriggerRecord | undefined {
  return row === undefined ? undefined : triggerFromRequiredRow(row);
}
function triggerFromRequiredRow(row: CronTriggerRow): CronTriggerRecord {
  return {
    triggerId: row.trigger_id,
    taskId: row.task_id,
    tenantId: brand<string, 'TenantId'>(row.tenant_id),
    subjectId: brand<string, 'SubjectId'>(row.subject_id),
    agentId: brand<string, 'AgentId'>(row.agent_id),
    ...(row.session_id === null ? {} : { sessionId: brand<string, 'SessionId'>(row.session_id) }),
    scheduledAt: brand<number, 'EpochMillis'>(row.scheduled_at),
    status: row.status,
    ...(row.request_run_id === null ? {} : { requestRunId: brand<string, 'RequestRunId'>(row.request_run_id) }),
    createdAt: brand<number, 'EpochMillis'>(row.created_at),
    updatedAt: brand<number, 'EpochMillis'>(row.updated_at),
  };
}
function triggerRowFromClaimedDeliveryRow(row: ClaimedCronTriggerDeliveryRow): CronTriggerRow {
  return {
    trigger_id: row.ct_trigger_id,
    task_id: row.ct_task_id,
    tenant_id: row.ct_tenant_id,
    subject_id: row.ct_subject_id,
    agent_id: row.ct_agent_id,
    session_id: row.ct_session_id,
    scheduled_at: row.ct_scheduled_at,
    status: row.ct_status,
    request_run_id: row.ct_request_run_id,
    created_at: row.ct_created_at,
    updated_at: row.ct_updated_at,
  };
}

export function createSqliteCronTaskGateway(sqliteFile: string): SqliteCronTaskGateway {
  return new SqliteCronTaskGateway(sqliteFile);
}
