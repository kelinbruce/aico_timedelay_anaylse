## 背景与问题（Why）

`frontend/agent-web` 已经形成完整的会话、Composer、附件、运行过程、内容渲染和恢复体验，但一部分用户可观察行为只存在于代码与测试中；另一些行为曾由已归档 change 定义，却没有进入当前 Stable specs。与此同时，少量 Stable specs 仍保留已经被当前实现淘汰或替代的承诺，例如 `/clear`、raw tool command/result、API Key 配置和模型选择 UI。

这造成三类真实问题：

- 当前实现缺少可审查、可演进的长期行为契约。
- archive 历史、当前 Stable 基线与实际实现之间存在断裂。
- `openspec validate` 可以证明文档结构合法，却不能单独发现语义冲突和过期承诺。

本 change 以当前产品代码和可重复测试为事实源，在 **change-local delta specs** 中反向补齐或修订前端相关契约，不设计新的产品行为，也不在 archive 前直接写入 `openspec/specs/`。当前代码中已有的 edit durable visibility replacement 作为既有事实被规格化；本轮反向规格与文档收口不再修改生产代码，也不改变其他未归档 change 的语义。初始 apply 阶段未修改长期文档；后续经用户分轮授权，title/Web API、前端状态/导航/owner 和 Baseline Promotion Plan 明列的长期 module/architecture/map 已全部同步；共同复核的 Markdown rendering 与 Pending Input change 仅刷新验证证据。当前 frontend build、全量 frontend suite、OpenSpec strict 和 architecture lint 门禁均已恢复；剩余工作是在用户授权后执行普通 archive，并由 archive 应用 delta 时更新 Stable spec/overview。

## 变更范围（What Changes）

