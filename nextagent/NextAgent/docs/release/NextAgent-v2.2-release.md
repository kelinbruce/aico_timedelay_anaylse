# NextAgent v2.2 Release Notes

**发布日期**: 2026-07-14
**版本范围**: v2.1 → HEAD
**变更统计**: 197 commits (130 non-merge), 622 文件变更 (+62,826 / -10,039), 覆盖 SkillHub/Plugin、Workflow 交互、Task Channel、Cron/后台任务、agent-web、Gateway/Packaging、Dev Workbench 和架构收敛

## 摘要

v2.2 是 v2.1 之后的能力治理、前端交互和发布稳定性版本，重点把 SkillHub 获取链路、指令化能力路由、Workflow 可见投影、Task Channel 对接、Cron/后台任务、开发调试台和本地运行包门禁继续收敛到可验证主路径。主要交付：

- **SkillHub、Skill Metadata 与 Plugin 启动治理增强** - 远端内容源边界、runtime skill acquisition loop、SkillMetadata 扩展、localized source metadata 和同步插件启动加载进入受控路径。
- **Workflow 与指令化路由稳定性提升** - 支持 recipe runtime directory scanning、inclusive-gateway alias、USER_CHECK timeline、answer 去重、visible delta 上限扩展和 retry/edit/recovery 原始输入恢复。
- **Task Channel 与 CLIP companion API 补齐** - 异步 CLIP callback、callback envelope、edit endpoint、standalone API 文档和 directive syntax 对齐。
- **Cron、后台任务和 release package 更可用** - Cron tool 统一为 durable gateway-backed 能力，后台任务 store/轮询/自然完成行为修复，运行包启动验证更稳定。
- **agent-web 可配置化和长会话交互修复** - AICOConfig 外部定制、expand panel、收藏粒度、滚动/焦点/stream 合并、terminal run 识别和分享禁用状态继续收敛。
- **Dev Workbench 与诊断能力增强** - 新增本地 Agent 调试台，按访问范围、导航、run diagnostics、process graph 和 source-owned diagnostics 收敛。
- **架构和持久化边界收窄** - `agent-app` composition root 瘦身、configurable system resource roots、gateway store providers 拆分和 package resource roots 对齐。

---

## 核心亮点

### 1. SkillHub、Skill Metadata 与 Plugin 启动治理

**OpenSpec Change**: `refine-ts-remote-skill-content-source-boundary`, `add-ts-runtime-skill-acquisition-loop`, `add-skill-metadata-extension`, `add-skill-catalog-source-metadata`, `support-sync-plugin-startup-loading`

Skill/Plugin 能力从目录和全局配置继续收敛到来源可信、元数据明确、启动行为可控的治理路径。

- SkillHub 安装幂等、远端内容源和 remote content facts 经过 gateway 归一化，避免 core 暴露获取过程内部形状。
- 新增 runtime skill acquisition loop，并将 acquired skill resources 通过 provider 投影到运行时。
- SkillMetadata 支持结构化 metadata 扩展，Skill catalog 暴露 localized source metadata，便于前端和集成侧展示来源。
- 修复 SkillHub install dir 从 workspace root 解析、qualified glob pattern 和 skill resource glob pattern。
- 新增同步插件启动加载，并补齐 developer hook trace plugin 的 SDK、artifact 和 packaging 纳入发布包。

### 2. Workflow 可见投影、交互节点与指令路由

**OpenSpec Change**: `add-ts-workflow-recipe-classification-fields`, `add-ts-workflow-gateway-nodes`, `add-ts-directive-capability-routing`, `refine-ts-workflow-visible-delta-limit`

Workflow 主路径继续补强 recipe 发现、用户交互节点、可见 delta 和指令化能力路由，减少长链路过程投影的歧义。

- 新增 recipe runtime directory scanning、FIFO cache 和默认启用 provider，使 recipe 运行时发现路径更接近产品配置。
- 支持 `inclusive-gateway` 作为 `PARALLEL` alias，并同步 workflow gateway nodes spec/design。
- 修复 USER_CHECK interaction node timeline event、ANSWER 去重、generatedMessages 提取和重复 `USER_INPUT_REQUIRED`。
- Workflow capability result 和 visible delta 投影从 channel/common 继续下沉到 tool layer，并集中 tool timeline projection。
- visible delta 和 terminal message limit 从 16,384 扩展到 150,000，减少长输出在工作流节点间被截断的风险。
- retry/edit/recovery 恢复原始 `inputText`，保持 skill/recipe directive routing 不被重试路径破坏。

