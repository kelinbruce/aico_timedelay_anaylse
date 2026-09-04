## Why

Portal 集成方已经可以通过受信 `portal-ability-config` 隐藏推荐问题、定时任务、长期记忆管理和知识导入入口，但无法按部署隐藏执行详情中的“完整过程”入口。对不希望暴露 Run Graph 的交付环境，入口仍会出现在所有宿主的执行详情中。

现有 `AICOConfig.showThinkingChain` 是宿主侧显示控制，来源和生命周期不同于 Agent package 的 `portal-ability-config`。本 change 复用后者的既有受信配置、bootstrap DTO 和前端解析链路，不引入第二套配置来源。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Agent package 的 `config/config.json` 顶层 `portal-ability-config` 新增 boolean 字段 `full-process-enabled`。
- 字段默认值为 `true`；仅显式 `false` 时隐藏执行详情中的“完整过程”按钮。
- 字段缺失、类型非法或值不是 boolean 时回退 `true`，并与其他 portal ability 字段独立解析。
- Runtime bootstrap public DTO `portalAbilityConfig` 新增 `fullProcessEnabled`。
- 前端通过共享 `TurnBlock` 投影消费该字段，Local、Immersive、Collaborative/PIU 三种宿主使用同一入口语义。
- `fullProcessEnabled=false` 只隐藏“完整过程”按钮；执行详情摘要、折叠过程条目、最终答复和过程数据获取语义不变。
- “完整过程”入口的最终可见性必须同时满足既有过程数据可用性、`AICOConfig.showThinkingChain` 未关闭和 `fullProcessEnabled` 未关闭。

**非目标：**

- 不删除或禁用 ProcessPanel / 执行详情面板。
- 不修改 Run Graph 数据、timeline event、history API 或权限模型。
- 不改变 `AICOConfig.showThinkingChain` 的既有语义。
- 不新增路由守卫或后端 API 开关。
- 不新增通用 key-value 配置框架。

## What Changes

- `PortalAbilityConfigProvider` 解析并返回 `fullProcessEnabled`。
- `GET /api/v1/runtime/bootstrap` 的 `portalAbilityConfig` 投影 `fullProcessEnabled`。
- 前端 `runtimeConfig.portalAbilityConfig` 解析 `fullProcessEnabled`。
- `TurnBlock` 在计算有效 full-process 入口可见性时合并该开关。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.2 调用能力` → `agent-owned-resource-dynamic-loading`
  - 功能边界：`portal-ability-config` 增加受信 boolean 字段 `full-process-enabled`。
  - 系统质量属性：可靠性/恢复、可维护性。
- `FN-8.5 上传和管理附件` → `ts-runtime-bootstrap-config`
  - 功能边界：runtime bootstrap public DTO 投影 `fullProcessEnabled`。
  - 系统质量属性：可维护性、可测试性。
- `FN-10.6 前端定制` → `aico-display-control`
  - 功能边界：执行详情“完整过程”入口受 portal ability 开关控制，并与既有 `showThinkingChain` 控制叠加。
  - 系统质量属性：可维护性、可测试性。

## 影响范围（Impact）

- **Portal 集成方**：可以通过 active Agent package 配置隐藏“完整过程”入口。
- **前端用户**：默认行为不变；仅配置为 `false` 时对应按钮消失。
- **运维人员**：LOCAL 修改配置后需重启；REMOTE 沿用现有 fingerprint 热更新语义。
- **公共契约**：`portalAbilityConfig` 新增 required boolean 字段，属于 additive DTO 变更。
- **代码**：`packages/agent-app/src/config/portal-ability-config.ts`、`packages/agent-channel-web/src/schemas/runtime-bootstrap.ts`、`frontend/agent-web/src/config/runtimeConfig.ts`、`frontend/agent-web/src/features/chat/components/TurnBlock.tsx` 及相关测试。
