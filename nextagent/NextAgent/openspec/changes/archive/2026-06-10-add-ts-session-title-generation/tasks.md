## 1. SessionRecord 扩展与契约

- [x] 1.1 在 `agent-contracts/gateway` 中新增 `SessionTitleSource` 类型（`"automatic" | "manual"`），扩展 `SessionRecord` 新增 `titleSource?: SessionTitleSource` 字段
  验证：`npm run build` 编译通过；contract schema test 验证 `SessionRecord` 包含 `titleSource` 字段
  来源：design D3

- [x] 1.2 在 `agent-contracts/session` 中新增 `GenerateSessionTitleCommand` DTO（`identityContext`、`agentId`、`sessionId`、`requestRunId`、`firstUserText`、`isFirstRequest`），`UserSessionPort` 新增 `generateTitle(command: GenerateSessionTitleCommand): Promise<boolean>` 方法
  验证：contract schema test 验证接口签名存在；参数类型正确
  来源：design D1

## 2. 标题提取管线

- [x] 2.1 实现确定性标题提取纯函数 `extractTitle(text: string, locale: string): string`：三级分支——短输入（<30）直用、中长输入（30-100）去礼貌前缀+取首句、长输入（>100）首句截断最多100字符
  验证：unit test 覆盖：短/中/长输入、中文前缀、规范化、边界
  来源：design D2

- [x] 2.2 实现标题规范化：trim 首尾空白、移除控制字符、截断到 4-40 字符范围、<4 字符返回空字符串
  验证：unit test 覆盖规范化边界
  来源：design D2

- [x] 2.3 实现中文 polite prefix 识别表（"请问"、"请帮我"、"帮我查"等常见电信运维提问句式），按长度降序排列以正确匹配
  验证：unit test 验证前缀被正确去除
  来源：design D2

## 3. generateTitle 实现

- [x] 3.1 `UserSessionService` 实现 `generateTitle(command)`：完整流程（isFirstRequest → loadSession 查 titleSource → extractTitle → redaction → saveSession → log）
  验证：集成测试通过
  来源：design D1、D4

- [x] 3.2 实现 `isFirstRequest` 判断：command 传入的 `isFirstRequest === false` → 跳过（返回 true）
  来源：spec requirement

- [x] 3.3 实现 title 已存在时跳过：`loadSession` → `titleSource === "manual"` 或 `title` 非空 → 返回 true（标记已完成）
  来源：design D3、D4

- [x] 3.4 实现从 `firstUserText` 提取标题：调用 `extractTitle(firstUserText, "zh-CN")`，不查 listMessages
  来源：design D2

- [x] 3.5 标题经 redaction policy 检查后方可持久化：`containsSecretPattern()` 检查 secret/token 模式
  来源：design D5

- [x] 3.6 `saveSession` 持久化 title + titleSource="automatic"，使用 idempotencyKey = `title-gen-{sessionId}`
  来源：design D4

- [x] 3.7 实现全部静默失败：所有异常路径 catch → warn log + 返回 false，不抛出
  来源：design D5

## 4. Runtime 集成

- [x] 4.1 Runtime terminal commit 成功后 fire-and-forget 调用 `generateSessionTitle(...)`，传入 `firstUserText` 和 `isFirstRequest`。使用 `generatedTitleSessionIds` Set 去重，仅在 saveSession 成功后加 key
  来源：design D1

- [x] 4.2 `agent-app` composition 确保 `UserSessionPort` 实例已注入到 runtime（当前已注入，无需额外改动）
  来源：design 阶段 3

## 5. 审计事件

- [x] 5.1 成功生成后 logger.info 输出 "Session title generated."，包含 sessionId、requestRunId、标题字符数
  来源：spec requirement

- [x] 5.2 失败路径不写入 info 日志，仅 warn
  来源：design D5

## 6. 集成与验证收尾

- [x] 6.1 运行 title generation 全量测试：`npm test` 通过
  来源：specs 全部 scenario

- [x] 6.2 验证 `SessionRecord.titleSource` 的 contract test
  来源：design D3

- [x] 6.3 验证 `GenerateSessionTitleCommand` 和 `UserSessionPort.generateTitle` 的 contract test
  来源：design D1

- [x] 6.4 运行架构校验：`npm run lint:architecture` 通过
  来源：AGENTS.md 验证门禁

- [x] 6.5 `npm run build` 通过