### 3. Task Channel 与 CLIP Companion API

**OpenSpec Change**: `add-ts-task-channel`

Task Channel 从基础通道继续补齐异步 callback、CLIP envelope、stream event mapping 和面向前端 companion 的 API 文档。

- 完成 async CLIP callback，并修复 `statusFor` mapping、callback delivery defaults 和 params envelope。
- 补齐 `TOOL_STRUCTURED_DELTA` 到 StreamEventType mapping 的测试覆盖。
- 简化 edit endpoint URL，修复 spec/design 之间的 endpoint 矛盾，并同步 manual test harness 示例。
- 新增 standalone `docs/apis/task-channel-api.md`，刷新 API 文档并记录 directive syntax。
- task-channel header 命名与 web-channel convention 对齐，降低接入方误用风险。

### 4. Cron、后台任务和 Bash Background Execution

**OpenSpec Change**: `add-ts-cron-tools`, `fix-background-task-completion-continuation`

后台任务能力从 bash 背景执行扩展到 durable Cron tool，并补齐本地/远端触发、store 装配和自然完成语义。

- 新增 `CronCreate` / `CronDelete` / `CronList`，随后收敛为 durable gateway-backed Cron tool。
- Cron 支持本地和远端 trigger execution，并修复 persistence scope 与 callback composition。
- Cron 默认加载到 local runtime，并增加 cron tool calling E2E fixture。
- 修复 local gateway entrypoint 和 local runtime package 中 background task store 的装配。
- unknown session 的 background-tasks 返回空列表，前端无 active session 时停止轮询，后台任务自然完成保持静默。
- bash 后台执行能力合入主线，为长耗时命令提供受控后台运行基础。

### 5. agent-web 外部配置、过程面板和长会话稳定性

**OpenSpec Change**: `agent-web-selfdefine-config`, `add-ts-expand-panel`, `refine-favorite-list-turn-granularity`

Web 端继续补齐外部配置、过程展示和长会话交互，重点修复流式输出、焦点、收藏和分享边界。

- 新增 AICOConfig external customization system，覆盖外部配置、渲染和多 host mode 场景。
- 新增 `EXPAND_PANEL` tool event type 和 expand panel UI，用于结构化过程面板展示。
- 收藏从 session-level 调整为 turn-level granularity，并修复 favorites sidebar hover/scroll 宽度对齐。
- 修复 streaming output 滚动冲突、用户发送后焦点未定位到最新对话、streaming TEXT 额外换行和 content snapshots 合并。
- terminal stream 按 `runId` settle，避免多 run/长会话下终态流误判。
- 非终态 conversation turn 禁用 share checkbox，并补充 retry/edit 附件不可用的友好 i18n 提示。

### 6. Gateway、Packaging 与发布资格稳定性

**OpenSpec Change**: `add-ts-configurable-system-resource-roots`, `split-ts-gateway-store-providers`, `fix-release-skip-startup-validation`

本版本继续收窄 Gateway store owner、系统资源根和 release package 启动验证，使本地运行包更接近可交付形态。

- `agent-app` 支持 configurable system resource roots，并让 packaging honor configured package resource roots。
- release package 包含 default agent root，按运行时依赖进行 staging，并将 telecom qa 作为 system skill 打包。
- 修复 skipped release package 仍可启动的验证路径，并稳定 packaged runtime validation。
- `agent-platform-gateway-local` 拆分 persistence store providers，`agent-app` 在 shutdown 时等待 provider 关闭。
- 修复 background task store 进入 local runtime package，避免运行包中后台任务接口 503。
- 清理无效嵌套 `@types/node` 和 dev-workbench 冗余类型依赖，降低 `tsc -b` duplicate type clash 风险。

### 7. Dev Workbench 与架构边界收敛

**OpenSpec Change**: `add-ts-dev-agent-workbench`, `shrink-agent-app-to-composition-root`

