## Why

Portal 集成方当前无法按部署隐藏 Agent Web 默认提供的三个业务入口：定时任务、长期记忆管理和知识导入。对于不需要这些能力的交付环境，入口仍会出现在左侧操作栏和协作式 MoreMenu 中，造成用户误入、增加解释成本，并弱化产品定制能力。

现有 `portal-ability-config` 已经为推荐问题提供了受信配置开关，并在 Agent package、runtime bootstrap 和前端之间形成了稳定链路。三个新增入口开关应复用同一机制，而不是引入第二套前端配置或环境变量。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Agent package 的 `config/config.json` 新增三个受信 boolean 字段：
  - `cron-tasks-enabled`
  - `long-term-memory-management-enabled`
  - `knowledge-import-enabled`
- 三个字段默认值均为 `true`。
- 仅当字段明确为 `false` 时，前端隐藏对应业务入口。
- 定时任务入口在 Local、Immersive、Collaborative/PIU 三种宿主下均受 `cron-tasks-enabled` 控制。
- 长期记忆管理和知识导入入口继续保留既有 host 可见性边界：
  - Local 宿主不展示；
  - Immersive 与 Collaborative/PIU 默认展示；
  - 对应字段为 `false` 时隐藏。
- 同一功能在同一宿主下的多个入口必须使用同一个开关，不得出现部分入口隐藏、部分入口仍可见。
- 配置缺失、字段类型非法或未知字段不改变其他字段的 effective 值，均按默认 `true` 处理。
- 本次变更只控制 UI 入口可见性，不改变后端 API 可用性、权限模型或既有能力执行语义。

**非目标：**

- 不修改后端 API 路由、错误响应或权限校验。
- 不禁用底层 Cron 任务执行、长期记忆读写或知识导入能力。
- 不引入通用 key-value 配置框架。
- 不改变 `suggested-questions-enabled` 和 `ask-user-question-time-minutes` 的既有语义。
- 不改变 Local、Immersive、Collaborative/PIU 之间已有的功能可用性差异，除非新增字段明确关闭对应入口。
- 不新增前端路由守卫；本 change 只隐藏入口，不拦截直达 URL。

## What Changes

- `portal-ability-config` 新增三个 boolean 字段，默认 `true`。
- `PortalAbilityConfigProvider` 解析并返回三个新字段。
- Runtime bootstrap public DTO `portalAbilityConfig` 新增：
  - `cronTasksEnabled`
  - `longTermMemoryManagementEnabled`
  - `knowledgeImportEnabled`
- 前端 `runtimeConfig.portalAbilityConfig` 解析上述三个字段。
- 左侧操作栏、Immersive RIGHT 顶部栏和 Collaborative/PIU MoreMenuButton 根据对应字段隐藏入口：
  - `cronTasksEnabled === false` 时隐藏定时任务入口。
  - `longTermMemoryManagementEnabled === false` 时隐藏长期记忆管理入口。
  - `knowledgeImportEnabled === false` 时隐藏知识导入入口。
- 三个字段互相独立，一个字段非法或缺失不影响其他字段。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.9 Cron 工具` → `agent-web-cron-task-dashboard`
  - 功能边界：定时任务入口新增受信配置开关；`false` 时隐藏 Local、Immersive、Collaborative/PIU 中的入口。
  - 系统质量属性：可维护性、可测试性。

- `FN-8.15 管理长期记忆` → `long-memory-web-management`
  - 功能边界：长期记忆管理入口新增受信配置开关；`false` 时隐藏 Immersive 与 Collaborative/PIU 中的入口，Local 继续不展示。
  - 系统质量属性：可维护性、可测试性。

- `FN-8.16 知识导入` → `agent-web-knowledge-import`
  - 功能边界：知识导入入口新增受信配置开关；`false` 时隐藏 Immersive 与 Collaborative/PIU 中的入口，Local 继续不展示。
  - 系统质量属性：可维护性、可测试性。

- `FN-5.2 调用能力` → `agent-owned-resource-dynamic-loading`
  - 功能边界：`portal-ability-config` 增加三个受控 boolean 字段，继续由 Agent package 受信配置提供 effective 值。
  - 系统质量属性：可靠性/恢复、可维护性。

- `FN-8.5 上传和管理附件` → `ts-runtime-bootstrap-config`
  - 功能边界：runtime bootstrap public DTO 投影三个新增入口开关。
  - 系统质量属性：可维护性、可测试性。

## 影响范围（Impact）

- **Portal 集成方**：可以通过 Agent package 配置隐藏不需要的业务入口。
- **前端用户**：默认行为不变；只有配置为 `false` 时对应入口消失。
- **Agent 开发者**：无需修改业务代码，只需调整 `config/config.json`。
- **运维人员**：无新增部署步骤；LOCAL 模式仍需重启生效，REMOTE 模式沿用现有配置热更新机制。
- **公共契约**：`portalAbilityConfig` public DTO 新增三个 boolean 字段，属于 additive 变更。
- **代码**：`packages/agent-app/src/config/portal-ability-config.ts`、`packages/agent-channel-web/src/schemas/runtime-bootstrap.ts`、`frontend/agent-web/src/config/runtimeConfig.ts`、`frontend/agent-web/src/features/sidebar/components/Sidebar.tsx`、`frontend/agent-web/src/app/ImmersiveApp.tsx`、`frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx`；相关测试同步更新。
