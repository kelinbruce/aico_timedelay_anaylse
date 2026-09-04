# Design

## 设计范围

| Function | 目标变化 | 涉及 delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-5.2 调用能力` | `portal-ability-config` 新增三个受信入口开关，默认 `true`，仅 `false` 关闭 | `agent-owned-resource-dynamic-loading` | `FN-5.2 调用能力` |
| `FN-8.5 上传和管理附件` | runtime bootstrap public DTO 投影三个入口开关 | `ts-runtime-bootstrap-config` | `FN-8.5 上传和管理附件` |
| `FN-10.9 Cron 工具` | 定时任务入口在三种宿主中统一受 `cronTasksEnabled` 控制 | `agent-web-cron-task-dashboard` | `FN-10.9 Cron 工具` |
| `FN-8.15 管理长期记忆` | 长期记忆管理入口在 Immersive 与 Collaborative/PIU 中受 `longTermMemoryManagementEnabled` 控制 | `long-memory-web-management` | `FN-8.15 管理长期记忆` |
| `FN-8.16 知识导入` | 知识导入入口在 Immersive 与 Collaborative/PIU 中受 `knowledgeImportEnabled` 控制 | `agent-web-knowledge-import` | `FN-8.16 知识导入` |

## `FN-5.2 调用能力`

### 目标与规范依据

`portal-ability-config` 需要以受信 Agent package 配置为唯一来源，增加三个 boolean 入口开关，并保持字段独立回退和既有 LOCAL/REMOTE 生命周期。

本 Function 的目标 Requirements：

- canonical spec：`agent-owned-resource-dynamic-loading`
- `ADDED`：`Portal ability entry configuration fields and defaults`

### 当前实现

- `PortalAbilityConfigProvider` 已从 active Agent package 的 `config/config.json` 读取 `portal-ability-config`。
- 当前仅解析 `suggested-questions-enabled` 和 `ask-user-question-time-minutes`。
- LOCAL 模式已静态缓存；REMOTE 模式已按 fingerprint 热更新。
- 未知字段已被忽略，字段缺失或非法时按字段级默认值回退。

### GAP 分析

- 配置解析缺少三个入口开关。
- effective config 需要新增三个 boolean 字段，且默认值均为 `true`。
- 三个字段必须独立回退，不能因为一个字段非法导致整块配置失效。

### 修改方案

在 `PortalAbilityConfig` 中新增：

```ts
cronTasksEnabled: boolean;
longTermMemoryManagementEnabled: boolean;
knowledgeImportEnabled: boolean;
```

解析逻辑：

1. 读取 `cron-tasks-enabled`、`long-term-memory-management-enabled`、`knowledge-import-enabled`。
2. 每个字段仅接受 boolean。
3. 缺失或类型非法时回退 `true`。
4. 字段之间互不影响。
5. 未知字段继续忽略。

`PortalAbilityConfigProvider` 的 LOCAL/REMOTE 生命周期保持不变，不新增独立 provider 或第二套解析器。

## `FN-8.5 上传和管理附件`

### 目标与规范依据

Runtime bootstrap 需要把三个入口开关作为 public DTO 投影给前端，且不暴露 AskUserQuestion 等待时间。

本 Function 的目标 Requirements：

- canonical spec：`ts-runtime-bootstrap-config`
- `ADDED`：`Bootstrap API exposes portal ability entry gates`

### 当前实现

- `runtimeBootstrapResponse` 的 `portalAbilityConfig` 目前只包含 `suggestedQuestionsEnabled`。
- Bootstrap route 通过 `PortalAbilityConfigProviderPort` 获取 public projection。
- 前端 `runtimeConfig.ts` 目前只解析 `suggestedQuestionsEnabled`。

### GAP 分析

- Bootstrap schema 和投影缺少三个新字段。
- 前端 public DTO 解析缺少三个新字段。
- 需要保持 `additionalProperties: false`，避免误投影非 public 配置。

### 修改方案

- 扩展 `PortalAbilityBootstrapConfig`：
  - `cronTasksEnabled`
  - `longTermMemoryManagementEnabled`
  - `knowledgeImportEnabled`
- 扩展 `portalAbilityBootstrapSchema` 为三个 boolean 必填字段。
- Bootstrap route 继续从 provider 获取当前值，并投影三个字段。
- 前端 `PortalAbilityConfig` 和 `parsePortalAbilityConfig()` 同步解析三个字段。
- 缺失或非法字段在前端同样回退 `true`。
- 不把 `ask-user-question-time-minutes` 或毫秒派生值加入 bootstrap DTO。

## `FN-10.9 Cron 工具`

### 目标与规范依据

定时任务入口需要在 Local、Immersive、Collaborative/PIU 三种宿主中使用同一个 `cronTasksEnabled` 开关，默认可见，`false` 时隐藏。

本 Function 的目标 Requirements：

- canonical spec：`agent-web-cron-task-dashboard`
- `ADDED`：`Cron task dashboard entry gate`

### 当前实现

- `Sidebar.tsx` 中的定时任务入口在所有宿主下均渲染。
- `AIAgentPiuRuntime.tsx` 的 MoreMenuButton 中也渲染定时任务菜单项。
- 入口当前不受 portal ability 配置控制。
- 直达 `/cron-tasks` 路由和 Cron API 当前可用。

### GAP 分析

- 缺少入口可见性 gate。
- 需要保证三种宿主使用同一配置值。
- 需要保证关闭入口不影响路由和后端能力。

### 修改方案

- 在 Sidebar 中读取 `runtimeConfig.portalAbilityConfig.cronTasksEnabled ?? true`。
- 在 Collaborative/PIU MoreMenuButton 中读取同一字段。
- `false` 时不渲染对应 NavButton 或菜单项。
- 不修改 `ChatWorkspace` 的 `/cron-tasks` 路由。
- 不修改 Cron API、任务执行或权限逻辑。

## `FN-8.15 管理长期记忆`

### 目标与规范依据

长期记忆管理入口需要在 Immersive 与 Collaborative/PIU 中受 `longTermMemoryManagementEnabled` 控制；Local 继续不展示。

本 Function 的目标 Requirements：

- canonical spec：`long-memory-web-management`
- `ADDED`：`Long-term memory management entry gate`

### 当前实现

- `Sidebar.tsx` 使用 `mode !== 'local'` 控制长期记忆管理入口。
- `ImmersiveApp.tsx` 的 RIGHT 顶部栏渲染长期记忆管理按钮。
- `AIAgentPiuRuntime.tsx` 的 MoreMenuButton 渲染长期记忆管理菜单项。
- 入口当前不受 portal ability 配置控制。

### GAP 分析

- 缺少配置 gate。
- 需要把既有 `mode !== 'local'` 条件与新增配置开关组合。
- 需要保证 LEFT、RIGHT、Collaborative/PIU 的入口一致受控。

### 修改方案

- 有效可见性定义为：

```text
mode !== 'local' && longTermMemoryManagementEnabled !== false
```

- Sidebar、Immersive RIGHT 顶部栏、Collaborative/PIU MoreMenuButton 使用同一判断。
- `false` 时不渲染入口。
- 不修改 `#/memory` 直达路由、长期记忆 API 或记忆能力执行语义。

