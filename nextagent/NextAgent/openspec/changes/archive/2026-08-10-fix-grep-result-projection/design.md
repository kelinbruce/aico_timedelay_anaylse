## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.4 搜索文件` | Grep canonical result 自描述实际模式，包括合法零匹配结果 | `file-search-tools` | `FN-5.4 搜索文件` |
| `FN-2.4 查看请求状态` | Grep 的摘要与详情由可信后端生成模式正确的有界安全投影 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-5.4 搜索文件`

### 目标与规范依据

本 Function 负责建立唯一可信的 Grep 成功结果模式；下游只消费该事实，不重新解释搜索输入。

#### 本 Function 的目标 Requirements

canonical spec：`file-search-tools`

- `ADDED`：`Grep 成功结果显式携带实际输出模式`

前置 change `refine-ts-tool-default-root` 已建立并归档该 canonical spec。本 change 在其归档后实施，不与其他 active change 并行修改同一实现与规格落点。

### 当前实现

- `workspace-file-port.ts` 已把输入 `output_mode` 规范化为 `files_with_matches | content`，并据此分别填充 `filenames` 或 `matches`。
- Grep 返回对象当前只含 `filenames`、`matches`、`total_files_with_matches`、`total_matches` 与 `truncated`；`grepOutputSchema` 的 required 集合也没有 `output_mode`。零结果因此不能自描述实际模式。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Grep 每个成功结果显式携带实际模式 | 模式只存在于执行函数局部变量和调用输入 | canonical result 与 output schema 缺少必填 discriminator |
| 模式专属数组形状不可矛盾 | executor 当前按模式生成数组，但 schema 没有表达模式与数组的一致性 | output validation 无法拒绝缺失模式或矛盾形状 |

### 修改方案

`agent-capability` 继续拥有 Grep canonical result。唯一实施路径如下：

1. 在 Grep executor 的成功返回对象加入局部已规范化值 `output_mode: outputMode`。同步更新 `grepOutputSchema`：将 `output_mode` 加入 required 与 enum，并用 `oneOf` 或等价 schema 约束模式专属数组。输入 schema 的 default 保持不变，结果字段本身不设置 default。
2. 所有直接构造 Grep fixture 或 mock result 的测试同步加入 `output_mode`。不对旧持久化事实做数据迁移；历史兼容由 `FN-2.4` 的 fail-closed 投影处理。

这一路径不改变搜索遍历、排序、容量预算、匹配行生成、sandbox、Gateway 或 runtime lifecycle。`output_mode` 由 executor 的可信规范化结果产生，不从模型返回后的任意 payload 或浏览器补写。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由功能性 Requirement 派生 | `output_mode` 只由 executor 的可信规范化结果产生 | 浏览器或扩展 consumer 不能覆盖或猜测模式 |
| 可维护性 | 无新增黑盒质量目标；由功能性 Requirement 派生 | Grep result 只使用一个模式 discriminator | 不出现第二套模式字段或消费方模式推断 |
| 可测试性 | 无新增黑盒质量目标；由功能性 Requirement 派生 | output schema 与 producer contract 同步收紧 | 两种模式、默认模式、零匹配和矛盾 shape 均有 contract 测试 |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本 Function 负责把 `FN-5.4` 产生的可信事实投影为三种宿主、live/history 一致的安全摘要或详情；公共 Web shape 只由本 spec 定义。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`Grep 结果按实际模式生成有界安全投影`

### 当前实现

- `agent-channel-common` 的共享 projector 对 `Glob` 与 `Grep` 都调用 `projectFileListSafeResult`，只读取 `filenames` 与 `truncated`，并以投影后文件数组长度生成 `fileList`、`totalCount` 和 `CAPABILITY_RESULT_FILE_LIST`。
- 因为内容模式的 `filenames=[]`，当前投影会忽略 `matches` 与两个 canonical totals，并生成“0 个匹配文件”语义。
- 共享 projector 已具备呈现级别裁剪、`safeSummaryCode/safeSummaryArgs` 生成、live/history 复用、50 条结果预览上限和安全路径规范化能力。
- `frontend/agent-web` 已只根据闭合摘要码解释本地化摘要，并按 `safeResult.kind` 解析详情；现有 `fileList` variant 同时服务 Glob 与 Grep，无法表达内容匹配位置。
- public envelope 使用既有 JSON payload 承载 `safeResult` 与摘要字段，本次不需要新增 `agent-contracts` 顶层字段或 stream event；但新增 variant、code 和 args 是间接公共 Web contract 变化。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Grep 摘要按实际模式使用 canonical totals | Grep 复用基于返回文件数组长度的 Glob projector | 缺少 Grep 专用 schema 校验、summary code 和 args |
| DETAIL 只显示有界路径与行号 | 现有 `fileList` 只能显示文件名，内容结果仍含不应公开的 matched line | 缺少 `grepResult` discriminated union 与 matched-line 删除边界 |
| 旧结果或非法形状安全降级 | 共享 projector 会把存在 `filenames` 的旧结果当文件列表 | 缺少对必填 `output_mode` 的 fail-closed gate |
| 三宿主及 live/history 一致 | 已共享后端 envelope 与前端解释路径 | 新 variant 必须接入同一链路，不创建宿主分支或逐结果请求 |

### 修改方案

`agent-channel-common` 继续作为用户可见 Capability 结果的可信投影 owner，`frontend/agent-web` 只做闭合 shape 校验、本地化和渲染。唯一实施路径如下：

1. 保留 Glob 的 `projectFileListSafeResult`。为 `capabilityId="Grep"` 增加专用 projector，先校验 `output_mode`、模式专属数组、canonical totals 与 `truncated`，再生成 spec 定义的 summary descriptor 与 `grepResult` safe variant。
2. `SUMMARY` 直接使用 canonical `total_files_with_matches`、`total_matches`，不以已投影数组长度代替总数。`DETAIL` 沿用共享 50 条上限和安全逻辑路径校验；内容模式只映射 `file_path -> filePath` 与 `line_number -> lineNumber`，主动丢弃 `line`。
3. 缺失 `output_mode`、未知模式、矛盾数组、非法计数或任一将进入详情的路径/行号未通过 schema 时，专用 projector 返回 undefined，使既有平台安全上限路径降为 `STATUS_ONLY`。不得为旧历史结果增加形状推断兼容分支。
4. `frontend/agent-web` 增加两个成功摘要码及 `grepResult` 严格 parser/renderer。parser 要求 exact keys、非负计数、最多 50 个条目、安全路径和 1-based 行号。
5. local、immersive、collaborative 继续复用同一 chat workspace 和 projection utilities；run history 继续消费与 live 相同的 envelope shape。不得新增结果详情 endpoint、浏览器 raw-result lookup 或宿主特有分支。

`safeResult` 字段级公共 schema 以 `ts-run-status-visibility` delta spec 为唯一权威，本 design 不创建平行类型定义。TypeScript 的前端 union 只是对该公共 contract 的本地严格解析，不成为第二套语义来源。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Grep 结果按实际模式生成有界安全投影` | producer schema gate、allowlist mapping、matched-line 删除、非法 shape fail closed | 原始 line、pattern、glob filter、物理路径与参数不进入 envelope 或 UI |
| 性能/容量 | `Grep 结果按实际模式生成有界安全投影` | 复用单次 projector 与 50 条内存内裁剪，不增加网络请求 | 500 条 canonical result 仍只输出 50 条详情且零逐结果请求 |
| 可测试性 | 无新增黑盒质量目标；由目标 Requirement 派生 | 后端投影 contract 与前端 strict parser 分层覆盖 | live/history、三宿主、模式矩阵及非法 shape 均可重复验证 |

