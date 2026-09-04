# NextAgent v2.1 Release Notes

**发布日期**: 2026-07-09
**版本范围**: v2.0 → HEAD
**变更统计**: 316 commits (205 non-merge), 883 文件变更 (+90,397 / -13,857), 覆盖 Workflow v2、Gateway local/remote、Model Gateway、Capability/Plugin、agent-web 交互、发布打包和开发者文档

## 摘要

v2.1 是 v2.0 之后的主路径扩展和发布稳定性版本，重点把 NextAgent 从本地可运行的智能体框架推进到更完整的 Workflow 编排、远端 Gateway/Model 接入、Agent 级插件治理、结构化工具结果投影和全栈打包发布门禁。主要交付：

- **Workflow v2 主链路成型** - recipe v2 runtime、节点族、checkpoint/recovery、远端执行、gateway-driven mode 和 agent-loop workflow tool 进入可验证主路径。
- **Gateway 与 Model 远端化边界收敛** - 支持 local/remote entrypoint owner、per-entry provider resolution、remote gateway reference binding、model gateway profiles 和 remote model gateway provider。
- **Capability、Plugin 与 Skill 治理增强** - 新增 TodoWrite、planning tool calling mode、runtime-generated skills、agent-scoped plugin composition 和用户可见 skill catalog 过滤。
- **Local shared data root 与运行包发布稳定性** - 增加本地 shared data root，修复 release package gate、runtime package config root、local gateway 要求和 P1/P2 gate helper。
- **agent-web 交互体验补齐** - 分类问题、高频问题、输入联想、skill 分类展示、权限态提示、失败 turn 操作和 shared conversation 行为继续收敛。
- **开发者资料与 OpenSpec 基线同步** - 刷新 developer guide 01-21、remote gateway/channel/plugin 文档、长期设计文档和多组 OpenSpec archive/baseline。

---

## 核心亮点

### 1. Workflow v2、节点编排与远端执行

**OpenSpec Change**: `add-ts-workflow-*`, `refine-ts-workflow-execution-engine-v2`, `refine-ts-workflow-recipe-v2-contracts`

Workflow 从基础 engine 扩展为覆盖 recipe 契约、节点执行、恢复、远端执行和 Agent tool 触发的编排主路径。

- 新增 recipe v2 runtime、controlPolicy、inputs、presentation schema，并将 pending-input / resume-state 类型推进共享 contracts。
- 落地 interaction、knowledge、LLM、capability、gateway 等节点族，补充 node failure priority chain、exception transition、safeError 映射和 resolved input 投影。
- 支持 checkpoint persistence、rollback、多节点循环、REST batch invocation、long-task single-API polling 和 event-history full node projection。
- 新增 workflow remote execution mode，通过 gateway SSE streaming 和 UDS transport 支持远端 workflow 执行。
- 新增 Workflow builtin tool 和 agent-loop workflow execution，用于 Agent 在受控工具边界触发 workflow。

### 2. Gateway 配置、远端入口与 Model Gateway

**OpenSpec Change**: `add-ts-gateway-configuration`, `add-model-gateway-provider`

Gateway 与 Model 接入从本地静态装配继续收敛到 entrypoint/provider 清晰、可远端部署、可按 profile 选择的配置模型。

- 拆分 local 与 remote entrypoint ownership，remote entrypoint 保持外部 owner 管理。
- 支持 per-entry provider resolution、sync provider bindings、reference binding provider 和 external module reference structure。
- 新增 `agent-platform-gateway-remote` reference providers，覆盖 model、RAG、sandbox、scheduled maintenance 和 workflow remote execution。
- 新增 model gateway profiles、remote model gateway provider 和 product model override 支持。
- 补充 remote gateway package startup 测试和 remote implementation boundary 文档，降低部署边界误用风险。

### 3. TodoWrite、结构化工具结果与过程投影

**OpenSpec Change**: `add-ts-todowrite-tool`, `add-ts-tool-structured-delta`

任务过程从纯文本回答继续扩展到可治理的计划状态、结构化工具结果和前端过程 UI 投影。

- 新增 `TodoWrite` 内置工具、planning tool calling mode 和 todo state revision persistence。
- 将 todo list results 投影到 process UI，并记录 gateway persistence diagnostics。
- 新增 `TOOL_STRUCTURED_DELTA` event，用于 CLIP 等结构化工具结果投影。
- 修复 deprecated content delta 消费、terminal stream status 和 terminal timeout failure state。
- 新增 TodoWrite skill fixture、subsystem tests、E2E fixture validation 和 workflow routing gate fixture 修复。

### 4. Agent 级 Plugin / Skill 组合治理

**OpenSpec Change**: `add-ts-agent-scoped-plugin-composition`

Plugin、Skill 和 generated skill 从全局注册继续收敛到 agent-scoped、用户可见性明确、目录和 manifest 一致的治理模型。

