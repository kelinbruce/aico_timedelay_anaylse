## Why

用户当前查看 Grep 执行结果时，文件名搜索模式与内容搜索模式共用文件列表投影。内容模式即使已经找到匹配行，也可能显示为“找到 0 个文件”，而零结果又无法仅凭空 `filenames` 与空 `matches` 判定实际执行模式。

这会让电信运维人员误判配置、日志或脚本搜索是否执行成功，也使实时过程与刷新后的历史过程可能产生不一致解释。系统需要让 Grep 的 canonical result 自描述其实际模式，并由可信后端生成模式正确、容量有界且不泄漏匹配正文的用户可见结果。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Grep canonical result 必须显式携带实际 `output_mode`，包括零匹配结果，消费方不再从数组内容推断模式。
- `SUMMARY` 只显示模式正确的匹配数量；`DETAIL` 只增加有界的文件路径，内容模式还可增加行号，但不显示匹配行正文。
- 实时 stream 与刷新后的 run history 使用同一个可信后端投影；浏览器只解释闭合摘要语义，不读取原始结果补充详情。

**非目标：**

- 不改变 Grep 的匹配算法、排序、`max_results`、glob filter、大小写规则或默认搜索根。
- 不在本 change 披露搜索 pattern、glob filter、匹配行正文、文件正文、物理路径或调用参数；调用摘要和搜索规则帮助由独立 change 处理。
- 不新增独立调用卡片，不改变 Capability 结果呈现策略的三档模型，也不引入完全隐藏执行过程的 `HIDDEN` 策略。
- 不新增或修改搜索路径失败码、失败摘要语义，也不补齐其他 Tool 的 `safeResult`；这些能力由独立 change 处理。
- 不在群内确认完成前实施新的 Web `safeResult` 或 `safeSummaryCode`。

## What Changes

- **BREAKING**：Grep 成功结果新增必填 `output_mode`，值为 `files_with_matches` 或 `content`；缺少该 discriminator 的历史或扩展结果不得通过数组形状猜测模式。
- Grep 的 `SUMMARY` 投影按实际模式返回语言中立摘要：文件模式使用匹配文件总数，内容模式使用匹配总数与涉及文件总数；零匹配仍保留实际模式。
- Grep 的 `DETAIL` 投影在 `SUMMARY` 基础上返回至多 50 个安全条目：文件模式为 execution-view-relative 文件路径，内容模式为 execution-view-relative 文件路径与 1-based 行号；任何模式都不返回匹配行正文。
- 新增 Grep 专用安全结果 variant 与闭合集合摘要语义，使 local、immersive、collaborative 三种宿主对 live/history 使用同一结果解释。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.2 文件操作工具`：用户能够区分 Grep 文件模式、内容模式和合法零匹配，并获得自描述的搜索结果。
- `F-2.4 查看请求状态`：用户查看 Grep 过程时获得由可信后端生成、实时与历史一致的摘要或详情。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.4 搜索文件` → `specs/file-search-tools/spec.md`
  - 功能边界：Grep 成功结果显式携带实际模式，包括合法零匹配结果。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：`file-search-tools` 是前置 change `refine-ts-tool-default-root` 建立的 canonical spec；本 change 不再修改 legacy `grep-tool` 或 `glob-tool`。
- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：Grep 的 `SUMMARY` 和 `DETAIL` 由可信后端按实际模式生成有界安全投影，三种宿主及 live/history 使用同一解释。
  - 系统质量属性：安全、性能/容量、可测试性。
  - 映射说明：修改既有 canonical spec，不触及其他 legacy spec。

## 需群内确认

- **已确认**：新增公开 Web `safeResult.kind="grepResult"`，并采用 `files_with_matches` 与 `content` 两个严格 variants；该变化沿用既有 JSON envelope 字段，不新增 `agent-contracts` 顶层 DTO、event 或 export。
- **已确认**：新增 `CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES`、`CAPABILITY_RESULT_GREP_CONTENT_MATCHES` 及各自精确 `safeSummaryArgs` 白名单。
- **已确认且无需作为本次群内升级项**：Grep canonical result 新增必填 `output_mode`；实现若需要改动 `agent-contracts`，必须重新升级确认。

群内确认消息已通过；确认范围与 `ts-run-status-visibility` delta spec 的两个 variants、两个摘要码及精确 args 白名单一致。

## 影响范围（Impact）

- Agent 开发者和 first-party Tool consumer 必须接受 Grep 成功结果新增的必填 discriminator；旧结果缺失该字段时只能显示状态，不能猜测模式。
- Web stream/history 的公开安全投影会新增 Grep 专用 `safeResult` variant、摘要码及白名单参数；这些 public shape 已完成群内确认。
- 受影响实现集中在 Grep 输出 schema、Web 共享 projector、三种宿主共用的结果解释和本地化文案；不新增浏览器逐结果请求。
- 本 change 依赖 `refine-ts-tool-default-root` 先归档并冻结 `file-search-tools`；该依赖和公开契约确认均已满足。
