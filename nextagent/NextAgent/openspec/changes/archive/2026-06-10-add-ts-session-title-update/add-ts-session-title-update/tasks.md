## 1. 契约层

- [ ] 1.1 在 `agent-contracts/session` 中新增 `UpdateSessionTitleCommand` DTO（`identityContext`、`agentId`、`sessionId`、`title`、`idempotencyKey`）
  验证：contract schema test 验证 DTO 字段存在且类型正确
  来源：proposal 变更范围

- [ ] 1.2 `UserSessionPort` 新增 `updateTitle(command: UpdateSessionTitleCommand): Promise<UserSession>` 方法
  验证：contract schema test 验证接口签名存在
  来源：design D1

## 2. agent-session 领域行为

- [ ] 2.1 `UserSessionService` 实现 `updateTitle`：title 长度校验（≤100 字符）→ 失败返回 SafeError
  验证：unit test 覆盖：99 字符 → 通过；100 字符 → 通过；101 字符 → SafeError
  来源：spec requirement scenario "Title above maximum length is rejected"；design D3

- [ ] 2.2 实现 title 为空时清空标题：空字符串 → `title` 置空或 undefined，`titleSource` 仍设为 `"manual"`
  验证：unit test：空字符串 → `SessionRecord.title` 为空，`titleSource="manual"`
  来源：design D4

- [ ] 2.3 title 经 redaction policy 检查
  验证：integration test + redaction fixture：普通标题 → 通过；含 secret pattern 标题 → SafeError（不含 title 原文）
  来源：design D1

- [ ] 2.4 owner+agent scope 校验：`requireSession` 校验 session 属于当前 owner+agent
  验证：integration test：owner 匹配 → 通过；owner 不匹配 → SafeError "session not found"；agent 不匹配 → SafeError "session not found"
  来源：spec requirement "Session Title Update By Session Owner"

- [ ] 2.5 `saveSession` 持久化 title + titleSource="manual"，使用 `idempotencyKey`
  验证：integration test 验证 `SessionRecord` 写入含新 `title` 和 `titleSource: "manual"`
  来源：design D2、D5

- [ ] 2.6 处理 gateway 写入失败：saveSession 返回错误 → 归一化为 SafeError
  验证：integration test 用 fake gateway 模拟 unavailable → 验证 SafeError 返回
  来源：spec requirement "Failure And Safe Error Propagation"

## 3. 审计事件

- [ ] 3.1 修改成功后写入 `session.title.updated` audit event，包含 tenantId、subjectId、agentId、sessionId、旧标题长度、新标题长度、occurredAt；不含新旧标题原文
  验证：audit contract test 验证成功路径产生 audit event；字段完整性检查；不含原文
  来源：spec requirement "Audit Event For Title Update"

## 4. Web Channel 入口

- [ ] 4.1 `agent-channel-web` 新增 `PUT /api/v1/sessions/{sessionId}/title` endpoint，接收 `{ title: string }` 请求体，注入可信 IdentityContext，调用 agent-session 的 `updateTitle`
  验证：HTTP integration test 用 Fastify inject 覆盖：正常修改 → 200 + 新 title；超长 title → 400；session not found → 404
  来源：proposal 影响范围 `agent-channel-web`

- [ ] 4.2 Channel endpoint 不自行校验 title（校验在 session 领域层），仅负责 identity 注入 + 调用 session `updateTitle` + 结果映射
  验证：code review 检查 endpoint 逻辑不超过 identity 注入 + 调用 + 结果映射
  来源：架构边界 rule "Channel 只负责 transport projection，不拥有业务校验"

## 5. 最小内核 spec 更新

- [ ] 5.1 提 MODIFIED requirement 到 `ts-minimal-agent-kernel` spec，route 白名单新增 `PUT /api/v1/sessions/{sessionId}/title`
  验证：`openspec validate --all --strict` 通过
  来源：当前基线 route 白名单明确禁止 title route

## 6. 集成与验证收尾

- [ ] 6.1 运行 title update 全量 characterization tests
  验证：`npm test` 在 `agent-session` 和 `agent-channel-web` 包内通过
  来源：specs/session-title-update/spec.md 全部 scenario

- [ ] 6.2 验证 titleSource="manual" 阻止自动生成覆盖（与 title-generation 的集成测试）
  验证：manual update → title-generation 自动生成分支触发 → 验证 title 未被覆盖
  来源：design D2

- [ ] 6.3 运行架构校验和安全扫描
  验证：`npm run lint:architecture` 通过；`npm run secret-scan` 通过
  来源：AGENTS.md 验证门禁

- [ ] 6.4 运行 OpenSpec 验证
  验证：`openspec validate --all --strict` 通过
  来源：AGENTS.md 验证门禁