- 新增 agent-scoped plugin composition、plugin API version contract 和 routing policy resolution 重构。
- 支持 runtime-generated skills，并强制 generated skill name / folder alignment。
- 隐藏非用户可调用 skill，避免内部能力暴露到用户 skill catalog。
- 收敛 plugin provider governance、policy registry executable shape 和 routing policy owner。
- 刷新 agent plugin guide、runtime generation guidance、manifest validation guidance 和 archive design sync 检查。

### 5. Local Shared Data Root 与发布打包稳定性

**OpenSpec Change**: `add-ts-local-shared-data-root`

本地运行包新增受控 shared data root，并把打包、release gate 和运行包入口修复纳入可重复发布路径。

- 新增 local shared data root，覆盖 agent package assembly、bash/python tool、skill resource access 和 local shared data root 规格。
- 修复 runtime package local gateway 要求、runtime package config root、deployment launcher entrypoint 和 remote deployment package entrypoint。
- 恢复 local release package gate，并保持 release gate archives 不泄漏到 repo root。
- Windows 打包路径生成 `nextagent-local-win32-x64.zip`，release package gate 和 P1/P2 scenario gate 可重复验证。
- 修复 P1/P2 gate helper 读取 execution workspace 时缺少 `sharedDataRoot` 的问题。

### 6. agent-web 交互、权限态与问题入口

**OpenSpec Change**: `add-ts-category-question`, `add-ts-high-frequency-question`, `add-ts-question-association`

Web 端继续补齐面向运维使用的入口、推荐、权限态和长会话稳定性。

- 新增分类问题推荐、高频问题、用户问题活动记录、pin UI 和输入联想 source labels。
- 优化 skill selector、skill category display、category modal/bar/chip 和 welcome/guide 入口。
- 修复长会话 composer 输入响应、anchored pagination、stop button refresh、session rename i18n 和 AuthGate disabled wrapper gap。
- 对无写权限用户禁用 composer 输入并显示 tooltip；shared conversation 隐藏 pin-question，失败或空 turn 禁用 share/favorite。
- 引入 markdown `xss` sanitization 依赖并固定前端依赖版本，减少前端构建漂移。

### 7. 文档、OpenSpec 归档与质量门禁

本版本系统刷新开发者资料、OpenSpec 长期设计和发布验证资产，使二次开发者能按当前 target state 理解代码。

- 刷新 `docs/developer/01-21`，新增 business secondary development、agent plugins、remote gateway development 和 channel development 指南。
- 更新 README、API reference、Recipe node specification detail、workflow design、gateway boundary、capability SPI 和 module design。
- 归档或同步 session delete、session fork、architecture gate、memory、category/high-frequency/question association、model thinking、python/bash failure 等 OpenSpec baseline。
- 扩展 release E2E gate、P1/P2 scenario gate、security/resilience gate、release package gate 和 product journey gate。
- 维护 TypeScript strict/noUncheckedIndexedAccess、architecture guard、contract tests 和 real model smoke 快速路径。

---

## 问题修复

### Web 与交互
- 修复长会话下 composer 输入卡顿、anchored pagination 控制丢失和 stop button 刷新状态。
- 修复 failed/empty turn 的操作展示、分享/收藏禁用和 shared conversation 权限态。
- 修复 AuthGate disabled wrapper 间距、PIU 无权限 header、session rename i18n 和高频问题布局 gap。
- 修复 suggested questions 单换行输出拆分，并为 next-question recommendations 禁用 thinking。

### Runtime、Workflow 与 Stream
- 修复 subagent run 中用户问题能力被错误允许的问题。
- 修复 workflow merge contract regression、user_check_result 类型、first poll result timeout deadline、recipe loading agent scope 和 guardrail hook contract。
- 修复 CLIP SSE result normalization、subscribe stdout normalization、stream projection fallback 和 stream subscribe result deltas。
- 修复 terminal timeout live failure、terminal stream status 和 deprecated content delta reject。

### Gateway、Packaging 与 Composition
- 修复 remote entrypoint ownership、SkillHub remote gateway shim、gateway binding initialization 时机和 app composition architecture guard。
- 修复 runtime package 必须包含 local gateway、local runtime config dir、release gate archives、local release package gate 和 dev-watch gateway-backed startup。
- 修复 product model override、workflow gateway contract expectations 和 remote gateway package startup 覆盖。
- 修复 local shared data root 进入 runtime-facing workspace policy 后，P1/P2 gate helper 未传 `sharedDataRoot` 的回归。

### Capability、Skill 与 Plugin
- 修复 generated skill name/folder alignment、executable skill scripts 保留和 skill creator fixture/governance。
- 修复 plugin composition routing contract、acceptance gates、provider governance gaps 和 archive gaps。
- 修复非用户可调用 skill 暴露到 skill catalog 的问题。

---

## 工程改进

### 架构与重构
- `agent-platform-gateway-local` 按 owner 拆分 sqlite gateway stores。
- `agent-channel-common` 抽取共享 channel primitives，CLIP stream projection 从 channel 侧继续收窄并迁移 owner。
- Plugin routing policy resolution 在 runtime/core/default-agent 边界间多轮收敛，减少 composition 内的语义漂移。
- Gateway remote provider 保持 reference minimal，入口 owner、provider binding 和 external reference 职责更清晰。

