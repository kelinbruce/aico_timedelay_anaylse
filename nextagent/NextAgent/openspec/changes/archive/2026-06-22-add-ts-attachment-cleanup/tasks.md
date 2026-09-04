## 1. 规格冻结与契约落点

- [x] 1.1 冻结 `ts-attachment-cleanup` 的触发来源、同步/异步 handoff 边界和“无 scheduler”范围，确保 cleanup 只由显式可信流程触发。
  验证：spec 场景覆盖 admission-gap orphan、blob-missing availability cleanup、no-scheduler negative case；code review 检查点为 proposal/design/spec 三者一致。
  来源：spec requirement “附件 cleanup 触发与阶段边界”；design 决策 1、2。
- [x] 1.2 定义 cleanup port 的最小 request/result 语义、stable outcome vocabulary 和 cleanup reason code 边界；如现有 owner contract surface 不足，补充唯一 owner 的公共契约。
  验证：contract review + architecture check，确认不复用 direct path/`BlobRef` 输入，也不新增平行 DTO/port。
  来源：spec requirement “cleanup 输入与可信前置条件”“cleanup 状态与产物契约”；design 决策 5、6。

## 2. Trusted 输入与 owner-scoped 校验

- [x] 2.1 实现 cleanup request 的 trusted owner/agent/attachment 定位校验，只接受 trusted owner scope、`agentId` 和权威 attachment refs 或可信 request/session/run 坐标。
  验证：contract tests 覆盖缺少可信定位信息、cross-owner、cross-agent、伪造 attachment ref 的失败路径。
  来源：spec requirement “cleanup 输入与可信前置条件”；design 决策 5。
- [x] 2.2 添加 negative verification：cleanup 不得接受 direct `BlobRef`、local path、remote URL、客户端自报 availability/validation status 作为删除依据。
  验证：security/negative tests 实际触发 direct `BlobRef`/path 输入并断言 validation/authorization failure。
  来源：spec requirement “cleanup 输入与可信前置条件”；proposal scope “不得信任客户端路径或 `BlobRef`”。

## 3. Metadata/blob cleanup 执行路径

- [x] 3.1 实现权威 `RequestAttachment` 加载、message 引用保护检查和 cleanup 核心判断顺序，确保被 `SessionMessage.attachmentIds` 引用的附件 metadata 不被删除。
  验证：integration test 覆盖 referenced attachment cleanup，只允许 metadata retained。
  来源：spec requirement “cleanup 核心判断与执行顺序”；design 决策 3、4。
- [x] 3.2 实现 referenced attachment 的 availability 收敛：允许删除 blob 并将 `availabilityStatus` 更新为 `UNAVAILABLE`，但保留 metadata 和原始 `validationStatus`。
  验证：integration test 覆盖 referenced attachment blob delete + metadata retained + validation preserved。
  来源：spec requirement “cleanup 核心判断与执行顺序”“cleanup 状态与产物契约”；design 决策 3、4。
- [x] 3.3 实现 orphan / unreferenced attachment cleanup：删除 blob（若存在）并将 metadata 收敛为 `UNAVAILABLE`，保留 owner/session/request/run/attachment 可追溯事实。
  验证：integration test 覆盖 admission-gap orphan 和 partial staging orphan cleanup。
  来源：spec requirement “cleanup 核心判断与执行顺序”；proposal scope “orphan cleanup handoff”。
- [x] 3.4 实现 blob 已缺失时的显式收敛，不静默成功；cleanup outcome 必须区分 `COMPLETED`、`ALREADY_UNAVAILABLE`、`NOT_FOUND`、`REJECTED`、`FAILED`。
  验证：contract/integration tests 覆盖 blob already missing、already unavailable、not found、rejected cleanup reason。
  来源：spec requirement “cleanup 核心判断与执行顺序”“cleanup 状态与产物契约”；design 决策 6。
