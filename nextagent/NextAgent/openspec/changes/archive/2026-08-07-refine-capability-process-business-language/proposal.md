## Why

NextAgent 即将面向一线网络运维人员交付。当前对话过程直接显示 `Read`、`Bash`、`Python`、`search_memory` 等实现标识，一线人员需要先理解工具体系才能判断系统正在做什么，已经成为业务测试提出的实际交付阻塞问题。

现有 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 只控制结果披露范围，不负责把技术身份转换为业务语言。系统需要在不改变过程结构和结果安全策略的前提下，让前端依据最小、稳定的 Capability 身份生成业务标题，并在名称映射缺失时保留可理解的技术身份。

本 change 使用以下术语：

- **执行入口身份**：`capabilityKind + capabilityId`，表示实际产生 lifecycle event 的 Capability；`capabilityId` 继续保留现有执行入口语义。
- **目标能力标识**：可选 `targetCapabilityId`，只表示 `Agent`、`Skill`、`Workflow` 通用执行入口本次选择的具体目标能力。
- **业务名称映射**：Agent Web 构建期维护的 `kind + id → 用户可见名称` 映射；平台维护内置映射，集成产品维护其扩展能力映射。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 一线网络运维人员优先看到业务语言标题，而不是必须理解 Capability 技术标识。
- 后端只公开渲染所需的执行入口身份和可选目标能力标识，不发送业务标题、语言包或完整调用参数。
- 前端集中维护业务名称映射和固定标题模板；映射缺失时显示目标能力 id、执行入口 `capabilityId`，最后降级为“执行操作”/`Execute operation`。
- `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 对同一次调用使用相同身份；`CAPABILITY_RESULT_DELTA` 继续通过 `toolCallId` 关联，不重复新增身份字段。
- live、SSE、WebSocket、刷新后的 run-event history 以及三种 Agent Web 宿主使用同一身份投影和同一标题解析规则。
- `SUMMARY` 只有在既有安全摘要有效时显示摘要；无有效摘要时只显示标题和状态。

**非目标：**

- 不改变过程条目的产生、顺序、合并、层级、折叠、展开条件、动画或最终答案。
- 不改变 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 的结果披露范围，不新增 `safeResult`、详情 projector 或原始结果访问路径。
- 不在本 change 调整 RAG `SUMMARY` 的来源、预览或 `safeResult` 规则。
- 不改变 AskUserQuestion 的问题、选项、回答和 pending-input 生命周期呈现。
- 不展示 Bash 命令名、Python 脚本名或程序名；执行输入披露由后续 change 单独处理。
- 不支持同一系统中用户运行时切换语言后的历史名称选择；历史按当前前端产物中的映射重新渲染。
- 不处理 Hook、上下文压缩、附件、请求起止等非 Capability 系统事件文案。
- 不把 `topologyDiscovery`、`networkDiagnostic`、`inventoryLookup` 等 UCD、mock 或测试夹具声明为平台内置 Tool。
- 不翻译命令输出、代码、路径、错误码或网络专业术语等详情证据。
- 不新增 Capability 注册机制，不修改 Plugin SDK、`DefineToolInput`、`ToolMetadata` 或 `CapabilityDescriptor`。
- 不新增后端业务名称、运行时名称配置、名称 resolver、Provider 名称扩展或公共 action taxonomy。

## What Changes

- 用户可见的 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 增加 additive 的 `capabilityKind` 和可选 `targetCapabilityId`；旧 history 缺少新增字段时继续兼容读取。
- `capabilityId` 保持执行入口语义：普通 Tool 为自身 id；通用入口仍分别为 `Agent`、`Skill`、`Workflow`，不得改写为目标能力 id。
- `targetCapabilityId` 只用于匹配的通用入口，并从已完成解析和校验的目标参数形成；不公开 `agentId`、`name`、`recipeName` 等入口专属字段，也不公开 prompt、args、inputText、inputVariables 或其他调用参数。
- Agent Web 通过一个集中式名称解析入口生成标题：通用入口先使用目标能力映射，普通或直接能力使用 `capabilityKind + capabilityId` 映射，再按目标能力 id、执行入口 id 和通用标题安全降级。
- 平台在前端维护内置 Tool、Memory Tool、`ToolSearch`、`acquire_skill` 的名称和固定模板；集成产品在同一映射入口维护扩展 Tool、Agent、Skill、Workflow 名称。
- Bash 标题固定为“执行命令”，Python 标题固定为“执行程序”；两者不推断命令或程序用途。Python 的安全摘要使用程序措辞。
- 无有效安全摘要时移除“结果已返回，暂无可展示摘要”等占位语；详情只本地化平台拥有的标签，技术证据保持原样。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：Capability 执行过程使用公开身份和前端业务名称映射生成一线网络运维人员可理解的标题，现有过程结构与结果披露范围保持不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：Capability 生命周期公开身份、前端业务名称映射、兼容降级、有效摘要和详情标签。
  - 系统质量属性：安全、可靠性/恢复、可维护性、可测试性、审计/可追溯性。

## 影响范围（Impact）

- Capability lifecycle 与 Web stream payload 增加 additive identity 字段，live 与 history 均受影响。
- Agent Web 增加集中式业务名称映射、固定标题模板和统一降级行为。
- Capability 结果呈现、AskUserQuestion、RAG、Workflow display-control、Capability 注册与执行语义保持不变。
- `agent-contracts/capability`、Plugin SDK、Provider 路由、Gateway 和数据库 schema 不变。

## 需群内确认

已确认（2026-08-06）：

1. 用户可见 `CAPABILITY_STARTED`、`CAPABILITY_COMPLETED` 公开 `capabilityKind` 和可选 `targetCapabilityId`；`CAPABILITY_RESULT_DELTA` 不重复新增身份字段，通过既有 `toolCallId` 关联。
2. `capabilityId` 永远保持执行入口语义。`targetCapabilityId` 只表示 `Agent`、`Skill`、`Workflow` 通用入口本次选择的具体目标能力，后端不公开入口专属目标字段或业务名称。
3. 前端负责构建期名称映射和固定模板；同一前端产物内相同 `kind + id` 必须具有唯一、稳定的用户语义，映射更新后历史记录按当前映射重新渲染。
