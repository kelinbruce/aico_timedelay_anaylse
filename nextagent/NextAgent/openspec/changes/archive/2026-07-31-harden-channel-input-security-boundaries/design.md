## 背景和现状（Context）

NextAgent 的 web 通道和 task 通道暴露 HTTP/WebSocket 接口，接受客户端 `locale`、`limit` 等输入参数。这些参数在 Fastify schema 层通过 TypeBox + AJV 进行 runtime validation，但部分参数的安全约束不完整：

- `locale` 参数只有 `minLength: 2, maxLength: 35`，无 `pattern`。`normalizeLocale` 只切 `-` 前缀并小写，不过滤 `/`、`\`、`..`。下游 `path.join(resourceDir, 'category-question-${locale}.jsonl')` 会解析 `..` 段，可读取 resource 目录外文件。
- `limit` 参数：session list 非搜索路径只检查 `limit < 1`；conversation 路径只检查 `limit < 1`；favorites 路径检查 `limit > 100` 但不拒绝负数（SQLite `LIMIT -1` = 无限制）。
- SSE 流交付 `deliverWebStream` 的 `finally` 块不调用 `iterator.return?.()`，generator 停在 `yield` 时其内部 `finally`（`removeStreamSubscriber`）不执行，subscriber 永久泄漏。
- Task 通道 WebSocket 帧解析无实际大小上限，控制帧无 125 字节限制，pong 写入丢弃背压信号。
- SkillHub 远程 gateway 下载 skill 包后不校验哈希完整性。

约束：

- AGENTS.md 规格优先：安全边界变更必须先有 OpenSpec change（本 change）。
- 同形同策：所有 locale 入口必须使用同一 pattern 常量；所有 limit 上限必须使用固定常量，不可由客户端覆盖。
- 最小内核非回归：不修改 conversation 历史响应形状、stream envelope 语义或 runtime lifecycle。
- 外科手术式修改：只加安全约束，不改既有行为。

相关方：`agent-channel-web`（locale schema + limit 校验）、`agent-channel-task`（locale schema + WebSocket）、`agent-channel-common`（SSE 订阅者清理）、`agent-platform-gateway-remote`（下载完整性）、`agent-session`（normalizeLocale 深度防御）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 所有 locale 输入参数 MUST 匹配 `^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$`，非法 locale 在 schema 校验层被拒绝；`normalizeLocale` 添加深度防御兜底。
- session list 非搜索路径 `limit` MUST NOT 超过 200；conversation `limit` MUST NOT 超过 500；favorites `limit` MUST 在 1 到 100 之间（含边界）。
- SSE 流交付在 disconnect/abort/normal completion 时 MUST 调用 `iterator.return?.()`，确保 subscriber 被清理。
- WebSocket 帧 payload MUST NOT 超过 1 MiB；控制帧 payload MUST NOT 超过 125 字节；pong 写入失败 MUST 关闭连接。
- SkillHub 下载包 MUST 在解压前校验 SHA-256 hash 与声明的 `packageHash` 一致。

**非目标：**

- 不引入 SSE/WS 连接数限制、空闲超时或 subscriber queue 高水位策略（需后续架构 change）。
- 不引入 timeline 重放总量上限或 timeline prune 机制（需后续架构 change）。
- 不为 CategoryQuestionCatalog 缓存引入 LRU/eviction（已被 locale pattern 约束大幅缩小键空间）。
- 不优化 WebSocket XOR demask 逐字节循环为 4 字节批量异或（低优先级优化项）。
- 不修改 channel auth profile（DEFAULT_WEB loopback 信任模式是本地开发设计预期）。
- 不引入 locale 或 limit 的配置项（全部为固定常量）。

## 设计决策（Decisions）

### D1：locale pattern 选择

pattern `^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$` 覆盖 BCP 47 language tag 的语言部分和 `language-Region` 形式（如 `zh`、`en`、`zh-CN`、`en-US`、`pt-BR`）。首尾必须为字母，中间允许字母和连字符。单字母 locale 作为合法边界。该 pattern 拒绝 `/`、`\`、`..`、空格、Unicode、数字等路径穿越和注入字符。

- 放弃「完整 BCP 47 pattern」：locale 在 NextAgent 中只用于 resource 文件名选择和 `normalizeLocale` 语言前缀提取，不需要接受 script subtag（`zh-Hans`）、extension（`zh-CN-u-ca-chinese`）或 private use（`x-private`）等完整 BCP 47 形式。现有 `normalizeLocale` 只取 `-` 前缀，pattern 与现有行为一致。
- 放弃「只校验 normalizeLocale」：schema 层 pattern 校验在请求入口即拒绝非法输入，不依赖下游函数；`normalizeLocale` 深度防御作为 defense-in-depth 兜底，防止未来新增 locale 入口遗漏 pattern。
- web 通道和 task 通道使用等价 pattern，分别由 `WEB_LOCALE_PATTERN` 和 `TASK_LOCALE_PATTERN` 常量承载（两个 package 不共享 import，值相同）。

### D2：limit 上限数值选择

| 端点 | 既有默认 | 既有搜索上限 | 新增非搜索上限 | 理由 |
|---|---|---|---|---|
| session list（非搜索） | 50 | — | 200 | 前端加载更多每页 20-50，200 覆盖 4-10 页预加载；超过 200 的请求不属于正常前端行为 |
| session list（搜索） | 20 | 50 | — | 既有 `SESSION_SEARCH_MAX_LIMIT = 50` 不变 |
| conversation | 50 | — | 500 | 既有 `MAX_CONVERSATION_PREVIEW_LIMIT = 500` 已作为 preview 上限；conversation 保持一致 |
| favorites | 50 | — | 100（含下限 1） | 既有 `limit > 100` 上限不变，新增 `limit < 1` 下限修复负数绕过 |

- 放弃「统一 limit 上限」：不同端点的数据量和前端分页模式不同，统一上限会过度限制或不足。采用各端点独立的固定常量，符合既有 `SESSION_SEARCH_MAX_LIMIT`、`MAX_CONVERSATION_PREVIEW_LIMIT` 模式。
- 放弃「配置化 limit 上限」：limit 上限是安全边界，不可由客户端或配置覆盖，必须为固定常量。

### D3：SSE 订阅者清理 — iterator.return() 调用时机

将 `iterator` 声明提升到 `try` 块之前（`let iterator: AsyncIterator<StreamEnvelope> | undefined`），在 `finally` 块中调用 `void iterator?.return?.()`。这确保无论 generator 停在哪个 `yield`，其内部 `finally`（`removeStreamSubscriber`）都会被触发。

- 放弃「只在 abort 时清理」：abort 只通知 runtime 停止产生新事件，不触发 generator 的 `return()`；如果 generator 停在 `yield` 等待下一个事件，`return()` 是唯一能触发其 `finally` 的方式。
- `void` 前缀表示不等待 `return()` 的 Promise（`finally` 块不能 `await`），`?.` 链式调用防止 iterator 未初始化时抛错。

### D4：WebSocket 帧大小限制数值

| 约束 | 数值 | RFC 6455 依据 |
|---|---|---|
| 最大帧 payload | 1 MiB (1048576 bytes) | RFC 6455 无强制上限；1 MiB 覆盖 NextAgent WebSocket 控制消息和 stream envelope 的最大合理大小 |
| 最大控制帧 payload | 125 bytes | RFC 6455 §5.5：控制帧 payload MUST NOT 超过 125 字节 |

- 超限关闭码：帧过大用 1009（Message Too Big）；控制帧过大用 1002（Protocol Error），符合 RFC 6455 §7.4.1。
- pong 背压：`sendWebSocketPong` 返回 `writeWebSocketFrame` 的背压信号（`boolean`），写入失败时关闭连接（1011 Internal Error），防止 pong 排队 OOM。

### D5：SkillHub 下载完整性校验 — SHA-256

在 `fetchContent` 下载 base64 解码后、`materializeZipPackage` 解压前，用 `createHash("sha256").update(download.packageBytes).digest("hex")` 与声明的 `download.packageHash` 比对。不匹配返回 `{ status: "failed", reasonCode: "invalid-response", message: "SkillHub package integrity check failed." }`。

- 校验时机在解压前：防止恶意 zip 在解压时触发 zip bomb 或路径穿越。
- `packageHash` 为可选字段：若远端未声明 hash，跳过校验（保持向后兼容）；若声明了 hash 则必须匹配。
- 使用 `node:crypto` 的 `createHash`，不引入额外依赖。

### D6：误报与设计预期行为的处理

- 4 条误报（inputText/idempotencyKey maxLength、answers maxItems）引用的是重构前旧代码，当前 schema 已有约束，无需修改。
- 4 条设计预期行为（DEFAULT_WEB loopback 信任模式）是本地开发设计，生产部署使用 `LOCAL_CONFIGURED_AUTH` profile。不在本 change 范围内。
- 6 条需后续规划的发现（SSE/WS 连接数限制、queue 高水位、timeline 重放限制、XOR 优化）涉及架构层面设计，需单独 OpenSpec change。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | locale pattern 在 schema 层拒绝路径穿越输入；limit 上限为固定常量不可由客户端覆盖；SSE 订阅者在 disconnect 时清理；WebSocket 帧大小有上限；SkillHub 下载有 hash 校验 | schema 校验测试、WebSocket 帧测试、SkillHub hash 校验测试 |
| 性能/容量 | limit 上限直接约束单次查询返回行数；SSE 订阅者清理防止内存泄漏；WebSocket 帧大小限制防止 OOM | 既有测试不退化 |
| 可靠性/恢复 | locale 校验失败返回 400 safe error，不影响其他请求；SkillHub hash 不匹配安全失败，不产生 partial staging | 负例测试断言安全失败 |
| 可维护性 | locale pattern 和 limit 上限为单一常量来源；web/task 通道使用等价 pattern | `npm run lint:architecture`；code review |
| 可测试性 | locale pattern 可用合法/非法 locale 字符串验证；limit 上限可用边界值验证；WebSocket 帧大小可用构造帧验证 | characterization 测试 |
| 审计/可追溯性 | 校验失败通过既有 safe error 通道返回；无新增可观测信号需求 | 既有 observability 断言路径 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| locale pattern 拒绝路径穿越输入 | T1 | `npm test -- ...agent-channel-web` schema 校验测试 |
| normalizeLocale 深度防御兜底 | T1 | `npm test -- ...agent-session` normalizeLocale 测试 |
| session list limit 上限 200 | T2 | `npm test -- ...agent-channel-web` limit 校验测试 |
| conversation limit 上限 500 | T2 | `npm test -- ...agent-channel-web` limit 校验测试 |
| favorites limit 修复负数绕过 | T2 | `npm test -- ...agent-channel-web` favorites 测试 |
| SSE 订阅者清理调用 iterator.return() | T3 | `npm test -- ...agent-channel-common` 流交付测试 |
| WebSocket 帧大小超限关闭连接 | T4 | `npm test -- ...agent-channel-task` WebSocket 帧测试 |
| WebSocket 控制帧超限关闭连接 | T4 | `npm test -- ...agent-channel-task` WebSocket 帧测试 |
| WebSocket pong 背压处理 | T4 | `npm test -- ...agent-channel-task` WebSocket pong 测试 |
| SkillHub 下载 hash 校验 | T5 | `npm test -- ...agent-platform-gateway-remote` SkillHub 测试 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/web-channel-input-security/spec.md`（新增 capability）、`openspec/specs/ts-web-sse-ws-transports/spec.md`（SSE 订阅者清理 + WebSocket 帧大小）、`openspec/specs/skillhub-source/spec.md`（下载完整性校验）。
- 模块设计：`openspec/designs/modules/agent-channel-web.md`（locale pattern + limit 常量）、`openspec/designs/modules/agent-channel-task.md`（WebSocket 帧大小常量）、`openspec/designs/modules/agent-channel-common.md`（SSE 订阅者清理）、`openspec/designs/modules/agent-platform-gateway-remote.md`（下载完整性校验）。
- ADR：无（决策复杂度不足以单独立 ADR，记录在本 design）。
- 导航：`openspec/designs/spec-to-design-map.md` 新增 `web-channel-input-security` 条目。

