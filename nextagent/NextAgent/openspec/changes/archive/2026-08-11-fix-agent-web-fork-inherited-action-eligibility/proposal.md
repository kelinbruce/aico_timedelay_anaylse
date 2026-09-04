## Why

用户打开刚派生且尚未继续提问的子会话时，最新继承轮次已经能够由系统执行 retry 或 edit，但界面仍将两个入口禁用。用户因此无法使用已经交付的继承轮次操作能力，并会误认为该限制仍是产品规格。

当前稳定规格同时保留“允许继承最新轮次操作”和“前端禁用继承最新轮次操作”两组相反约束，导致实现、测试和验收无法得出唯一结论。需要立即消除冲突，使界面操作资格与后端权威行为一致。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当派生子会话的最新继承轮次满足既有 retry 或 edit 入口条件时，用户可以从 TurnBlock 或 Composer 发起对应操作。
- `metadata.forkInherited` 继续表示消息来自 fork copied prefix，但不再决定 retry/edit 是否可用。
- 后端继续对 latest、active work、附件、scope 和 durable fork source 等资格作最终校验；失败时沿用既有安全错误。
- 普通会话、较早历史轮次以及 retry 次数上限的界面行为保持不变。

**非目标：**

- 不修改 inherited retry/edit 的 runtime 生命周期、持久化或隔离语义。
- 不新增或修改 Web API、stream event、Gateway contract、数据库结构或公共 schema。
- 不删除 `forkInherited` provenance，也不将其用于模型上下文或后端 lifecycle 合法性判断。
- 不扩展为任意历史轮次 retry/edit。

## What Changes

- 移除 Agent Web 对最新继承轮次 retry/edit 入口的强制禁用行为。
- 修改 Agent Web 的 latest-turn 操作资格：继承来源本身不得阻止 retry/edit；其他既有入口条件继续生效。
- 修改 fork provenance 契约：`forkInherited` 仅用于标识 copied message 来源，不承载操作授权或拒绝语义。
- 移除仅用于解释“继承轮次不可操作”的禁用提示行为。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.6 基于历史回复新建会话`：刚派生的子会话可直接使用已交付的最新继承轮次 retry/edit 能力。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.11 从消息派生子会话` → `specs/session-fork-from-message/spec.md`
  - 功能边界：`forkInherited` 继续作为 copied message 的 provenance，不再形成前端操作禁用规则。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：canonical spec。
- `FN-2.3 重试请求` → `specs/request-retry/spec.md`
  - 功能边界：Agent Web 对满足既有条件的最新继承轮次暴露 retry 入口，并由后端执行权威资格校验。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec。
- `FN-2.1 提交请求` → `specs/request-edit-resubmit/spec.md`
  - 功能边界：Agent Web 对满足既有条件的最新继承轮次暴露 edit 入口，并由后端执行权威资格校验。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 用户可在刚派生的子会话直接点击 retry/edit，不再看到来源于过期禁用规则的禁用态和提示。
- Agent Web 的操作资格投影、组件交互和浏览器旅程测试受到影响。
- 后端 API、Runtime、Gateway、持久化、部署配置和运维接口不受影响。