### 测试与验证
- 新增或扩展 workflow capability/gateway/interaction/knowledge/LLM nodes、checkpoint、control policy、resume、remote execution 和 agent-loop tests。
- 扩充 gateway configuration、remote gateway package startup、model gateway provider、P1/P2 scenario、release package、security/resilience 和 product journey gate。
- 增加 frontend component/hook/service 测试，覆盖 conversation store、request store、composer controller、stream controller、safe capability result 和 markdown formatting。
- 修复 TS strict、branded AgentId、noUncheckedIndexedAccess 和 workspace/release suite stratification。

### 文档
- 刷新 developer guide 01-21，新增 remote gateway、channel、agent plugin 和业务二开指南。
- 更新 OpenSpec module/architecture/ADR/spec-to-design-map，使长期设计与当前 workflow、plugin、gateway、model 和 capability 状态对齐。
- 更新 release 文档、README、API reference、open source component list 和 Recipe node specification detail。

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 316 (205 non-merge) |
| 文件变更 | 883 |
| 代码新增 | +90,397 |
| 代码删除 | -13,857 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | Web / Workflow / Gateway / Packaging / Capability |
| 主要测试扩充 | Workflow nodes + remote gateway + P1/P2 scenario + release package + frontend stream/composer |

---

## 升级指南

### 从 v2.0 升级

1. **Workflow 使用方**:
   - 检查 recipe 是否已按 v2 runtime、controlPolicy、inputs、presentation 和 node family 规格更新。
   - 如果使用 checkpoint、远端执行、长任务 polling 或 agent-loop tool，验证 resume、SSE streaming、event-history 和 failure priority chain。

2. **Gateway / Model Gateway 集成方**:
   - 检查 gateway entrypoint 配置是否区分 local/remote owner，并确认 per-entry provider resolution。
   - 远端 provider 需要按 reference binding provider、external module reference 和部署 entrypoint 重新确认装配。
   - Model provider 需要确认 model gateway profile、product model override 和 remote model gateway provider 行为。

3. **Capability / Plugin / Skill 扩展方**:
   - 自定义 plugin 需要确认 agent scope、policy resolution、API version contract 和 user-invocable 标记。
   - runtime-generated skill 需要保持 skill name、folder、manifest 和 workspace staging 规则一致。
   - Skill catalog 消费端不要假设所有 registered skill 都会展示给用户。

4. **本地运行包与 shared data**:
   - 本地运行包会包含受控 `shared-data` root；使用 bash/python/read/write/skill resource access 时需按新 workspace policy 验证路径权限。
   - 打包需保留 local gateway，并验证 `npm run test:e2e:release` 与 `npm run pack:release`。

5. **前端与交互**:
   - 验证分类问题、高频问题、输入联想、skill 分类展示和无权限状态是否符合业务配置。
   - 长会话、失败 turn、shared conversation 和 streaming refresh 场景需要重新走回归。

### 兼容性

- **Breaking Changes**: 未从本区间证据中识别到强制迁移级别的公开 breaking change；但 Workflow recipe v2、Gateway remote entrypoint、local shared data root、agent-scoped plugin composition 和 Skill catalog 可见性存在行为收敛，需要按升级指南验证。
- **Behavioral Changes**:
  - Workflow 支持更多节点族、checkpoint 恢复、远端执行和 agent-loop tool，运行态投影更丰富。
  - Gateway provider 解析从全局/隐式路径收敛到 per-entry 配置，并新增 remote reference provider。
  - Model provider 可通过 gateway profile 和 remote provider 接入。
  - 本地执行 workspace 增加只读 `shared-data` root。
  - 非用户可调用 skill 不再出现在用户 skill catalog。
  - TodoWrite 会把规划状态持久化并投影到 process UI。
- **Minimum Node.js**: 仍遵循仓库 Node.js LTS / `>=22.0.0` 要求。

---

## 已知限制

1. **Workflow v2 能力面仍在快速扩展**: 节点族、远端执行和恢复路径已具备主路径能力，但复杂 recipe 的容量、治理策略和跨节点诊断仍需要按业务场景压测。
2. **Remote Gateway 仍以 reference structure 为主**: provider/binding 边界清晰，但外部服务 SLA、认证、限流、租户隔离和部署治理仍由接入方实现。
3. **Local shared data root 是受控只读根**: 它解决本地共享资料访问，不应被当作跨租户数据交换或通用持久化目录。
4. **TodoWrite 是规划状态工具，不是通用任务系统**: 当前重点是 Agent 过程可见性和状态修订，不替代完整项目管理或跨会话任务编排系统。
5. **Plugin/Skill 治理依赖正确元数据**: agent-scoped composition、user-invocable 过滤和 generated skill staging 依赖 manifest、目录和 policy 配置一致。

---

**下一步**: 后续版本可继续聚焦 Workflow 复杂编排治理、Remote Gateway 生产化接入、Model Gateway provider 生态、Plugin/Skill 发布治理，以及面向电信运维场景的问题入口质量和 release qualification 证据沉淀。
