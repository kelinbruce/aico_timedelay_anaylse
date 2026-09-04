## Why

网络运维用户通过执行详情判断系统正在读取、检索、执行还是编排任务。当前部分成功步骤只显示“命令执行完成，返回了输出”“工作流执行完成”“结果已返回”等重复标题和状态的文字，既不能帮助用户理解业务结果，又会增加过程噪声。部分详情虽然已经由平台生成安全结构，界面仍退化为通用文本或英文状态；在缺少可信摘要时，浏览器还可能根据详情或 JSON 自行猜测摘要。

与此同时，`Bash`、`Python` 和 `Rag` 已有可直接复用的有界安全详情，但默认仍停留在 `SUMMARY`。调测产品需要额外配置才能看到既有执行结果，且 RAG 当前把来源和内容预览放在 `SUMMARY`，使摘要与详情语义重叠。本次需要在不新增披露字段、不改变安全边界的前提下，让默认执行过程更有信息量、更少废话，并让已批准的安全详情使用一致、友好的现有卡片呈现。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 成功步骤只有在存在独立、非空且有业务价值的摘要时才显示摘要；无效占位、重复状态和浏览器猜测摘要全部省略。
- `Bash`、`Python` 和 `Rag` 默认使用 `DETAIL`，用户主动展开现有步骤时可查看它们已有的安全详情；命令、代码、脚本名和调用参数继续不可见。
- RAG 的 `SUMMARY` 只表达召回数量；当前来源标签与单行内容预览只属于 `DETAIL`。
- `ToolSearch`、`Cron` 和 `TodoWrite` 使用当前语言友好呈现已有 typed safe result，不退化为混乱的通用文本或英文状态。
- 收起、展开、运行中自动展开和完成后收起的既有操作习惯保持不变；摘要不会被强制常驻在收起条目下方。

**非目标：**

- 不新增通用递归脱敏、深度、字段数、数组项、文本长度或总容量规格；该架构评审由 #741 跟踪。
- 不新增调用参数投影；安全调用参数继续由 #681 跟踪。
- 不为 `Agent`、Memory Tool、`acquire_skill` 或未知扩展 Tool 新增成功结果 projector；分别由 #743、#744、#745、#746 跟踪。
- 不新增用户可见 `HIDDEN`，不改变 `ApiCall` 答案 owner，也不修改产品显式 PIU/Workflow 与普通 completion 的仲裁；分别由 #747、#748、#742 跟踪。
- 不新增前端面板、事件类型、Gateway 契约、Message/timeline owner 或模型上下文字段。
- 不改变 `Skill`、`Agent`、`ApiCall`、Memory Tool、`acquire_skill` 和未知扩展 Tool 的现有平台安全上限。

## What Changes

- 内置结果呈现基线把 `Bash`、`Python` 和 `Rag` 从 `SUMMARY` 改为 `DETAIL`；集成方仍可用既有精确规则收窄，且配置仍不能突破平台安全上限。
- RAG `SUMMARY` 只返回召回数量的语言中立摘要，不返回 `safeResult`、来源标签或内容预览；RAG `DETAIL` 继续复用当前已批准的来源、预览与既有截断规则。
- `Bash`、`Python`、`Workflow` 和 CLIP 的成功摘要若只重复“已完成”“返回了输出”“收到事件”或“结果已返回”，则不再显示；DETAIL 展开区直接呈现已有安全结果。
- `ToolSearch` 与 `Cron` 的既有 typed safe result 使用专用本地化结构呈现；`TodoWrite` 的列表状态和空列表文案完整使用当前界面语言。
- 普通 Capability 结果只使用可信后端提供且前端已识别的 `safeSummaryCode/safeSummaryArgs` 或 typed `safeResult`；兼容 `safeSummary` 可以继续留在传输对象中，但不得单独成为浏览器展示依据。前端不再从 raw detail、JSON 或关键词生成成功摘要。
- 既有过程面板和条目 disclosure 语义保持不变；无有效摘要或详情的成功步骤只显示标题与状态，不显示空展开入口或占位正文。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：用户在现有执行详情中看到更少的占位文字，并可按默认策略展开查看 Bash、Python 与 RAG 已批准的安全结果；Function 组成不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：调整内置结果呈现默认值、RAG 三档字段边界和已有安全结果的用户可见表达；不改变 runtime Capability 执行、模型上下文或安全投影白名单。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：`ts-run-status-visibility` 是 canonical spec；本次不触及其他 legacy spec。

## 影响范围（Impact）

- 产品未配置精确覆盖时，`Bash`、`Python` 和 `Rag` 的默认有效级别将变为 `DETAIL`，但仍只显示各自既有安全字段与截断结果。
- 已显式配置这些 Tool 的集成不受默认值变化影响。
- local、immersive、collaborative 三种宿主及 live/history 使用同一后端策略和同一前端 presenter。
- 受影响实现集中在应用配置基线、共享 Capability 结果投影和 Agent Web 的 typed safe-result presentation；配置 schema、runtime、Gateway、Plugin SDK 和持久化契约不变。
