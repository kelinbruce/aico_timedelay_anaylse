## Context

“完整过程”按钮位于 ProcessPanel 摘要行，仅在过程详情展开且当前过程数据可还原 full-process timeline 时可见。点击后由 `TurnBlock` 打开 Run Graph。该按钮当前还受 `AICOConfig.showThinkingChain` 控制，但该配置来自宿主定制，不覆盖按 Agent package 部署治理入口的需求。

`portal-ability-config` 已经拥有受信 Agent package 来源、LOCAL/REMOTE 生命周期、独立 boolean 回退和 runtime bootstrap 投影。新增入口开关应复用该链路。

## Goals / Non-Goals

**Goals：**

- 以 `full-process-enabled` / `fullProcessEnabled` 贯穿 Agent package 配置、bootstrap DTO 和前端解析。
- 默认开启，仅显式 `false` 隐藏入口。
- 三种宿主共享同一 `TurnBlock` 入口投影。
- 保持 ProcessPanel、过程条目、Run Graph 数据和 API 语义不变。

**Non-Goals：**

- 不实现后端 API 级禁用。
- 不改变 `showThinkingChain`。
- 不拦截 Run Graph 内部路由或程序化打开路径。

## Decision

### 配置与 DTO

`parsePortalAbilityConfig` 使用现有 `parseEntryAbilityEnabled` 语义解析 `full-process-enabled`：仅 `false` 关闭，其他值回退 `true`。`PortalAbilityConfig` 和 `PortalAbilityBootstrapConfig` 增加 required boolean 字段，bootstrap schema 保持 `additionalProperties: false`。

### 前端投影

`TurnBlock` 保留现有两个可见性条件：

1. 过程数据允许 full-process timeline；
2. `AICOConfig.showThinkingChain !== false`。

在此基础上追加 `runtimeConfig.portalAbilityConfig.fullProcessEnabled`。三个条件为 AND 关系，避免任一治理面关闭时入口仍可见。

### 架构评审结论

- **通过**。本 change 不新增 package、目录层级或构建产物。
- `agent-app` 继续拥有受信 Agent package 配置解析；`agent-channel-web` 只拥有 bootstrap public DTO 投影；`frontend/agent-web` 只消费 public DTO 并控制浏览器入口可见性。
- 不引入 private path import、第二套配置来源、request lifecycle、persistence 或 capability authority 变更。
- OpenSpec change 目录属于既有 `openspec/changes` 生命周期结构，归档前不更新 stable baseline。

## Cross-Function Impact

| Function | 影响 | spec |
| --- | --- | --- |
| `FN-5.2 调用能力` | Agent-owned portal ability 配置新增一个受控字段 | `agent-owned-resource-dynamic-loading` |
| `FN-8.5 上传和管理附件` | bootstrap public DTO 增加一个 boolean 投影 | `ts-runtime-bootstrap-config` |
| `FN-10.6 前端定制` | full-process 入口可见性叠加部署级 gate | `aico-display-control` |

## Validation Strategy

- `packages/agent-app/tests/portal-ability-config.test.ts`：默认值、`false`、非法值、字段独立回退。
- `packages/agent-channel-web/tests/runtime-bootstrap-portal-ability.test.ts`：provider 变化、缺失/非法回退、schema 必填投影。
- `frontend/agent-web/tests/runtime-config.test.ts`：public DTO 解析与默认回退。
- `frontend/agent-web/tests/TurnBlock.test.tsx`：`false` 时过程面板仍可展开但“完整过程”按钮不可见。
- OpenSpec strict validation。