- 为当前 Composer 键盘交互、命令目录、编辑态和公开快捷键定义增量契约；通用 route-scoped 草稿生命周期归并到既有 `ts-run-status-visibility` owner，edit 入口与恢复细节继续由 `request-edit-resubmit` 拥有。
- 为浏览器附件选择、拖放、队列、批次校验、重复反馈、移除和提交后清理定义增量契约；不重复定义服务端 attachment intake。
- 为普通用户侧 Turn Run Graph 的入口、图构造、详情投影、live/history 连续性、窄屏等价形态和焦点恢复定义增量契约；不把任意纯文本详情宣称为完整 safe projection。
- 为 Mermaid 完整 fence 检测、懒渲染、stale result 隔离、失败降级和 viewport 通知定义增量契约；strict 配置与有限 cleanup 仅记录为 Implementation-only/Known divergence，不形成 sanitization 承诺。
- 按当前实现重新定义会话标题自动生成和手动更新语义。
- 完整定义 edit-resubmit 的 runtime、Web 和前端可观察语义，包括 latest target、lane replacement、源请求消息持久隐藏、本地 optimistic presentation、internal attachment authority、当前 Web text-only 限制、幂等、失败和草稿恢复。
- 明确欢迎页高频问题只回填 Composer、不自动提交。
- 修订 Skill 选择栏默认入口、始终可用的“全部”入口和当前目录 Modal 文案/样式契约，纠正 Stable 内部矛盾和已过期行为。
- 修订现有 E2E UI、auth control 和 architecture test gate 契约，移除或纠正与当前实现不一致的承诺；在既有 Session Management UI owner 中补齐新会话 pre-session、首次普通提交先建立会话、失败保留输入和已有会话不重复创建的边界。
- 如实登记但不稳定化以下产品现状：ProcessPanel argument/raw/plain compatibility fallback、Mermaid cleanup 不完整、title update key 缺少 durable replay anchor、edit latest preflight 非原子以及 edit locale/whitespace 校验缺口。当前产品代码已移除 raw stream debug buffer；Stable background-task contract 明确允许 seed-only `commandLine`，二者均不再登记为本 baseline 的 Known divergence。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-web-composer-interaction`：Composer 键盘、命令、历史召回与公开快捷键。
- `agent-web-attachment-composer`：浏览器附件选择、队列、校验、移除和提交清理。
- `agent-web-turn-run-graph`：普通用户侧运行过程图、详情投影、响应式与连续性语义。
- `agent-web-mermaid-rendering`：完整 fence、lazy/stale、失败降级和 viewport 通知；不拥有 SVG sanitization 保证。
- `session-title-generation`：ordinary submit acceptance 后的异步标题尝试、runtime-instance 去重、确定性提取、覆盖保护和非阻塞失败。
- `session-title-update`：owner+agent scoped 手动标题更新、trim 后 1–100 字符非空校验、unsafe-content 拒绝和 `titleSource=manual` 语义。
- `request-edit-resubmit`：latest-request 编辑重提、lane replacement、源请求消息 refresh-stable replacement、本地 optimistic presentation、internal attachment revalidation、当前 Web text-only 限制、幂等和前端恢复语义。

### 修改 Capability

- `agent-web-high-frequency-questions`：增加欢迎页问题点击只回填 Composer 的要求。
- `skill-selector-ui`：纠正默认 Skill 入口、“全部”按钮显示条件及当前 Skill 目录 Modal 标题/样式语义。
- `e2e-ui-interaction`：将 SSE-only 描述修正为后端选择的 SSE/WebSocket 等价 transport，按当前受支持安全投影的选择优先级收窄 Capability result 投影，把缺少安全字段时的 compatibility fallback 保留为 Implementation-only/Known divergence，移除不存在的 API Key/模型选择 UI 承诺，并按已交付行为明确根路由首次普通提交的会话建立顺序与失败边界。
- `agent-web-auth-control`：修正 local/remote ops 语义、ChatPage 等价读取以及当前已接入 Write gate 的 surface；记录 host-specific 尚未接入入口。
- `ts-architecture-test-gate`：删除具体 test id、具体 storage key 和已知失败形态等伪稳定细节，保留可观察行为门禁。
- `ts-run-status-visibility`：在既有前端本地视图状态 owner 中补齐 root-route 草稿、route 隔离、存储降级和普通提交成功/失败语义，不重复 edit-resubmit 的入口特有行为。

## 影响范围（Impact）

- OpenSpec：当前仅新增一个未归档 change 及其中 13 个 capability delta；不直接创建或修改 Stable specs。
- 代码与依赖：本轮反向规格与文档收口不修改生产 TypeScript、CSS、构建配置或依赖，不引入新运行时行为；delta 只固化当前代码中已经存在的行为，并复用或补充 characterization tests 作为证据。
- 长期文档：已同步 `runtime-boundaries.md`、`core-contracts.md`、`agent-session.md`、`agent-runtime.md`、`agent-channel-web.md`、`agent-platform-gateway-local.md`、`agent-web.md`、`web-channel-api-surface.md`、`spec-to-design-map.md`、API 清单和前端长期说明；只覆盖 Baseline Promotion Plan 明列的 title/edit/Composer/附件/Run Graph/有限 Mermaid/根路由会话建立/导航事实。
- 验证：复用现有单元、组件、contract 和 architecture tests，并补充根路由 route-state characterization tests 作为事实证据；执行 change strict validation、全量 strict validation、workspace boundary review 和独立语义 review。

## 生命周期边界

本 change 目前保持 **active / unarchived**：

- 初始 apply 阶段只维护本目录下的 proposal、design、tasks 和 delta specs；后续分轮授权已完成 title/Web API、前端状态/导航/owner 说明及剩余长期设计 promotion。
- 不在 apply 阶段手工把 delta 复制到 `openspec/specs/`。
- 不在用户未授权归档时运行任何 archive 命令。
- 当前 Baseline Promotion Plan 的长期设计同步、frontend package build、定向测试、全量 frontend suite、OpenSpec strict 和 architecture lint 均已通过；本 change 仅因尚未获得 archive 授权并执行普通 archive 而继续保持 Active。
- 用户授权后使用普通 `openspec archive establish-agent-web-existing-behavior-baseline` 让 OpenSpec 正常应用 delta；不得使用 `--skip-specs` 绕开标准生命周期。

## 归档前更新基线（Baseline Promotion Plan）

长期 module、architecture、开发者文档和 spec-to-design map 已按下列计划同步。当前仍保持 Active：不提前修改 `openspec/specs/` 或把 `openspec/overview.md` 写成已归档的 Stable 状态。

### 行为契约

- 通过普通 archive 将七个新增 capability delta 生成到对应 Stable specs。
- 通过普通 archive 将 `agent-web-high-frequency-questions`、`skill-selector-ui`、`e2e-ui-interaction`、`agent-web-auth-control`、`ts-architecture-test-gate`、`ts-run-status-visibility` delta 合并到现有 Stable specs。

### 已同步的长期说明与设计

- `docs/apis/agent-web-api-list.md`：补齐手工标题的 raw Web body 上限、session-owner trim、1–100 字符非空校验、manual source 和安全错误语义。
- `openspec/designs/architecture/web-channel-api-surface.md`：修正 bootstrap、submit、SSE/WS 路径，并补充 title、edit、pending-input answer 入口。
- `openspec/designs/architecture/runtime-boundaries.md`：修正 ordinary submit acceptance 后、session 未 resolved 前可重试的非阻塞 title 回调边界。
- `openspec/designs/modules/agent-session.md`：修正 automatic/manual title owner、校验和覆盖保护语义。
- `docs/frontend/README.md`、`docs/frontend/user-workflows.md`：登记本 baseline 的 Composer、附件、title、edit、HFQ、Turn Run Graph、有限 Mermaid 和根路由首次普通提交会话建立行为，并把 AICO、structured delta、Expand Panel、turn-granularity favorite list 恢复为 Stable。
- `frontend/agent-web/ARCHITECTURE.md`：同步当前 package 的 Stable/Active/Implementation-only owner 表，不复制 API schema 或把 active delta 提前稳定化。
- `docs/frontend/development.md`、`frontend/agent-web/README.md`、`docs/NextAgent测试特性树.md`：把 API 清单导航更新到 `docs/apis/agent-web-api-list.md`。

### 已同步的长期模块与导航

- `openspec/designs/architecture/core-contracts.md`：已补充 title/edit 的长期 contract 导航，不复制 UI 行为。
- `openspec/designs/modules/agent-runtime.md`、`agent-channel-web.md`：已分别同步 edit replacement owner 和 Web projection 事实。
- `openspec/designs/modules/agent-platform-gateway-local.md`：已同步 existing-session title write 的当前持久化语义及不具备 durable title-update replay anchor 的限制。
- `openspec/designs/modules/agent-web.md`：已合并本 baseline 对 Composer、附件、Turn Run Graph、有限 Mermaid、title/edit UI 边界的最小长期事实，未重复已经归档的 AICO、structured delta 或 Expand Panel 设计。
- `openspec/designs/spec-to-design-map.md`：已增加新增 capability 导航、补充当前 background-task-control，并修正不存在或已 superseded 的旧链接。
- `openspec/overview.md`：当前继续把本 change 的前端基线与完整 edit 用户控制保持在 Stable 范围外；普通 archive 应用 delta 时，将已验证的 latest-question text-only edit-resubmit 加入稳定基线，并把范围外表述收窄为任意历史消息编辑、browser attachment edit 和批量编辑等未稳定能力。
- ADR：无；本 change 不引入新技术决策或 owner 迁移。

## 验证入口

- `frontend/agent-web/tests/` 中 Composer、attachment、Skill selector、Run Graph、Mermaid、stream transport、session service 和 route-state 测试。
- `packages/agent-session/tests/`、`packages/agent-runtime/tests/`、`packages/agent-channel-web/tests/` 和 `tests/agent-kernel/` 中 title/edit contract 与 characterization tests。
- `openspec validate establish-agent-web-existing-behavior-baseline --strict`。
- `openspec validate --all --strict`。
- 文档语义 review：逐条确认规范性行为有当前代码或测试证据，并且未修改其他 active change 的 ownership。
