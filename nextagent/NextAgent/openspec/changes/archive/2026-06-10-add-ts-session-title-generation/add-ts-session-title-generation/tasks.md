## 1. SessionRecord 扩展与契约

- [ ] 1.1 在 `agent-contracts/gateway` 中新增 `SessionTitleSource` 类型（`"automatic" | "manual"`），扩展 `SessionRecord` 新增 `titleSource?: SessionTitleSource` 字段
  验证：`npm run build` 编译通过；contract schema test 验证 `SessionRecord` 包含 `titleSource` 字段
  来源：design D3

- [ ] 1.2 在 `agent-contracts/session` 中 `UpdateSessionTitleCommand` 新增 `titleSource: SessionTitleSource` 字段（与 `add-ts-session-title-update` 共享此 DTO）
  验证：contract schema test 验证 DTO 包含 `titleSource` 字段
  来源：design D1

## 2. Runtime 标题提取

- [ ] 2.1 实现 `extractTitle(text: string): string` 纯函数（Runtime 内部）：三级分支——短输入（<30）直用、中长输入（30-100）去礼貌前缀+取首句、长输入（>100）首句截断最多100字符；规范化到 4-40 字符
  验证：unit test 覆盖：15字符中文 → 直用返回；50字符中文含"请问" → 去前缀后返回；150字符中文 → 首句截断≤100字符后返回；空字符串 → 返回空；结果<4字符 → 返回空
  来源：design D2

- [ ] 2.2 实现中文 polite prefix/suffix 识别表（"请问"、"请帮我"、"你好"、"麻烦" 等常见电信运维提问句式）
  验证：unit test 用典型电信运维问句验证：前缀被正确去除且不误删术语
  来源：design D2

- [ ] 2.3 Runtime terminal commit 成功后调用 `extractTitle(firstUserText)` → `sessionPort.updateTitle({ ..., titleSource: "automatic" })`，fire-and-forget（不 await）
  验证：characterization test 验证 terminal commit 路径中 `updateTitle` 被调用且 `titleSource="automatic"`；验证 terminal commit 完成不等待 `updateTitle` 结果
  来源：design D1

- [ ] 2.4 Runtime 判断 `isFirstRequest`（session lane snapshot 判断此前无 terminal run）+ `firstUserText` 存在 → 才触发生成
  验证：characterization test：首个请求 terminal → 触发；第二个请求 terminal → 不触发
  来源：spec requirement "Automatic Title Generation Triggered By First Request Terminal Event"

## 3. agent-session 适配

- [ ] 3.1 `updateTitle` 中 `titleSource="automatic"` 分支：loadSession 检查当前 `titleSource`——若已是 `"manual"` 或 `title` 非空 → 跳过（不覆盖手动标题）
  验证：integration test：session 已有 manual title → 跳过；session title 非空但无 titleSource → 跳过
  来源：design D3、D4

- [ ] 3.2 标题经 redaction policy 检查
  验证：integration test + redaction fixture：普通标题 → 通过；含 secret pattern 标题 → 拒绝 → 跳过 + warn log
  来源：design D5

- [ ] 3.3 `saveSession` 持久化 title + titleSource="automatic"，使用 `idempotencyKey = title-gen-{sessionId}`
  验证：integration test 验证 `SessionRecord` 写入含 `title` 和 `titleSource: "automatic"`
  来源：design D4

- [ ] 3.4 全部静默失败：所有异常路径 catch → warn log + 不抛出
  验证：integration test 用 fake gateway 模拟各种失败 → 验证不抛异常、不阻塞调用方、日志含 sessionId
  来源：design D5

## 4. 审计事件

- [ ] 4.1 `titleSource="automatic"` 成功生成后写入 `session.title.generated` audit event，包含 tenantId、subjectId、agentId、sessionId、requestRunId、标题字符数、occurredAt；不含标题原文
  验证：audit contract test 验证成功路径产生 audit event；字段完整性检查；不含原文
  来源：spec requirement "Audit Events For Title Generation"

- [ ] 4.2 失败路径不写入 audit event
  验证：negative test 覆盖每种失败场景 → 验证无 audit event 写入
  来源：design D5

## 5. 集成与验证收尾

- [ ] 5.1 运行 title generation 全量 characterization tests
  验证：`npm test` 在 `agent-runtime` 和 `agent-session` 包内通过
  来源：specs/session-title-generation/spec.md 全部 scenario

- [ ] 5.2 验证 `SessionRecord.titleSource` 的 contract test
  验证：contract test 验证 gateway port 签名不漂移
  来源：design D3

- [ ] 5.3 运行架构校验和安全扫描
  验证：`npm run lint:architecture` 通过；`npm run secret-scan` 通过
  来源：AGENTS.md 验证门禁

- [ ] 5.4 运行 OpenSpec 验证
  验证：`openspec validate --all --strict` 通过
  来源：AGENTS.md 验证门禁