## `FN-8.16 知识导入`

### 目标与规范依据

知识导入入口需要在 Immersive 与 Collaborative/PIU 中受 `knowledgeImportEnabled` 控制；Local 继续不展示。

本 Function 的目标 Requirements：

- canonical spec：`agent-web-knowledge-import`
- `ADDED`：`Knowledge import entry gate`

### 当前实现

- `Sidebar.tsx` 使用 `mode !== 'local'` 控制知识导入入口。
- `ImmersiveApp.tsx` 的 RIGHT 顶部栏渲染知识导入按钮。
- `AIAgentPiuRuntime.tsx` 的 MoreMenuButton 渲染知识导入菜单项。
- 入口当前不受 portal ability 配置控制。

### GAP 分析

- 缺少配置 gate。
- 需要把既有 `mode !== 'local'` 条件与新增配置开关组合。
- 需要保证 LEFT、RIGHT、Collaborative/PIU 的入口一致受控。

### 修改方案

- 有效可见性定义为：

```text
mode !== 'local' && knowledgeImportEnabled !== false
```

- Sidebar、Immersive RIGHT 顶部栏、Collaborative/PIU MoreMenuButton 使用同一判断。
- `false` 时不渲染入口。
- 不修改直达内容视图、知识导入 API 或知识导入能力执行语义。