## 跨 Function 协作与端到端流程

1. `FN-5.4` 在既有 Capability 执行边界生成带显式 `output_mode` 的成功结果。
2. runtime 与 channel 继续通过既有 canonical Capability result 事实传递，不新增事件类型或持久化事实。
3. `FN-2.4` 的共享 projector 校验 canonical result，生成唯一安全 Web 投影并应用有效呈现级别。
4. 三种宿主通过同一前端 parser 和本地化映射显示摘要或详情；浏览器不反向读取 `FN-5.4` 的原始输入或输出。

实施依赖是顺序关系：先冻结并实现 `FN-5.4` producer contract，再实现 `FN-2.4` consumer projection。各层测试文件可以在公共 schema 群内确认后并行编写，但 consumer 实现不能先于 producer contract 独立落地。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-5.4 / Grep 成功结果显式携带实际输出模式`、`FN-2.4 / Grep 结果按实际模式生成有界安全投影` | producer 提供可信 discriminator，projector 只做白名单映射，浏览器只解释安全投影 | 从 Tool result 到三宿主 UI 断言 matched line、调用参数和物理路径均不泄漏 |
| 可测试性 | 两个 Functions 的全部目标 Requirements | producer contract、共享 projector contract、前端 parser/i18n 和宿主旅程分层验证同一事实 | 以文件模式、内容模式、零匹配和非法历史 shape 形成端到端矩阵 |

## 验证策略（Verification Strategy）

- `agent-capability` unit/contract tests 覆盖两种 Grep 模式、默认模式、零匹配、必填 `output_mode` 和互斥数组。
- `agent-channel-common` projector tests 覆盖两个 summary code/args、两种 detail variant、50 条上限、canonical totals、line 删除以及旧结果/矛盾 shape 降为 `STATUS_ONLY`。
- `frontend/agent-web` unit tests 覆盖 strict parser、本地化摘要、文件与位置详情以及未知/非法 shape 安全降级；三宿主共用组件由现有宿主一致性测试验证。
- Web channel contract/integration tests 用同一事实比较 live 与 history envelope，不增加逐结果网络调用。若现有 e2e fixture 覆盖 Grep 过程卡片，则补一条内容模式详情旅程；否则以共享 projection integration test 加人工界面检查作为本 change 的最小浏览器证据。
- architecture review 确认没有新增 `agent-contracts` 顶层事件字段、浏览器 raw-result owner、宿主分支、Gateway/persistence 变化或搜索失败语义。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/file-search-tools/spec.md`：在前置 change 归档后合并 Grep 输出模式 Requirement。
- `openspec/specs/ts-run-status-visibility/spec.md`：合并 Grep 安全投影 Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.4-搜索文件.md`：刷新输出、结果、规格与 canonical spec 导航。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：刷新 Grep 结果类别、详情容量和安全降级解释。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.2-文件操作工具.md`：刷新用户可依赖的 Grep 模式区分能力与 spec 导航。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：刷新 Grep 过程结果的安全可见性。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：在既有 Web 安全 Capability 结果投影设计中补充 Grep variant 与 producer discriminator；若现有主题已由 `ts-run-status-visibility` Function 设计充分导航，则无独立 architecture 新文档。
- `openspec/designs/modules/agent-capability.md`：补充 Grep canonical output discriminator。
- `openspec/designs/modules/agent-channel-common.md`、`openspec/designs/modules/agent-web.md`：补充 Grep 专用安全投影与浏览器解释边界；若仓库使用其他现有 module 文件名，归档时合并到对应既有文档，不新建平行 module。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：把两个 stable specs 导航到上述 Function、module 与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 旧历史 Grep 结果缺少 `output_mode` 时只显示状态，短期信息量低于基于数组猜测的兼容方案；该取舍换取零结果与内容模式不被错误解释，并避免永久保留启发式分支。
- `output_mode` 是 Grep 成功结果的 breaking contract，仓库内 fixture、mock 和扩展 consumer 必须同步更新；通过 output schema、workspace 全量搜索和 contract tests 控制遗漏。
- 详情统一最多 50 条，可能少于 canonical result；`truncated` 合并表达搜索侧或投影侧省略，避免新增第二个截断字段，但用户不能区分省略发生在哪一层。

