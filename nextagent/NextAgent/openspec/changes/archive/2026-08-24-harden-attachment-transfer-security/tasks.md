# 实施任务

按 `FN-8.5 上传和管理附件` 分组。每个改进点遵循"先写表达目标行为的测试并确认失败 → 实现 → 验证"。除非另注，命令在仓库根目录 `/Users/mac/Downloads/workspace/NextAgent` 运行。

## FN-8.5 上传和管理附件

### 下载审计事件（P1）

- [x] 1.1 编写下载审计事件测试。来源：`FN-8.5` + 系统质量属性（审计/可追溯性）+ `ts-hofs-file-download` ADDED「下载操作审计日志记录成功与失败」全部 Scenario。扩展 `packages/agent-attachment-runtime/tests/file-download-runtime.test.ts`，断言：materialize 成功产出 `DownloadAuditEvent`（`result=SUCCESS`，含 userId/tenantId/agentId/sessionId/objectName/sizeBytes/downloadId/timestamp）、失败产出 `result=FAILURE` 含 `reasonCode`、agentId 来自 `requireSession` 返回的 `UserSession.agentId`、事件不含文件内容/本地路径/凭据；`agentId` 不可被 `path` 参数覆盖。验证：`npm test -- packages/agent-attachment-runtime/tests/file-download-runtime.test.ts`，实施前确认新断言失败。
- [x] 1.2 实现 `DownloadAuditEvent` 与审计调用。来源：design「FN-8.5 → 修改方案 1」。在 `agent-attachment-runtime` 新增 `DownloadAuditEvent` interface（字段与 `UploadAuditEvent` 同形，增加 `objectName`/`downloadId`）；`FileDownloadPort`/`FileDownloadRuntime` 增加 `auditObserver?: (event: DownloadAuditEvent) => void` 依赖；下载路由（`requests.ts:861-921`）改为 `const session = await requireSession(...)` 接收返回值，materialize 成功与失败时分别调用 audit（`agentId: session.agentId`）。验证：`npm test -- packages/agent-attachment-runtime/tests/file-download-runtime.test.ts`，新断言通过。
- [x] 1.3 下载审计 negative case 验证。来源：design「验证策略」+ Scenario「下载审计的 agentId 来自会话绑定 Agent Scope」。扩展测试断言：从 `path`/请求体注入 agentId 标识时审计事件 `agentId` 不被覆盖；materialize 抛错时仍记录 FAILURE 审计且不抛出审计异常。验证：`npm test -- packages/agent-attachment-runtime/tests/file-download-runtime.test.ts`。

### 下载并发限制（P2-并发）

- [x] 2.1 编写下载并发限制测试。来源：`FN-8.5` + 系统质量属性（性能/容量）+ `ts-hofs-file-download` ADDED「全局下载并发限制」全部 Scenario。新增/扩展测试断言：4 个 materialize 并发放行、第 5 个等待、30s 超时返回 503、materialize 完成（成功/失败）后释放槽位。验证：`npm test -- packages/agent-attachment-runtime/tests/file-download-runtime.test.ts`，实施前确认失败。
- [x] 2.2 实现 `DownloadConcurrencyLimiter`。来源：design「FN-8.5 → 修改方案 2」。在 `agent-attachment-runtime` 新增 `DownloadConcurrencyLimiter`（与 `UploadConcurrencyLimiter` 同形，`MAX_DOWNLOAD_CONCURRENCY=4`、`CONCURRENCY_TIMEOUT_MS=30_000`，超限超时返回 503）；下载路由 materialize 前 `acquire`、materialize 完成后 `release`（try/finally）。验证：`npm test -- packages/agent-attachment-runtime/tests/file-download-runtime.test.ts`，新断言通过。

## 共享任务（跨改进点）

- [x] 3.1 composition 接线。来源：design「FN-8.5 → 修改方案 1/2」+ proposal 影响范围。在 `agent-app/src/composition/attachment-composition.ts` 与 `create-app.ts` 为 `FileDownloadRuntime` 接线 `auditObserver`（对齐 `UploadAuditEvent` 的 `auditObserver` 接线模式）与 `DownloadConcurrencyLimiter`；确认 `FileDownloadPort` local port 边界不变。验证：`npm run build` 与 `npm test -- packages/agent-channel-web/tests/file-download-validation.test.ts`。
- [x] 3.2 架构边界验证。来源：design「验证策略」。新增/扩展 architecture test 断言：`agent-channel-web` 不直接 import `BlobStoreGateway`、`FileDownloadPort` 为 structural local port、无 private path import。验证：`npm run lint:architecture`。
- [x] 3.3 整体验证。来源：proposal 影响范围 + AGENTS.md 验证门禁。运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npx openspec validate --all --strict`，全部通过；确认前端无需改动（下载安全改动均在后端）。验证：上述命令退出码 0。
- [ ] 3.4 归档前基线检查（非实施任务）。来源：design「长期基线刷新计划」。归档前确认同步：`ts-hofs-file-download` stable spec 补 `所属 Function: FN-8.5` + 2 requirements、`FN-8.5` 文档规格表、`F-8.4` Feature 边界、`spec-to-design-map` 补 `ts-hofs-file-download` 行、`agent-attachment-runtime`/`agent-channel-web` modules 描述。验证：`npx openspec validate --all --strict` 与归档同步检查。