## 风险与取舍（Risks / Trade-offs）

- [locale pattern 可能拒绝部分合法 BCP 47 tag] -> 设计如此：NextAgent 的 locale 只用于 resource 文件名和语言前缀提取，不支持 script subtag 或 extension；现有 `normalizeLocale` 只取 `-` 前缀，pattern 与现有行为一致。如后续需要更完整的 BCP 47 支持，需先更新 OpenSpec。
- [limit 上限可能影响前端批量加载] -> 风险可控：前端分页每页 20-50，上限 200/500 覆盖 4-10 页预加载；超过上限的请求不属于正常前端行为，返回 400 校验错误。
- [SSE iterator.return() 可能在 generator 已完成时重复调用] -> 安全：`?.` 链式调用和 `void` 前缀确保重复调用无副作用；generator 的 `return()` 在已完成时返回 `{ done: true }`。
- [SkillHub hash 校验在远端未声明 hash 时跳过] -> 向后兼容：保持对不声明 hash 的远端的兼容性；声明了 hash 的远端获得完整性保护。后续可通过 OpenSpec change 要求所有远端必须声明 hash。

## 迁移计划（Migration）

无数据迁移。所有约束为运行时判定，对存量数据无影响。locale pattern 对已使用的 `zh-CN`、`en`、`en-US` 等合法 locale 无影响。limit 上限对正常前端分页行为无影响。发布无需特殊步骤；回滚即还原代码，无持久化格式变化。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/web-channel-input-security/spec.md`：新增 capability spec。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 SSE 订阅者清理和 WebSocket 帧大小限制 requirement。
- `openspec/specs/skillhub-source/spec.md`：合并下载完整性校验 requirement。
- `openspec/overview.md`：安全边界描述补充 channel input 安全加固。
- `openspec/designs/modules/`：四个模块设计补充对应安全常量和语义。
- `openspec/designs/spec-to-design-map.md`：新增 `web-channel-input-security` 导航。

## 待确认问题

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-6.1-校验身份和归属` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/skillhub-source/spec.md`、`openspec/specs/ts-web-sse-ws-transports/spec.md`、`openspec/specs/web-channel-input-security/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