## 迁移与回滚（Migration / Rollback）

实施前提是 `refine-ts-tool-default-root` 完成归档，且公开 Web shape 完成群内确认。发布顺序为 producer schema/result 与 channel/frontend consumer 在同一兼容发布中交付；不得先发布要求 `output_mode` 的 projector 而 producer 尚未提供该字段。

回滚触发条件是新 schema 导致 first-party Grep 成功路径失败，或 Web contract tests 发现敏感字段泄漏。回滚必须同时撤回 producer 的 required schema、专用 projector 和前端新 variant，恢复发布前行为；已经持久化且含 `output_mode` 的 JSON 结果因旧 schema `additionalProperties=false` 可能无法被旧 consumer 接受，因此生产回滚前必须先验证 history projector 对新增字段的行为。若不能证明安全兼容，则采用修复前滚，不执行部分回滚。

## 已确认事项

- 群内已接受 `ts-run-status-visibility` 定义的 `kind="grepResult"` 两个公开 `safeResult` variants、两个成功 `safeSummaryCode` 及其精确 args 白名单。
- `refine-ts-tool-default-root` 已归档并冻结 `file-search-tools`，前置依赖已满足。
- `output_mode` 作为 Grep canonical result 必填字段已获当前变更决策确认，不属于待确认项；若实施需要修改 `agent-contracts` 顶层 DTO、event 或 export，而不是沿用既有 JSON payload，则必须新增独立群内确认项并暂停实施。
