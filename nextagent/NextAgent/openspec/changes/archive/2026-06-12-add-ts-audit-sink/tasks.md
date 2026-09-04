## 1. 规格

- [x] 1.1 定义 AUDIT surface 只消费 `add-ts-trace-log-linking` 的 `ObservabilityObservationEvent` stream。
  验证：spec requirement `AUDIT surface 必须消费统一 observation stream`。

- [x] 1.2 定义 AUDIT 领域对象：`AuditEvent`、`AuditEventWriter`、`AuditProjectionPolicy`、`AuditProjectionResult` 和 audit degradation evidence。
  验证：design `核心对象` 与 spec requirement `AUDIT domain objects 必须有稳定语义`。

- [x] 1.3 给出完整 AUDIT coverage 清单，逐项说明 timeline event、event 状态、增强需求、owner-deferred event 或 wrapper 来源。
  验证：design / spec 均包含 AUDIT coverage inventory。

- [x] 1.4 定义从 `ObservabilityObservationEvent` 到 `AuditEvent` 的映射、redaction、字段校验、幂等锚点和失败策略。
  验证：design `从 Observation 到 AuditEvent 的映射` 与 spec requirement `AuditEvent generation 必须从 observation 受控映射`。

## 2. 设计

- [x] 2.1 明确唯一产品路径：`ObservabilityProjectorHost` -> `AuditProjector` -> `AuditEventWriter`。
  验证：design `唯一产品路径`。

- [x] 2.2 明确本 change 不新增 `TimelineEventType`；需要新增业务 event 的场景由对应 owner change 定义。
  验证：design / spec coverage 清单均声明 owner-deferred event。

- [x] 2.3 明确 AUDIT projector 不影响业务模块，业务模块不 import audit writer / logger / metrics registry / tracer / observability SDK。
  验证：spec scenario `Audit uses the host handoff path`。

- [x] 2.4 明确 audit failure fail-closed / degraded，不阻塞业务结果。
  验证：spec requirement `AUDIT failures 必须显式、有界且不影响业务结果`。

## 3. 实现方案

- [x] 3.1 整改 `packages/agent-observability/src/audit/audit-projector.ts`：实现 fixed `AuditProjector`，输入只接受 `ObservabilityObservationEvent`，输出 `AuditProjectionResult`。
  验证：unit test 覆盖 emitted / skipped_not_covered / skipped_policy_denied / degraded / failed_closed。

- [x] 3.2 整改 audit coverage policy：按清单实现 `request.accepted`、`request.rejected`、`terminal.committed`、model governance failure、capability governance failure、gateway owner/credential failure、hook/policy、attachment intake 和 safe error。
  验证：unit test 覆盖每个 coverage item；普通 model/capability/gateway diagnostics 不产生 audit event。

- [x] 3.3 整改 observation -> `AuditEvent` 映射：生成稳定 `auditId`，复制可信 `ownerScope` / `occurredAt` / `stableRefs`，执行 AUDIT redaction，保留 normalized `usage` shape。
  验证：unit test 覆盖缺失 optional refs、省略不可用 usage、拒绝 unknown usage key、高基数字段和 raw payload。

- [x] 3.4 整改 `packages/agent-app/src/composition/create-app.ts`：移除直接 `auditProjector.project(...)` 产品路径，改为通过 `ObservabilityProjectorHost.acceptObservation(event): void` 后由 host 异步调用 `AuditProjector`。
  验证：source test 断言 app hooks / listeners / wrappers 不直接调用 audit projector 或 writer。

- [x] 3.5 清理 no-op writer 产品装配：产品 composition 不使用 `NoopAuditEventWriter` 作为正式 sink；测试 fake 保留在测试范围。
  验证：source test 断言 product composition 无 no-op writer 注入。

- [x] 3.6 添加 architecture / source negative tests：业务 package 不 import `AuditEventWriter`，wrapper 不直接写 audit sink，不存在 audit-only observation event、audit queue、audit replay path。
  验证：`npm run lint:architecture` 或 source tests 覆盖 negative fixtures。

## 4. 验证

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：全部通过。

- [x] 4.2 运行 `openspec validate add-ts-audit-sink --strict` 和 `openspec validate --all --strict`。
  验证：全部通过。
