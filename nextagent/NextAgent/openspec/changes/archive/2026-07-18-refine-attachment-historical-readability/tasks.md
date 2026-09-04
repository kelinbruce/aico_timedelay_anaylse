## 1. 契约与存储

- [x] 1.1 在 `agent-contracts/gateway` 新增 `ListAttachmentsBySessionRequest extends OwnerScoped`（`agentId`、`sessionId`）与 `AttachmentStoreGateway.listAttachmentsBySession`。
  验证：`npm run build`；`rg "listAttachmentsBySession" packages/agent-contracts/src/gateway/`。
  来源：design D1；spec `request-attachments` Requirement `Historical attachments remain readable across turns`

- [x] 1.2 `SqliteGatewayCore` 实现 `listAttachmentsBySession`（`WHERE tenant_id=? AND subject_id=? AND agent_id=? AND session_id=? ORDER BY created_at ASC, attachment_id ASC`），新增 `idx_attachments_session` 索引；`SqliteAttachmentStore` 委托。
  验证：`npm test -- packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts`（新增 session 查询用例，含跨 session 隔离断言）。
  来源：design D1

## 2. Runtime 物化范围

- [x] 2.1 `DefaultAgent.resolveAttachmentRefs` 改用 `listAttachmentsBySession`（按 `run.sessionId`），过滤 `ACCEPTED`+`AVAILABLE`，返回当前 + 历史全部附件 ref。
  验证：`npm run build`；default-agent / runtime 相关测试覆盖会话内多请求附件均被物化。
  来源：design D2；spec `request-attachments` Requirement `Historical attachments remain readable across turns`

- [x] 2.2 negative：不可用历史附件不被物化、不暴露 modelPath 并降级。runtime 侧 `resolveAttachmentRefs` 的 `availabilityStatus === AVAILABLE` 过滤为既有未改动逻辑（本 change 仅改查询方法，不回归）；上下文引擎侧由 `attachment-request-context-flow.test.ts` 的 "degrades unavailable historical attachments to metadata-only without a modelPath" 用例断言：不可用历史附件 `modelPath` 为 undefined 且发 `ATTACHMENT_HISTORICAL_DEGRADED` 降级证据。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/attachment-request-context-flow.test.ts`（9 passed）。
  来源：design D2/D4；AGENTS.md negative case 要求

## 3. 上下文引擎

- [x] 3.1 `toAttachmentEvidence`：对 `availabilityStatus===AVAILABLE` 的附件，`request` 与 `history` 来源均输出 `modelPath = temp/attachments/{attachmentId}/{basename(fileName)}`；不可用不给。
  验证：`npm test -- packages/agent-context-engine/tests/attachment-request-context-flow.test.ts`（新增历史可用附件带 modelPath 断言）。
  来源：design D3；spec `request-attachments` Requirement `Historical attachments remain readable across turns`

- [x] 3.2 `collectAttachmentEvidence` 历史分支：仅 `availabilityStatus!==AVAILABLE` 时 push `attachmentDegradationEvidence`；可用历史不发降级证据。
  验证：测试断言可用历史无降级证据、不可用历史有 `ATTACHMENT_HISTORICAL_DEGRADED`。
  来源：design D4；spec `request-attachments` Requirement `Historical attachments remain readable across turns`

## 4. 验证门禁

- [x] 4.1 `openspec validate refine-attachment-historical-readability --strict` 通过。
  验证：命令退出码 0。
  来源：AGENTS.md 验证门禁

- [x] 4.2 `openspec validate --all --strict` 通过。
  验证：命令退出码 0。
  来源：AGENTS.md 验证门禁

- [x] 4.3 `npm run build` 通过。
  验证：命令退出码 0。
  来源：AGENTS.md 验证门禁

- [x] 4.4 `npm test` 通过（含 context-engine、sqlite-gateway-stores、default-agent 相关）。
  验证：命令退出码 0。
  来源：AGENTS.md 验证门禁

- [x] 4.5 启动 dev:watch，上传 md 文件发问（第 1 轮），再发追问（第 2 轮不重新带文件），确认第 2 轮模型能读到历史文件且无 `ATTACHMENT_HISTORICAL_DEGRADED` 降级通知。
  验证：手动页面验证 + 后端日志确认历史附件被物化、模型 Read 成功。
  来源：proposal 目标