- [x] 3.5 实现 cleanup evidence：记录 owner/session/request/run/attachment refs、cleanup reason、是否仍被引用、blob check/delete 结果、metadata update 结果和 safe reason code。
  验证：audit/log assertions 覆盖 completed/rejected/failed cleanup evidence 内容。
  来源：spec requirement “cleanup 状态与产物契约”“cleanup 审计、日志与指标脱敏”；design 决策 7。
- [x] 3.6 添加 partial failure negative case：blob 删除成功但 metadata 更新失败时必须返回 explicit failure，并留下 safe diagnostic correlation fields。
  验证：integration test 使用 failing `AttachmentStoreGateway.updateAttachmentStatus` 断言 cleanup outcome=`FAILED`，且不会被当作 completed。
  来源：spec requirement “cleanup 核心判断与执行顺序”“cleanup 失败与降级可见性”；design 决策 3、6。

## 4. 主流程接入与非回归

- [x] 4.1 将 cleanup 接入允许的上游 handoff：admission-gap orphan、partial staging failure、retry source revalidation 和 attachment context availability cleanup；确保 cleanup 不改写 terminal commit、timeline 或 request lifecycle。
  验证：characterization/integration tests 覆盖 cleanup 调用前后 request terminal result 与 timeline 不变。
  来源：spec requirement “cleanup 流程接入与后续消费”“cleanup 失败与降级可见性”；design 决策 2。
- [x] 4.2 让 retry source validation 和 attachment context flow 显式消费 `availabilityStatus=UNAVAILABLE` 的 cleanup 结果，不依赖进程内缓存。
  验证：integration tests 覆盖 cleaned attachment 在 retry/context 中被拒绝或降级。
  来源：spec requirement “cleanup 流程接入与后续消费”；proposal impact。
- [x] 4.3 添加 negative verification：本 change 不得引入 attachment cleanup scheduler、Cron、bulk scanner、session retention 或 artifact cleanup 联动。
  验证：architecture review + source-level negative assertions，检查无 scheduled maintenance registration、无 bulk enumeration 路径。
  来源：spec requirement “附件 cleanup 触发与阶段边界”；design 决策 1。

## 5. Audit、日志、指标与脱敏

- [x] 5.1 实现 `attachment.cleanup.completed` / `attachment.cleanup.rejected` / `attachment.cleanup.failed` 等 safe audit/log/metric 输出，记录 refs、reason code、引用保护结果、blob/metadata 结果和 latency。
  验证：observability tests 覆盖 completed/rejected/failed 三类 cleanup 输出。
  来源：spec requirement “cleanup 审计、日志与指标脱敏”；design 决策 7。
- [x] 5.2 添加安全负例：cleanup audit/log/metric 不得包含 raw attachment content、`BlobRef`、storage path、provider/raw storage error、secret、credential 或 stack trace。
  验证：security/redaction tests 实际断言 forbidden fields 缺失。
  来源：spec requirement “cleanup 审计、日志与指标脱敏”；proposal scope “safe output 不泄漏路径/raw content”。

## 6. 验证和收尾

- [x] 6.1 运行 attachment cleanup 相关 contract、integration、security 和 non-regression 验证。
  验证：实现阶段记录具体命令；至少覆盖 owner-scope、reference protection、blob missing、partial failure、no-terminal-side-effect。
  来源：design 验证映射；AGENTS.md 验证门禁。
- [x] 6.2 运行 OpenSpec 严格校验并确认 proposal/design/spec/tasks 一致。
  验证：`openspec validate add-ts-attachment-cleanup --strict`
  来源：AGENTS.md 验证门禁；proposal/design baseline promotion plan。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ts-attachment-cleanup/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/attachment-lifecycle.md`。
- 按需更新 `openspec/designs/modules/agent-attachment-runtime.md` 和 `openspec/designs/modules/agent-platform-gateway-local.md`。
- 按需新增或更新 `openspec/designs/adr/0005-controlled-attachment-cleanup.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