## 跨 Function 协作与端到端流程

```text
active Agent package config/config.json
        │
        ▼
PortalAbilityConfigProvider
        │
        ▼
runtime bootstrap public DTO
        │
        ▼
frontend runtimeConfig.portalAbilityConfig
        │
        ├─▶ Sidebar / Immersive LEFT
        ├─▶ Immersive RIGHT top bar
        └─▶ Collaborative/PIU MoreMenuButton
```

- 三个入口开关共用同一个 provider 和同一个 bootstrap DTO。
- 前端不直接读取 `config/config.json`。
- Local、Immersive、Collaborative/PIU 不维护各自独立的入口开关状态。
- LOCAL 模式配置变更需重启；REMOTE 模式沿用 provider 的 fingerprint 热更新机制。
- 本 change 只隐藏 UI 入口，不改变后端 API、路由守卫或能力执行语义。

## 跨 Function 质量属性设计

| 质量属性 | 影响 Functions | 共享机制 | 端到端验证 |
|---|---|---|---|
| 可维护性 | `FN-5.2`、`FN-8.5`、`FN-10.9`、`FN-8.15`、`FN-8.16` | 单一 provider、单一 bootstrap DTO、单一前端 runtime config | 断言三宿主入口均由同一配置值控制 |
| 可测试性 | `FN-5.2`、`FN-8.5`、`FN-10.9`、`FN-8.15`、`FN-8.16` | 字段级默认值与独立回退 | 覆盖默认、`true`、`false`、非法值和未知字段 |

## 验证策略

- **Unit**：
  - `portal-ability-config` 解析默认值、`false`、非法值、未知字段和字段独立回退。
  - 前端 `runtimeConfig` 解析三个新字段，缺失或非法时回退 `true`。
- **Contract**：
  - bootstrap response 包含三个新 boolean 字段。
  - bootstrap response 不包含 AskUserQuestion 等待时间或派生值。
- **Component**：
  - Sidebar 在 `false` 时不渲染对应入口。
  - Immersive RIGHT 顶部栏在 `false` 时不渲染对应按钮。
  - Collaborative/PIU MoreMenuButton 在 `false` 时不渲染对应菜单项。
  - Local、Immersive、Collaborative/PIU 使用同一配置值。
- **Regression**：
  - 默认和 `true` 行为保持不变。
  - 直达路由和后端 API 行为保持不变。
  - 既有 `suggestedQuestionsEnabled` 和 AskUserQuestion timeout 行为保持不变。
- **Architecture**：
  - 前端不读取 raw config。
  - 不新增 private path import。
  - 不创建第二套 portal ability 配置来源。

## 长期基线刷新计划

- `openspec/specs/agent-owned-resource-dynamic-loading/spec.md`
- `openspec/specs/ts-runtime-bootstrap-config/spec.md`
- `openspec/specs/agent-web-cron-task-dashboard/spec.md`
- `openspec/specs/long-memory-web-management/spec.md`
- `openspec/specs/agent-web-knowledge-import/spec.md`
- 对应 Function 文档和 spec-to-design-map。
- Feature、overview、architecture、modules、ADR 无需更新。

## 风险与取舍

- 入口隐藏不是权限边界；用户仍可通过直达 URL 或 API 访问能力。该取舍已在 proposal 和 specs 中显式声明。
- REMOTE 模式下配置热更新依赖既有 provider 机制；前端在 bootstrap 加载后不会主动轮询配置。该行为与现有 runtime bootstrap 机制一致。
- 三个字段都默认 `true`，确保现有部署行为不变。
- 只隐藏入口不修改后端语义，避免把 UI 可见性扩大成能力禁用或权限控制。

## 待确认问题

无。
