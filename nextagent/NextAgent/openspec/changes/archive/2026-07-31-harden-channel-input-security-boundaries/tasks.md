## 1. locale 参数安全模式

- [x] 1.1 在 `agent-channel-web/src/schemas/validation-limits.ts` 新增 `WEB_LOCALE_PATTERN = "^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$"` 常量
  验证：`npm run build` 编译通过；常量被 6 处 schema 引用
  来源：spec「Locale 参数安全模式」、design D1
- [x] 1.2 在 `agent-channel-web` 所有 locale 输入 schema 添加 `pattern: WEB_LOCALE_PATTERN`：`category-question-query.ts`、`frequent-question-query.ts`、`question-association-query.ts`、`request-dto.ts`（submitBody、convenienceSubmitBody、editLatestBody）、`session-dto.ts`（createSessionBody）
  验证：`npm run build` 编译通过；AJV schema 校验在请求入口生效
  来源：spec「Locale 参数安全模式」、design D1
- [x] 1.3 在 `agent-channel-task/src/routes.ts` 新增 `TASK_LOCALE_PATTERN` 常量（值与 `WEB_LOCALE_PATTERN` 等价），在 createTaskBody 和 editTaskBody 的 locale 字段添加 `pattern` 约束
  验证：`npm run build` 编译通过
  来源：spec「Locale 参数安全模式」、design D1
- [x] 1.4 在 `agent-session/src/services/category-question-catalog.ts` 的 `normalizeLocale` 添加深度防御：locale 包含 `/`、`\` 或 `..` 时返回 `FALLBACK_LANGUAGE`
  验证：`npm run build` 编译通过；code review 确认防御逻辑
  来源：spec「Locale 参数安全模式」、design D1

## 2. limit DoS 上限

- [x] 2.1 在 `agent-channel-web/src/routes/requests.ts` 新增 `SESSION_LIST_MAX_LIMIT = 200` 和 `MAX_CONVERSATION_LIMIT = 500` 固定常量
  验证：`npm run build` 编译通过
  来源：spec「列表查询 limit 上限」、design D2
- [x] 2.2 session list 非搜索路径添加 `limit > SESSION_LIST_MAX_LIMIT` 校验，超限返回校验错误
  验证：`npm run build` 编译通过；code review 确认校验逻辑
  来源：spec「列表查询 limit 上限」、design D2
- [x] 2.3 conversation 路径添加 `limit > MAX_CONVERSATION_LIMIT` 校验，超限返回校验错误
  验证：`npm run build` 编译通过；code review 确认校验逻辑
  来源：spec「列表查询 limit 上限」、design D2
- [x] 2.4 favorites 路径修复负数绕过：`limit > 100` 改为 `limit < 1 || limit > 100`
  验证：`npm run build` 编译通过；code review 确认 `limit=-1` 被拒绝
  来源：spec「列表查询 limit 上限」、design D2

## 3. SSE 订阅者清理

- [x] 3.1 在 `agent-channel-common/src/transports/web-stream-delivery.ts` 将 `iterator` 声明提升到 `try` 块之前（`let iterator: AsyncIterator<StreamEnvelope> | undefined`），在 `finally` 块添加 `void iterator?.return?.()`
  验证：`npm run build` 编译通过；code review 确认 finally 块调用 iterator.return()
  来源：spec「SSE 流交付订阅者清理」、design D3

## 4. WebSocket 帧大小限制与 pong 背压

- [x] 4.1 在 `agent-channel-task/src/websocket.ts` 新增 `maxWebSocketFramePayloadBytes = 1 * 1024 * 1024` 和 `maxWebSocketControlFramePayloadBytes = 125` 固定常量
  验证：`npm run build` 编译通过
  来源：spec「WebSocket 帧大小限制」、design D4
- [x] 4.2 在 `consumeClientFrames` 解析 `payloadLength` 后添加帧大小上限检查，超限关闭连接（1009）并调用 `onClose()`
  验证：`npm run build` 编译通过；code review 确认超限关闭逻辑
  来源：spec「WebSocket 帧大小限制」、design D4
- [x] 4.3 添加控制帧 payload 超过 125 字节检查，超限关闭连接（1002）并调用 `onClose()`
  验证：`npm run build` 编译通过；code review 确认控制帧限制逻辑
  来源：spec「WebSocket 帧大小限制」、design D4
- [x] 4.4 `sendWebSocketPong` 返回 `boolean` 背压信号（复用 `writeWebSocketFrame` 返回值），pong 写入失败时关闭连接（1011）并调用 `onClose()`
  验证：`npm run build` 编译通过；code review 确认背压处理逻辑
  来源：spec「WebSocket pong 背压处理」、design D4

## 5. SkillHub 下载完整性校验

- [x] 5.1 在 `agent-platform-gateway-remote/src/skillhub-http-v1-gateway.ts` 导入 `createHash`，在 `fetchContent` 下载后、解压前添加 `createHash("sha256").update(download.packageBytes).digest("hex")` 与 `download.packageHash` 比对，不匹配返回 `{ status: "failed", reasonCode: "invalid-response", message: "SkillHub package integrity check failed." }`
  验证：`npm test -- ...agent-platform-gateway-remote` SkillHub 测试通过
  来源：spec「SkillHub 远程下载包完整性校验」、design D5
- [x] 5.2 更新 `agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts` 测试用例：提供真实 SHA-256 hash（`createHash("sha256").update(packageBytes).digest("hex")`）替代硬编码 `"hash-scoped-skill"`
  验证：`npm test -- ...agent-platform-gateway-remote` 测试通过
  来源：spec「SkillHub 远程下载包完整性校验」、design D5

## 6. 验证和收尾

- [x] 6.1 后端常规验证：仓库根目录运行 `npm run build`
  验证：编译通过
  来源：AGENTS.md 验证门禁
- [x] 6.2 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁
- [x] 6.3 清理检查：确认本 change 未引入配置项、未使用的 helper/export 或 test-only 残留；所有上限和 pattern 为固定常量来源
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的「归档前更新基线」处理：

- `openspec/specs/web-channel-input-security/spec.md`：新增 capability spec。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 SSE 订阅者清理和 WebSocket 帧大小限制 requirement。
- `openspec/specs/skillhub-source/spec.md`：合并下载完整性校验 requirement。
- `openspec/overview.md`：安全边界描述补充 channel input 安全加固。
- `openspec/designs/modules/`：四个模块设计补充对应安全常量和语义。
- `openspec/designs/spec-to-design-map.md`：新增 `web-channel-input-security` 导航。