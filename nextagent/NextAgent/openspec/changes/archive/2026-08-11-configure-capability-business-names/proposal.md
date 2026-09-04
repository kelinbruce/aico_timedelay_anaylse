## Why

平台集成方目前只能通过修改 Agent Web 源码、补充构建期语言资源并重新发布前端产物，才能为扩展 Tool、Agent、Skill 和 Workflow 提供面向一线网络运维人员的业务名称。这个流程把产品级展示配置变成了源码维护工作，使同一前端产物难以服务具有不同业务术语的集成产品，也让已经存在的 AICOConfig 前端定制入口无法覆盖过程标题这一常见定制需求。

Capability 过程标题已经具备稳定的公开执行身份、集中名称解析和安全降级边界。本 change 现在只需把“集成 Capability 名称”接入既有 AICOConfig，而不需要改变执行、stream、history 或结果披露契约。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 平台集成方可以在 AICOConfig 中按 Capability kind、技术标识和语言配置扩展 Capability 的业务名称，无需修改或重新构建 Agent Web。
- local 与 immersive 宿主在页面启动时读取同一个 `sessionStorage["AICOConfig"]` 快照；collaborative 宿主继续通过 `loadAIAgent` 接收完整配置。
- 平台固定名称和固定标题模板保持治理优先级；AICOConfig 只覆盖集成 Capability 的构建期名称，并在缺失或非法时沿用既有构建期映射和技术标识降级。
- 配置只影响当前界面语言下的过程标题；live 与 history、三种宿主和三档结果呈现继续使用相同身份与标题规则。
- 缺失、部分非法或未知配置安全降级，不阻塞对话、过程历史或最终答案。

**非目标：**

- 不改变 Capability 注册、绑定、执行、授权、结果、审计身份或 lifecycle public payload。
- 不新增后端名称 resolver、运行时名称服务、Vite 环境变量、第二个前端配置 store 或热更新机制。
- 不允许 AICOConfig 覆盖平台内置 Capability 名称、Agent/Skill/Workflow 固定模板、执行状态或结果披露策略。
- 不从另一种语言借用名称，不冻结历史记录执行时名称，也不增加运行时语言切换机制。
- 不把 Markdown、HTML、参数、结果、描述或模型输出解释为业务名称。

## What Changes

- AICOConfig 新增可选的 Capability 业务名称配置，允许平台集成方为扩展 `TOOL`、`AGENT`、`SKILL`、`WORKFLOW` 身份分别提供中文或英文纯文本名称。
- local 宿主改为与 immersive 宿主一样，在页面启动时一次性读取并校验 `sessionStorage["AICOConfig"]`；配置缺失时保持当前默认行为。
- Capability 标题解析优先级调整为：平台固定映射、AICOConfig 集成名称、既有构建期集成映射、合法技术标识或中性标题降级。
- 非法名称条目按条目忽略并产生既有前端配置警告；合法条目继续生效，未知字段不影响行为。
- 历史过程只保存执行身份，始终按当前有效 AICOConfig、当前前端产物和当前界面语言重新渲染名称。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.6 前端定制`：平台集成方可以通过同一个 AICOConfig 契约定制三种宿主的扩展 Capability 业务名称。
- `F-2.4 查看请求状态`：一线网络运维人员看到的 Capability 过程标题可以使用宿主提供的产品业务语言，同时保持平台治理名称、过程结构和结果安全边界不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.6 前端定制` → `specs/aico-config-contract/spec.md`
  - 功能边界：AICOConfig 增加扩展 Capability 双语业务名称输入，local 与 immersive 统一使用启动期 sessionStorage 注入，collaborative 保持完整 payload 注入与替换语义。
  - 系统质量属性：安全、可靠性/恢复、可维护性、可测试性。
  - 映射说明：本 change 触及该 legacy Function 的现有主契约 `aico-config-contract`，不新增 Function 或 spec 映射。
- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：Capability 过程标题在平台固定名称之后消费有效 AICOConfig 集成名称，并保持构建期映射、技术标识和中性标题的确定性降级。
  - 系统质量属性：安全、可靠性/恢复、可维护性、可测试性、审计/可追溯性。
  - 映射说明：`ts-run-status-visibility` 是该 Function 的主规格；本 change 只修改既有业务名称映射 Requirement。

## 影响范围（Impact）

- 平台集成方需要按受约束的 kind、id、语言和值格式提供配置；已有 AICOConfig 不需要迁移。
- local 宿主将开始消费原本忽略的 `sessionStorage["AICOConfig"]`，未提供配置时界面和行为不变。
- Agent Web 的 AICOConfig 类型、手写校验、启动加载和过程标题解析需要相应调整，并增加三宿主、双语、优先级、非法条目和历史重渲染验证。
- 后端公共 API、stream event、Gateway、持久化、Capability metadata 和运维部署参数不受影响。
