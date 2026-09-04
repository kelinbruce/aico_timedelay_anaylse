## 背景与问题（Why）

当前主干已经具备统一的 live/history 过程投影、活动条目判定、条目级自动展开与收起、面板级终态收起、用户手动覆盖和 reduced-motion 处理。复杂任务持续执行时，过程面板仍缺少清晰的“当前执行到哪里”提示：活动条目与其他条目视觉接近，新条目首次出现缺少轻量反馈；当活动内容持续增长时，界面也没有把过程活动变化明确接入既有的视口跟随策略。

体验验证还发现，既有条目完成后延迟收起会与下一条目持续增高和聊天视口跟随同时发生，使用户已经转移到下一步骤或最终答案的视觉焦点再次跳动；完成面板重新打开时默认展开全部 detail，也会在长流程中造成大幅页面增高。

这些问题不改变执行事实，但会增加用户监控长任务、判断任务是否仍在推进以及定位当前步骤的认知成本。本 change 仅改善共享 Web 过程面板的视觉与交互呈现，不拥有模型输出分类、过程内容持久化或业务集成披露策略。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- live 过程面板中的当前活动条目具有清晰、可访问且不依赖动画的静态状态提示，并在允许动态效果时通过主题感知的柔和外圈呼吸增强活动辨识度。
- live 运行期间首次出现的新过程条目具有轻量进入反馈；历史加载、已稳定面板重新打开时不重放该反馈。
- 当聊天视口正在跟随底部时，活动条目新增或内容增高继续保持可见；用户主动离开底部后不被强制拉回，并可通过既有入口恢复跟随。
- 自动管理的完成条目、后续活动条目和已完成答案之间形成稳定的视觉交接。
- 当公开助手文字开始输出时，此前仍由系统自动展开的过程步骤立即收起 detail，但过程面板继续保留，避免上一过程内容与当前输出同时争夺视觉焦点。
- 用户手工展开或收起过程条目后，该手工状态在当前 run 内优先于后续自动交接。
- 成功完成面板重新打开时默认先展示折叠的步骤目录，而不是展开全部 detail。
- local、immersive、collaborative 三种宿主复用同一组件和交互语义。
- reduced-motion 用户获得等价状态信息且不执行非必要位移动画。

**非目标：**

- 不改变过程 Event 或 Message 的生成、持久化、恢复、关联和模型上下文语义。
- 不定义用途未定模型文字、阶段说明和最终答案的分类协议；本 change 只消费既有 Turn 终态、可见答案 presentation 及其与过程条目的既有顺序。
- 不新增 timeline event type、`SessionMessage` role、Web DTO、persistence store、配置项或公共契约。
- 不新增 ProcessPanel 私有的滚动权威、视口状态或恢复按钮，不使用元素级强制聚焦替代聊天视口控制器。
- 不实现通用助手长答案折叠。Pending Input 生命周期或契约、非 `QUESTION` pending kind 的过程展示、Workflow 和通用 Tool Presentation Policy 仍不在范围内。
- 不替换、重绘或重新解释既有 Think、Skill/Tool、过程完成、最终完成和子标题图标。
- 不要求重新制作低保真视觉稿；实现使用现有主题 token、运动时长和可访问性约定。

## 变更范围（What Changes）

- 修改 live `ProcessPanel` 的过程条目呈现：当前活动且未稳定的条目 MUST 具有主题一致的固定节点强调、标题层级和可访问状态语义；允许动态效果时节点 wrapper MUST 使用不改变布局的柔和外圈呼吸增强活动辨识度，深色主题 MUST 降低光晕范围，`prefers-reduced-motion: reduce` MUST 退化为静态强调；同时 MUST 保留既有图标资产、选择规则和明暗主题语义。
- 修改 live `ProcessPanel` 的条目首次出现行为：运行期间新挂载的过程条目 MUST 执行一次 200ms 的轻量淡入与短距离进入反馈；初始历史 hydration、已稳定内容重建、面板重新打开和 reduced-motion 模式 MUST 不执行该动效。
- 修改活动内容与聊天视口的协作行为：过程面板 MUST 仅在既有聊天视口处于跟随底部状态时请求保持底部可见；用户暂停跟随后 MUST 保持阅读位置。
- 修改自动 disclosure 的交接时序：未被用户手工覆盖的完成条目 MUST 直接呈现收起状态；用户手工状态 MUST 在当前 run 内优先。
- 修改公开文字与步骤 detail 的交接：运行中出现顺序晚于当前过程步骤的可见助手文字时，MUST 只收起此前由系统自动展开的步骤 detail，不得据此收起整个过程面板或判断该文字是阶段说明还是最终答案；后续过程活动必须继续按既有规则显示。
- 修改已完成答案与过程面板的交接：在 Turn 已成功完成且已有可见答案、视口仍跟随底部、没有手工展开条目且不存在未解决的 canonical `QUESTION` 补充信息时，执行详情 MUST 在该完成态提交中收束为摘要行；用户已经离开底部时 MUST 保留当前过程布局。
- 修改完成后重新打开行为：成功 run 的面板 MUST 默认显示全部步骤标题且全部自动管理 detail 收起；系统自动收束的失败场景 MUST 恢复步骤目录且不重复 Turn 级失败提示，用户手工收起仍优先；未解决的 `QUESTION` 补充信息 MUST 保留待处理 detail。
- 增加覆盖活动提示、首次进入、跟随暂停与恢复、历史不重放、reduced-motion、焦点稳定 disclosure 和三宿主一致性的前端验证。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `agent-web-process-panel`：增加 live 活动状态提示、一次性新条目进入反馈、焦点稳定 disclosure，以及与聊天视口跟随策略的协作行为。

## 影响范围（Impact）

- 代码：仅修改 `frontend/agent-web` 共享 chat workspace 中的 ProcessPanel、TurnBlock、presentation view state 及对应测试和 mock fixture。
- API 与契约：无。
- 依赖与配置：不新增依赖和配置项。
- 测试：ProcessPanel component/integration tests（包括 PIU 结构化 detail 的 disclosure 可用性，但不锁定挂载策略）、chat viewport browser journey、三宿主模式和 reduced-motion 验证。
- 运维：无部署、数据迁移或观测契约变化。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-process-panel/spec.md`：合并本 change 的活动提示、进入反馈、视口跟随、焦点稳定 disclosure 和重开目录增量需求。
- `openspec/designs/modules/agent-web.md`：补充 ProcessPanel 活动呈现与 chat viewport controller 的职责协作。
- 其余长期架构、ADR、feature 和 function 文档：无。

长期基线更新由归档流程执行，不是实施阶段任务。
