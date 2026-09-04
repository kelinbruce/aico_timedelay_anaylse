## Why

环境上对 fork 派生子会话的最新继承轮次执行 retry 时，后端返回 `REQUEST_RETRY_NOT_FOUND`（"Retry target was not found"）。前端此前已放开了继承轮次的 retry/edit 入口（归档 change `enable-fork-inherited-latest-turn-actions` 及 `fix-agent-web-fork-inherited-action-eligibility`），依赖后端 inherited retry/edit 路径完成权威资格校验。但实际环境中该后端路径无法稳定解析 fork source，导致用户点击 retry 必然失败。

需要恢复前端对 fork 继承最新轮次 retry/edit 入口的禁用行为，并在 tooltip 中向用户说明原因，避免用户操作必然失败。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当最新轮次携带 `metadata.forkInherited: true` 时，Agent Web MUST 禁用 TurnBlock retry 按钮和 Composer retry 入口，并展示说明性 tooltip。
- 当最新轮次携带 `metadata.forkInherited: true` 时，Agent Web MUST 禁用 TurnBlock edit 按钮和 Composer edit 入口，并展示说明性 tooltip。
- fork 后新提交的 child 自身消息不携带 `forkInherited`，其 retry/edit 行为不受影响。
- 较早历史轮次继续不可操作，retry 次数上限等既有禁用条件继续优先。

**非目标：**

- 不修改后端 inherited retry/edit 的 runtime 生命周期、持久化或隔离语义。
- 不新增或修改 Web API、stream event、Gateway contract、数据库结构或公共 schema。
- 不删除 `forkInherited` provenance 标记，保留其在 conversation metadata 中的透出。
- 不扩展为任意历史轮次 retry/edit。
- 不修复后端 `REQUEST_RETRY_NOT_FOUND` 根因；后端修复后可通过独立 change 重新放开前端入口。

## What Changes

- 修改 Agent Web 的 latest-turn 操作资格：`metadata.forkInherited: true` MUST 导致 retry/edit 入口禁用。
- 恢复 `forkInherited` provenance 标记的前端操作禁用语义：标记不仅标识 copied message 来源，还 MUST 在 Agent Web 层禁用继承最新轮次的 retry/edit 入口。
- 恢复仅用于解释"继承轮次不可操作"的禁用提示行为。
- 后端 inherited retry/edit 路径不变；前端禁用是阻止请求到达后端的客户端保护层。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.6 基于历史回复新建会话`：刚派生的子会话最新继承轮次的 retry/edit 入口被禁用，用户需先发送新问题后才能对新的原生轮次执行 retry/edit。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.11 从消息派生子会话` → `specs/session-fork-from-message/spec.md`
  - 功能边界：`forkInherited` 继续作为 copied message 的 provenance，并重新承担前端 retry/edit 禁用语义。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：canonical spec。

- `FN-2.3 重试请求` → `specs/request-retry/spec.md`
  - 功能边界：Agent Web 对最新继承轮次禁用 retry 入口并展示说明性 tooltip。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec。

- `FN-2.1 提交请求` → `specs/request-edit-resubmit/spec.md`
  - 功能边界：Agent Web 对最新继承轮次禁用 edit 入口并展示说明性 tooltip。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 用户打开刚派生、尚无新提问的子会话时，最新继承轮次的 retry 和 edit 按钮呈现禁用态（`not-allowed` 光标、降低透明度），hover 时展示"派生会话继承的回答不可重试"/"派生会话继承的问题不可编辑"。
- Agent Web 的操作资格投影、组件交互和浏览器旅程测试受到影响。
- 后端 API、Runtime、Gateway、持久化、部署配置和运维接口不受影响。