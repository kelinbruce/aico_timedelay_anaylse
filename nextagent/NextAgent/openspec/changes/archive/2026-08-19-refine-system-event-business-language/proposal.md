## Why

最终用户在普通 Agent Web 查看请求过程时，会看到“降级通知”“Hook 降级”“上下文压缩”等内部协议或实现术语。相同事件在折叠过程、完整运行图和实时提示中的标题、摘要与严重程度也不完全一致，用户难以判断它们表达的是已确认事实、技术诊断还是请求最终结果。

当前 Web stream 已为这些事件提供足够的安全事实。本变更现在需要统一用户可见表达，使过程提示陈述事实但不推断请求成功、失败、自动恢复或用户行动，同时保持实时执行与可重建历史的一致语义。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 普通 Agent Web 对 canonical `DEGRADATION_NOTICE`、canonical `CONTEXT_COMPACTED` 和前端兼容 `HOOK_DEGRADED` 使用集中、固定、本地化的业务标题与基础摘要。
- 折叠过程、完整运行图和实时上下文整理提示对同一事件使用一致语义与严重程度；`CONTEXT_COMPACTED` 表达信息提示，另外两类用同一运维任务未完整处理语义和警告视觉表达，且不得使用成功图标表示警告或信息。
- 任意事件 payload 文本不直接成为普通界面的标题、基础摘要或默认详情；`DEGRADATION_NOTICE` 的显式安全技术码只在用户主动展开技术详情时可见。
- canonical durable event 在实时执行和刷新后的历史中保持相同标题、基础摘要和严重程度；明确保留 transport failure notice 与短暂上下文整理动画的 live-only 边界。
- 三种 Agent Web 宿主和中英文界面使用同一呈现规则。

**非目标：**

- 不改变 stream event、timeline、request lifecycle、持久化、history 重建、顺序、事件数量、最终答复或公共 API。
- 不将 `HOOK_DEGRADED` 提升为 canonical stream event，也不新增其生产或历史重建路径。
- 不在系统事件提示中推断或重复请求终态；终态结果继续由既有终态呈现规则根据安全错误事实动态生成。本 change 不修改终态失败的事实原因、失败阶段、重试判断、行动指导或本地化文案。
- 不治理 `OUTPUT_GUARD_BLOCKED`、Pending Input、附件、后台任务、LLM 内容/思考、Capability 生命周期或 Workflow 内容的呈现；这些事件保留各自 owner，其中 `OUTPUT_GUARD_BLOCKED` 作为独立安全呈现问题后续处理。
- 不重构完整运行图的全局信息架构、原始事件诊断面或技术阶段分类。
- 不新增 AICOConfig 字段、per-event 显示级别、集成方文案覆盖或通用事件可见性策略。`DEGRADATION_NOTICE` 作为处理受限事实不得被产品配置整体隐藏；`CONTEXT_COMPACTED` 的可选隐藏仅作为未来独立 change 的候选，不在本 change 中预先实现；`HOOK_DEGRADED` 不成为产品配置身份。

## What Changes

- 修改普通 Agent Web 的系统过程提示：`DEGRADATION_NOTICE` 显示本次任务有部分内容未完成的事实，并引导用户查看执行详情和本次答复确认未完成内容；不承诺继续执行、成功、失败或恢复。
- 修改前端兼容提示：`HOOK_DEGRADED` 使用相同的任务未完整处理语义，不暴露 Hook 名称、标识或任意 payload 文本。
- 修改上下文整理提示：`CONTEXT_COMPACTED` 显示较早对话已整理的事实，严重程度为信息，不显示被整理内容。
- 修改三类事件的跨视图呈现规则，使折叠过程、完整运行图和 live-only 短暂提示复用同一业务语义；折叠过程复用既有 warning/info 状态体系，以橙黄色三角警告图标表示警告、以中性圆形信息图标表示信息；`DEGRADATION_NOTICE` 的显式安全技术码只作为默认收起的技术详情。
- 明确 live/history 边界：canonical durable `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED` 保持实时和历史语义一致；transport failure notice 与短暂上下文整理动画仅实时可见；`HOOK_DEGRADED` 仅作为前端兼容事件实时可见。
- 固定系统事件呈现的产品治理边界：宿主配置不能改写标题、摘要、严重程度或整体隐藏 `DEGRADATION_NOTICE`，且本 change 不建立通用系统事件显示策略。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：用户除可通过受治理业务标题识别 Capability 步骤外，还可用事实性业务语言理解三类系统过程提示，并依赖明确的实时/历史一致性与 live-only 边界；组成 Functions 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：增加普通 Agent Web 对三类系统过程事件的事实性业务呈现、严重程度、技术详情披露和实时/历史一致性规则；不改变事件事实、生命周期或公共契约。
  - 系统质量属性：安全、可靠性/恢复。
  - 映射说明：canonical spec；本 change 不触及 legacy spec。

## 影响范围（Impact）

- 最终用户：过程面板、完整运行图和短暂上下文整理提示中的系统术语被替换为业务语言；事件数量、顺序、最终结果以及请求下方既有终态失败总结不变。
- 平台集成方：无需调整 stream、history、AICOConfig 或公共 API；现有安全 payload 继续作为事实输入，未知系统事件显示配置不取得呈现控制权。
- 运维与诊断：普通界面不再直接显示任意事件文本；`DEGRADATION_NOTICE` 的显式安全技术码仍可在默认收起的技术详情中查看，受控原始诊断边界不变。
- 代码与验证：影响 Agent Web 的过程呈现、完整运行图、短暂提示、本地化资源及对应单元测试、多宿主构建和浏览器旅程；后端 packages 不受影响。
