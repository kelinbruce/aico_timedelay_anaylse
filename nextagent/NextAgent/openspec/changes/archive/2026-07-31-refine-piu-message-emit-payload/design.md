## 背景和现状（Context）

`PiuMessage` 消费 `TOOL_STRUCTURED_DELTA`（`toolMessageType: PIU`）的 content，调用 `window.Prel.autoLoad(piuName, piuVersion)` 后 `piu.emit(method, payload)`。stable spec “PIU Message Rendering” 规定 payload 为 `{ ...content, wrapperId, containerId }`（展开整个 content）。

**Implementation-vs-spec gap**：当前实现是 `{ ...content.data, ...hostFields }`（只展开 `content.data`），路由元信息 `piuName`/`piuVersion`/`method` 被丢弃。这是历史误改：把 AICOConfig 注入路径 `PiuRenderer` 的 `{ ...data, theme, containerId }` 形状错套到流式 PIU 契约上。

回归 spec 的 `...content` 会破坏既有 PIU `dte-bi-agent`：其 handler 契约要求只接收扁平化业务字段，不接受路由元信息。本次在不改后端的前提下为该 PIU 保留 spread-data 适配。

## 目标和非目标（Goals / Non-Goals）

目标：让 `PiuMessage` emit payload 默认回归 spec 的 `...content`（whole）；为 `dte-bi-agent` 保留 spread-data 适配，不改后端。

非目标：不改后端 structuredPayload 契约；不改 `PiuRenderer` 的 `{ ...data, theme, containerId }` 形状；不引入 `payloadShape` 声明字段方案（后端不发，前端无法获取；待特例增多再迁移）；不改 `prel.ts` 的 `PIU.emit` 签名；不改 `parsePiuContent` 和 fallback placeholder 逻辑。

## 设计决策（Decisions）

### 唯一实现路径：前端受控白名单

payload 形状只有两种：whole（`...content`）和 spread-data（`...content.data`）。后端不发声明信号，前端唯一可用的区分依据是 `piuName`。因此用前端 view 层编译期常量白名单 `SPREAD_DATA_PIU_NAMES: ReadonlySet<string>` 区分：

- 默认（白名单外）：`{ ...content, ...hostFields }`——回归 spec，零改动迁移。
- 白名单内：`{ ...content.data ?? {}, ...hostFields }`——适配既有 handler。

控制流集中在单一纯函数 `buildPiuEmitPayload(content, hostFields)`，不在 effect 里散布 if。当前白名单仅含 `"dte-bi-agent"`。

为什么不按 method 分支：`method` 是路由 key，已被 emit 第一参数消费；按 method 分支会让 payload 形状与路由语义耦合，每加特例要改前端控制流。白名单按 `piuName` 区分，新增特例只往集合加字符串。

为什么不引入 payloadShape 声明字段：该方案要求后端多发一个字段，本次明确不改后端。特例 PIU 超过一个时再迁移，届时移除白名单。spec 记录该退出路径。

为什么不同时 spread content 和 content.data：whole 模式已含 `data` 字段，再展开会引入 key 冲突静默风险。两种形状结构性互斥。两种形状下 `hostFields` 都后置展开，确保宿主能力字段覆盖同名业务字段。

### hostFields 内容

`hostFields` 固定为 `{ wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，与 stable spec 一致。`wrapperId` 与 `containerId` 取相同值（`useId()` 生成），`expandPanelId` 取固定常量 `EXPAND_PANEL_DIV_ID`。

## 质量属性设计（Quality Attributes）

- 安全：payload 仍是 view 层组装，不含身份/credential；白名单是编译期常量，不接受运行时外部输入覆盖。验证：代码审查 + 测试断言白名单为常量。
- 性能/容量：纯函数 + 一次 emit，无额外开销。验证：现有渲染测试。
- 可靠性/恢复：纯前端 view 层变更，无 stream/持久化/terminal commit 影响；fallback placeholder 逻辑不变。验证：现有 fallback 测试。
- 可维护性：白名单集中一处常量，新特例只加字符串；spec 记录例外 owner 和退出路径。验证：架构检查确认无散布 if、无 method 分支。
- 可测试性：whole/spread-data/hostFields 覆盖优先均可断言。验证：`AnswerSegments.test.tsx`。
- 审计/可追溯性：无新增日志/审计事件；纯前端 view 层变更。不适用。

## 验证映射（Verification Map）

- 默认 whole payload 回归 spec -> Task A.1 -> 断言非白名单 piuName emit 第二参含 content 全字段 + hostFields。
- dte-bi-agent spread-data 受控例外 -> Task A.1 -> 断言 emit 第二参含 data 业务字段、不含路由元。
- hostFields 后置覆盖同名 key -> Task A.2 -> 断言 data 含 wrapperId 同名 key 时最终值为 hostFields 值。
- fallback placeholder 不变 -> Task A.1 -> 现有 dev mode placeholder 测试通过。
- 不按 method 分支 -> Task A.1 -> 代码审查确认控制流只看 piuName。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-structured-message-rendering/spec.md`（归档时同步 MODIFIED “PIU Message Rendering” requirement）。
- 架构/模块/ADR：无（纯前端 `agent-web` 内部 view 层变更，无跨模块流程）。
- 导航：无新增（受控例外仍属 `agent-web-structured-message-rendering` 范围）。

## 风险与取舍（Risks / Trade-offs）

- [白名单是技术债] -> 当前仅 `dte-bi-agent` 一个特例，白名单成本最低；spec 记录退出路径，特例增多时迁移到后端声明字段。接受。
- [whole 模式下 payload 含路由元] -> 接受，对齐 spec；PIU handler 忽略多余 key 即可。

## 迁移计划（Migration Plan）

无数据迁移。变更纯前端，发布后直接生效。非白名单 PIU 的 payload 从 spread-data 变为 whole，回归 spec 承诺的行为；dte-bi-agent 不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-structured-message-rendering/spec.md`：归档时同步 MODIFIED “PIU Message Rendering” requirement（含 spread-data 受控例外规则与场景）。
- 其余长期文档：无。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.6-向用户提问` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-structured-message-rendering/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
