# fix-agent-web-collaborative-expand-panel-overlay

## Why

协作式宿主中，用户打开左侧扩展面板（例如记忆管理）后拖动右侧 PIU 对话面板的左边界时，外层 PIU 面板会变宽，但 `ChatPageCore` 内的对话内容仍被固定为 484px。用户看到的是对话内容整体左移并留下空白，而不是对话内容变宽；同时左侧扩展面板边界仍按固定值计算，布局语义不一致。

当前行为来自两个 owner 同时消费同一个扩展面板打开状态：PIU runtime 将扩展面板渲染为宿主级 overlay，而共享 Chat 布局仍按 local/immersive 的 flex sibling 规则约束对话内容。需要为 collaborative 模式定义明确的宽度分界和覆盖规则。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- collaborative 模式下，PIU 对话面板宽度不超过基准宽度时，左侧扩展面板与 PIU 对话面板共享整个视口宽度。
- PIU 对话面板宽度超过基准宽度时，PIU 对话面板覆盖在左侧扩展面板之上，左侧扩展面板保持基准边界，不被持续压缩变形。
- collaborative 模式下，PIU 对话内容占满当前 PIU 对话面板宽度，用户拖宽时看到内容实际变宽。
- local 与 immersive 模式下既有扩展面板 flex 布局保持不变。

**非目标：**

- 不改变扩展面板打开时的入口、内容、关闭和生命周期行为。
- 不改变 local 与 immersive 模式下对话面板 484px 的既有收缩规则。
- 不新增扩展面板拖拽或宽度持久化能力。
- 不改变 `AICOConfig.modalSize` 的解析规则。

## What Changes

- 修改 collaborative 模式扩展面板布局规则：
  - PIU 面板宽度小于或等于基准宽度时，扩展面板填充 PIU 面板左侧的剩余视口。
  - PIU 面板宽度大于基准宽度时，扩展面板保持基准边界，PIU 面板覆盖其上。
- 修改 collaborative 模式 PIU 对话内容布局规则：打开扩展面板时，共享 Chat 内容不再套用 local/immersive 的 484px 固定 flex 宽度，而是填满 PIU 面板。
- 基准宽度沿用扩展面板打开时的 PIU 面板默认宽度：`AICOConfig.modalSize.width`（有效数值）或 `DOCKED_DEFAULT_WIDTH`（484px）。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `agent-web-expand-panel` → `specs/agent-web-expand-panel/spec.md`
  - 功能边界：修改 collaborative 模式下扩展面板与 PIU 对话面板的宽度分界、覆盖顺序和 PIU 对话内容填充规则。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- actor：协作式宿主下使用记忆管理、收藏列表、投诉历史、定时任务等左侧扩展面板的用户。
- 前端：collaborative/PIU 扩展面板布局与共享 Chat 布局。
- 测试：PIU runtime 布局契约测试、ChatPage host-mode 布局测试和协作式浏览器旅程测试。
- 配置：继续使用既有 `AICOConfig.modalSize.width`，不新增配置项。
