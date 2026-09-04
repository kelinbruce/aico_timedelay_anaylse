# fix-agent-web-collaborative-expand-panel-overlay Design

## 设计范围（Scope）

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `agent-web-expand-panel` | 定义 collaborative 模式下 PIU 面板与左侧扩展面板的宽度分界、覆盖顺序和 PIU 对话内容填充规则 | `specs/agent-web-expand-panel/spec.md` | [agent-web-expand-panel](#agent-web-expand-panel) |

## agent-web-expand-panel

### 目标与规范依据

Collaborative 模式需要避免左侧扩展面板随 PIU 面板拖宽而持续压缩变形，同时保证 PIU 面板拖宽后对话内容真实变宽。PIU 面板不超过基准宽度时，两个面板共享视口；超过基准宽度后，PIU 面板覆盖扩展面板。

本 Function 的目标 Requirements：

- Canonical spec：`agent-web-expand-panel`
- `MODIFIED Collaborative 模式下的扩展面板布局`

### 当前实现

- `AIAgentPiuRuntime` 在扩展面板打开时将 PIU 面板强制切换为 docked-right，并把宽度重置为 `AICOConfig.modalSize.width` 或 `DOCKED_DEFAULT_WIDTH`。
- 左侧扩展面板由 `AIAgentPiuRuntime` 渲染为 fixed overlay，右边界固定使用基准宽度。
- `ChatPageCore` 只要看到扩展面板打开，就把对话内容 pane 固定为 `flex: 0 0 484px`。该规则适用于所有 host mode。
- PIU 面板 z-index 高于左侧扩展面板，当前已经具备覆盖的层级条件。

### GAP 分析

- PIU 面板被拖宽后，左侧扩展面板右边界仍固定为基准宽度，外层 PIU 面板可覆盖它，但扩展面板边界计算与目标规则一致。
- PIU 模式下扩展面板不是 `ChatPageCore` 的 flex sibling；`ChatPageCore` 仍套用 local/immersive 的 484px 固定宽度，导致外层 PIU 面板变宽时内容不跟随变宽。
- 因此用户看到对话内容整体左移并留下空白，而不是内容变宽。

### 修改方案

- 在 `AIAgentPiuRuntime` 中继续以 `AICOConfig.modalSize.width` 的有效数值或 `DOCKED_DEFAULT_WIDTH` 计算基准宽度。
- 扩展面板右边界使用 `min(当前 docked PIU 面板宽度, 基准宽度)`：
  - PIU 面板宽度不超过基准宽度时，扩展面板填充 PIU 面板左侧剩余视口。
  - PIU 面板宽度超过基准宽度时，扩展面板保持基准边界。
- 保留既有 PIU 面板与扩展面板层级关系，让更宽的 PIU 面板覆盖扩展面板。
- `ChatPageCore` 仅在 local/immersive host 下套用扩展面板打开时的 484px 固定对话 pane 宽度；PIU host 下保持 `flex: 1 1 auto`，使对话内容填满 PIU 面板。
- 不新增状态、不改变扩展面板打开/关闭生命周期、不改变 local/immersive 布局。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | 无新增黑盒质量目标（本次依据为功能性 Requirement） | host mode 决定扩展面板布局归属，避免 PIU 外层布局与共享 Chat 内层布局重复约束 | 覆盖 local/immersive/PIU 三种 host 的布局 characterization |
| 可测试性 | 无新增黑盒质量目标（本次依据为功能性 Requirement） | 布局边界由基准宽度与当前 PIU 面板宽度直接计算，无隐藏状态 | 断言基准宽度内、基准宽度外和 PIU 内容填充三类边界 |

## 验证策略（Verification Strategy）

- Unit/contract characterization：
  - 断言 PIU 面板在基准宽度内共享视口，超过基准宽度后扩展面板保持基准边界。
  - 断言 PIU host 下对话 pane 填满面板，local host 下保持 484px 既有规则。
- E2E：
  - 在 collaborative 浏览器旅程中打开记忆管理，拖宽 PIU 面板，断言对话内容变宽且左侧扩展面板宽度保持不变。
- Regression：
  - 运行既有 PIU runtime 与 ChatPage 布局相关测试，确认 local/immersive 行为不变。
- 构建验证：
  - 运行前端 TypeScript build 和多宿主 Vite build。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-expand-panel/spec.md`：修改 `Collaborative 模式下的扩展面板布局` Requirement。
- `openspec/designs/functions/`：无独立 Function 文档，无需更新。
- `openspec/designs/features/`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/agent-web-host-modes.md`：归档时补充 collaborative 扩展面板宽度分界与覆盖规则。
- `openspec/designs/modules/agent-web.md`：归档时同步前端多宿主布局边界说明。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- PIU 面板超过基准宽度后覆盖左侧扩展面板，左侧扩展面板中被覆盖内容不可见。该取舍用于防止扩展面板被持续压缩变形；关闭扩展面板或收窄 PIU 面板后恢复共享视口布局。
- `AICOConfig.modalSize.width` 影响基准宽度。若集成方配置更大的默认宽度，覆盖阈值随之变大；这保持配置语义与现有 PIU 面板默认宽度一致。

## 待确认问题（Open Questions）

无。