开发调试能力和 composition root 边界同步推进，便于定位 Agent 运行过程，同时减少 app 层持有业务语义。

- 新增 local agent debugging workbench，并按本地调试访问范围和导航收敛。
- run diagnostics 和 process graph 更清晰，source-owned diagnostics 只展示来源拥有的事实。
- 用 invocation facts 替代重复 context projection，减少调试视图对内部重复投影的依赖。
- `agent-app` composition root 拆出 helpers、runtime session channel composition 和 residual composition logic。
- runtime node adapters 从 app 移出，composition root 继续保持唯一装配点但不承载业务语义。

---

## 问题修复

### Web 与交互
- 修复 streaming output 滚动冲突、TEXT 拼接多余换行、content snapshots 累积合并和 terminal stream run 识别。
- 修复发送消息后焦点未定位到最新对话、favorites sidebar hover/scroll 对齐和 background-task polling 无会话时仍发起请求。
- 修复 retry/edit 附件不可用提示、非终态 turn 分享 checkbox 和 DatePicker zh-cn locale 回滚后的依赖状态。

### Workflow、Runtime 与 Core
- 修复 Workflow generic success fallback message、visible delta per node channel 累积和 delta timeline event persistence。
- 修复 USER_CHECK 交互节点的 timeline event、ANSWER 去重、agent loop generatedMessages 提取和重复 pending input 投影。
- 修复 retry/edit/recovery 中原始输入丢失导致 directive routing 偏移的问题。
- 修复 recoverable run recovery 未按 agent scope 约束的问题。

### Skill、Capability 与 Plugin
- 修复 SkillHub install idempotency、remote content source boundary、remote content facts 和 acquired skill resources 投影。
- 修复 glob guidance、runtime path containment、skill resource qualified patterns 和 unauthorized model hint 覆盖。
- 修复默认 SkillHub provider、remote SkillHub local defaults 和插件启动加载边界。

### Task Channel、CLIP 与 Stream
- 修复 CLIP callback delivery defaults、params envelope、async mode status mapping 和 `TOOL_STRUCTURED_DELTA` mapping。
- 修复 task-channel edit endpoint URL、文档中 stale edit URL 和 header naming 与 web-channel convention 的不一致。

### Gateway、Packaging 与 Background Tasks
- 修复 local entrypoint 未 wiring `backgroundTaskStoreFactory`、local runtime package 缺 background task store 和 unknown session background-tasks 处理。
- 修复 release package default agent root、runtime dependency staging、configured resource roots 和 skipped package startup validation。
- 修复 persistence provider shutdown 等待和 gateway store provider owner 拆分后的本地装配问题。

---

## 工程改进

### 架构与重构
- `agent-app` 继续瘦身为 composition root，残留 composition logic 下沉到各 owner，runtime node adapters 移出 app。
- Workflow visible delta projection 从 channel/common 收敛到 tool layer，并统一 tool timeline projection。
- SkillHub acquisition result contract 内部化，remote content source 通过 gateway normalize，减少跨 package public contract 泄漏。
- Gateway local persistence store provider 按 owner 拆分，shutdown 语义更明确。

### 测试与验证
- 新增或扩展 cron tool calling fixture、task-channel stream mapping、preferred skill timeout、unauthorized model hint、dev-workbench browser smoke tolerance 和 agent-core USER_CHECK 覆盖。
- 恢复 workflow 与 OpenSpec gates，补齐 release package startup validation 和 package runtime dependency 验证。
- 前端覆盖 AICOConfig、expand panel、process details、conversation/request store、background task panel、skill catalog 和 favorite/sidebar 行为。

### 文档
- 新增 `docs/apis/task-channel-api.md`，刷新 task-channel companion API 和 directive syntax。
- 新增 `docs/NextAgent测试特性树.md`、`docs/NextAgent对外特性介绍.md`。
- 更新 workflow gateway nodes、recipe classification、SkillHub source、Plugin/Skill metadata、release package 和架构设计相关 OpenSpec。

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 197 (130 non-merge) |
| 文件变更 | 622 |
| 代码新增 | +62,826 |
| 代码删除 | -10,039 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | SkillHub / Workflow / Task Channel / Background Tasks / agent-web / Packaging |
| 主要测试扩充 | Cron E2E fixture + Task Channel stream mapping + USER_CHECK + release package startup + frontend interaction tests |

