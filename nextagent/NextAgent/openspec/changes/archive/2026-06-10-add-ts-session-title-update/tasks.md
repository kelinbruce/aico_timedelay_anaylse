## 1. 契约层

- [x] 1.1 在 `agent-contracts/session` 中新增 `UpdateSessionTitleCommand` DTO（`identityContext`、`agentId`、`sessionId`、`title`、`idempotencyKey`）
  验证：contract schema test 验证 DTO 字段存在且类型正确
  来源：proposal 变更范围

- [x] 1.2 `UserSessionPort` 新增 `updateTitle(command: UpdateSessionTitleCommand): Promise<UserSession>` 方法；`RuntimeSessionPort` 新增对应方法
  验证：contract schema test 验证接口签名存在
  来源：design D1

## 2. agent-session 领域行为

- [x] 2.1 `UserSessionService` 实现 `updateTitle`：title 长度校验（≤100 字符）→ 失败返回 SafeError `SESSION_TITLE_TOO_LONG`
  验证：unit test 覆盖：99 字符 → 通过；101 字符 → SafeError
  来源：spec requirement；design D3

- [x] 2.2 实现 title 为空时清空标题：空字符串 → 删除 title 字段，`titleSource` 仍设为 `"manual"`
  验证：unit test：空字符串 → `UserSession.title` 为 undefined
  来源：design D4

- [x] 2.3 title 经 redaction policy 检查：`containsSecretPattern()` 检查 secret/token 模式 → 拒绝返回 SafeError
  来源：design D1

- [x] 2.4 owner+agent scope 校验：`loadSession` 校验 session 存在且属于当前 owner+agent
  验证：session not found → SafeError
  来源：spec requirement

- [x] 2.5 `saveSession` 持久化 title + titleSource="manual"，使用 `idempotencyKey`
  验证：验证 `SessionRecord` 写入含新 `title` 和 `titleSource: "manual"`
  来源：design D2、D5

- [x] 2.6 处理 gateway 写入失败：saveSession 异常 → 传播为 AgentError
  来源：spec requirement

## 3. 审计事件

- [x] 3.1 修改成功后 logger.info 输出 "Session title updated."，包含 sessionId、oldTitleLength、newTitleLength
  来源：spec requirement

## 4. Web Channel 入口

- [x] 4.1 `agent-channel-web` 新增 `PUT /api/v1/sessions/{sessionId}/title` endpoint，接收 `{ title: string }` 请求体（TypeBox schema 校验 maxLength:100），注入可信 IdentityContext，调用 session 的 `updateTitle`
  验证：contract test 覆盖：正常修改 → 200；超长 title → 400；session 不存在 → 404
  来源：proposal 影响范围

- [x] 4.2 Channel endpoint 不自行校验 title（校验在 session 领域层），仅负责 identity 注入 + TypeBox schema 校验 + 调用 session `updateTitle` + 结果映射
  来源：架构边界 rule

## 5. 最小内核 spec 更新

- [x] 5.1 提 MODIFIED requirement 到 `ts-minimal-agent-kernel` spec，route 白名单新增 `PUT /api/v1/sessions/{sessionId}/title`，从禁止列表中移除 title
  验证：`openspec validate --all --strict` 通过
  来源：当前基线 route 白名单明确禁止 title route

## 6. 集成与验证收尾

- [x] 6.1 运行 title update 测试：`npm test` 通过
  来源：specs 全部 scenario

- [x] 6.2 验证 titleSource="manual" 阻止自动生成覆盖：generateTitle 检测到 manual 即跳过
  来源：design D2

- [x] 6.3 运行架构校验：`npm run lint:architecture` 通过
  来源：AGENTS.md 验证门禁

- [x] 6.4 `npm run build` 通过
