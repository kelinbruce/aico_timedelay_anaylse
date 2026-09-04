## Why

用户在实时查看 Agent 调用 Tool 的过程中，已经看到的执行说明或 Tool 结果可能在同一轮完成时突然变为空白。该问题发生在过程正文已经写入会话消息、但远程持久化服务尚未让该消息对后续关联读取可见时：完成事件到达后，实时流把暂时无法关联的消息投影为内容不可用，浏览器又用这个空完成态覆盖先前已展示的非空累计内容。

现有实现还通过在 `CAPABILITY_COMPLETED` 中持久化 Tool result 副本规避部分远程关联失败，造成 `SessionMessage` 与 process Event 同时拥有同一正文。两个 durable body owner 既违反既有 Message-first 契约，也可能在投影策略、历史恢复或数据演进后产生不一致。需要在保持安全关联和历史恢复能力的同时，让实时展示不再依赖同一写入后的立即回读，并恢复唯一正文 owner。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 同一活跃流已经交付某个过程 occurrence 的非空安全累计内容时，其完成事件确认该 occurrence 已完成，不得因消息暂时不可读而清空或降级已经展示的正文。
- 活跃流没有可复用内容时，系统继续通过可信消息关联恢复正文；刷新、重连、晚加入和历史加载仍以持久化 `SessionMessage` 为唯一正文来源。
- `CAPABILITY_COMPLETED` 不再持久化可从 `CAPABILITY_RESULT` Message 恢复的 Tool result 副本。
- SSE 与 WebSocket 对相同输入产生等价内容、顺序、完成状态和安全降级结果。

**非目标：**

- 不改变 `SessionMessage` 的模型上下文、terminal answer 或 conversation history 语义。
- 不允许浏览器读取隐藏消息、回传缓存正文或把本地 view state 作为持久化、历史恢复或模型上下文事实。
- 不改变 Workflow completed product 的既有 Event-owned 例外，也不把该例外扩展到 ordinary Message-backed process。
- 不新增公开 API、配置项、Gateway contract、runtime event type 或 `agent-contracts` 类型。
- 不承诺恢复在当前订阅建立前未交付且尚不可从 Message 读取的 live-only fragment。

## What Changes

- 修改实时过程投影契约：同一可信订阅已交付与完成引用事件坐标一致的非空安全累计内容时，完成投影复用该内容并推进完成状态，不再要求对刚写入的 Message 执行即时回读。
- 修改实时关联降级契约：只有当前订阅没有可复用内容且 Message 关联失败时，引用事件才投影 `contentUnavailable=true`；空的内容不可用完成态不得覆盖同 occurrence 已交付的非空正文。
- 收紧持久化契约：ordinary Message-backed `CAPABILITY_COMPLETED` 只保留 `messageId`、Tool identity、状态和其他非正文坐标，不再接受或优先使用 Tool result 正文副本。
- 保持恢复契约：缓存未命中、刷新、重连、晚加入和 history route 继续在服务端关联 Message，并沿用既有作用域校验与 fail-closed 行为。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.1 实时查看处理过程`：用户已经看到的 Tool 轮次执行说明和 Tool 结果在完成边界保持连续，不再因远程消息短暂不可读而消失；Function 组成不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.1 查看会话消息流` → `specs/ts-web-sse-ws-transports/spec.md`
  - 功能边界：明确活跃流对已交付安全累计内容的完成收敛规则、缓存未命中时的 Message 关联回退，以及 persisted process Event 的唯一正文引用边界。
  - 系统质量属性：涉及既有可靠性/恢复与安全约束；不新增系统质量属性 Requirement。
  - 映射说明：canonical spec；本 change 不触及 legacy spec。

## 影响范围（Impact）

- 用户界面：执行说明和 Tool 结果在 live 完成边界不再被空内容覆盖；刷新和历史展示保持现有结果来源。
- Web stream：SSE 与 WebSocket 的共享投影需要区分当前订阅已交付内容与需要 Message 恢复的引用事件。
- 持久化：新写入的 ordinary `CAPABILITY_COMPLETED` 不再包含 Tool result 正文；已有记录不要求原地删除或迁移。
- 安全：共享投影仍只复用同一可信流已经安全交付且坐标完全一致的内容；作用域不匹配、缓存未命中且关联失败时继续 fail closed。
- 测试：影响 runtime persistence policy、Agent Core Tool loop、共享 channel projection、SSE/WebSocket delivery、Agent Web live merge，以及刷新与历史恢复回归用例。