---

## 升级指南

### 从 v2.1 升级

1. **Skill / Plugin / SkillHub 使用方**:
   - 检查 SkillHub install root、remote content source、localized source metadata 和 SkillMetadata 扩展字段是否符合当前配置。
   - 如果依赖 runtime-generated/acquired skill，验证 provider 投影、resource glob pattern 和 unauthorized model hint 行为。
   - 同步插件启动加载需要确认插件 artifact、SDK 包和 package staging 均已纳入运行包。

2. **Workflow / Recipe 使用方**:
   - 检查 recipe 是否放置在 runtime directory scanning 可发现路径，并验证 FIFO cache 与默认 provider 行为。
   - 若 recipe 使用 `inclusive-gateway`、USER_CHECK 或长 visible delta，重新验证 timeline event、answer 投影和终态消息长度。
   - retry/edit/recovery 场景需要确认 directive routing 是否仍基于原始用户输入。

3. **Task Channel / CLIP 集成方**:
   - 按 `docs/apis/task-channel-api.md` 更新 edit endpoint URL、header 命名、callback envelope 和 directive syntax。
   - 对异步 CLIP callback、`TOOL_STRUCTURED_DELTA` 和 status mapping 做回归。

4. **Cron / 后台任务 / 打包使用方**:
   - Cron tool 需要按 durable gateway-backed 行为验证 create/delete/list、trigger execution 和 callback scope。
   - 后台任务接口需确认 unknown session、no active session polling 和 natural completion silent 行为。
   - 本地运行包需要重新跑 startup validation，确认 background task store、default agent root 和 runtime dependencies 均被打包。

5. **agent-web 与外部配置使用方**:
   - AICOConfig 外部定制需要验证 host mode、PIU renderer、custom panel 和 display control。
   - 长会话、terminal stream、content snapshot、收藏粒度和非终态分享禁用状态需要重新走 UI 回归。

### 兼容性

- **Breaking Changes**: 未从本区间证据中识别到强制迁移级别的公开 breaking change；但 SkillHub source boundary、SkillMetadata、Task Channel edit endpoint、Workflow visible delta limit、favorites turn-level granularity 和 Cron tool 收敛存在行为变化，升级时应按上面的校验点回归。
- **Behavioral Changes**:
  - SkillHub remote content 通过 gateway 归一化，acquisition result contract 不作为外部 public shape 暴露。
  - Workflow 可见 delta 上限扩大，USER_CHECK、ANSWER 去重和 generatedMessages 投影更严格。
  - Task Channel edit endpoint 与 callback envelope 按新文档收敛。
  - Cron tool 进入 durable gateway-backed 路径，后台任务自然完成默认静默。
  - Favorites 从 session-level 收敛为 turn-level granularity。
  - 本地运行包打包范围按 configured resource roots 和 runtime dependencies 收窄。
- **Minimum Node.js**: 仍遵循仓库 Node.js LTS / `>=22.0.0` 要求。

---

## 已知限制

1. **SkillHub acquisition 仍依赖来源配置正确性**: 远端内容源、workspace root、resource glob 和 localized metadata 已收敛，但外部源认证、限流和 SLA 仍由接入方治理。
2. **Workflow 复杂交互仍需业务回归**: USER_CHECK、visible delta、inclusive-gateway 和 generatedMessages 已修复关键路径，但复杂 recipe 的容量和诊断策略仍需按实际运维流程压测。
3. **Cron 是 durable 工具能力，不是完整调度平台**: 当前重点是 gateway-backed trigger execution 和 callback scope，不替代跨租户调度治理、告警升级和容量编排系统。
4. **AICOConfig 外部定制需要配置治理**: Web 端具备外部定制入口，但 host mode、panel renderer 和 display control 的配置仍需由产品侧控制版本和兼容性。
5. **Dev Workbench 面向本地调试**: 它强化本地 Agent 运行诊断，不应被当作生产运维控制台或跨租户调试入口。

---

**下一步**: 后续版本可继续聚焦 Skill/Plugin 发布治理、Workflow 复杂交互诊断、Cron/后台任务容量与恢复、Task Channel 集成稳定性，以及 release qualification 证据的自动化沉淀。
