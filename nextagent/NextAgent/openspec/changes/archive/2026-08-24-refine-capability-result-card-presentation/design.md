## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | 调整内置结果默认档位，收紧有效摘要语义，并让已有 typed safe result 在现有步骤内友好呈现 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本设计让用户在既有执行详情中看到更少的占位文字，并可按默认策略展开 Bash、Python 与 RAG 已批准的安全结果。实现不新增结果字段，不改变平台安全上限，不改变模型上下文、runtime lifecycle、持久化 owner 或既有 disclosure 操作习惯。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `MODIFIED`：`Capability 结果呈现策略受平台安全上限约束`
- `MODIFIED`：`Capability 业务呈现必须与结果显示策略正交`
- `MODIFIED`：`RAG 检索结果具有可展示的安全摘要`
- `ADDED`：`已有 typed safe result 必须使用本地化结构呈现`

### 当前实现

1. `agent-app` 在 `builtInCapabilityResultPresentationLevels` 中把 `Rag`、`Bash`、`Python` 设为 `SUMMARY`；配置 schema 和冻结策略已经完整支持三档与 exact override。
2. `agent-channel-common` 已为 Bash/Python 生成 `commandOutput` safe result，为 RAG 生成 `ragRetrieval` safe result。命令 stdout/stderr 预览和 RAG 来源/内容预览已有专项白名单、schema 与容量边界。
3. RAG projector 当前把同一个 `ragRetrieval` 对象同时作为 `safeResult` 和 `summarySafeResult`，因此 `SUMMARY` 与 `DETAIL` 携带相同列表详情。
4. Agent Web 的 `describeCommandOutputSafeResult` 会生成“命令/程序执行完成，返回了输出”等摘要；Workflow formatter 会把完成状态再写成 summary；CLIP summary code 包含“收到事件”“结果已返回”等通用事实。
5. `describeGenericToolResult` 在没有受信 presenter 时仍尝试解析 text JSON；`buildProcessDisplayEntries` 在缺摘要时调用 `summarizeToolRawDetail`，截取详情首句、匹配领域关键词或输出“工具输出已生成”。
6. 后端已经生成 `ToolSearch` 和 `Cron` typed safe result，但前端 closed `SafeCapabilityResult` union 和 formatter 没有对应 kind，只能退化为通用文本。TodoWrite 专用 formatter 仍硬编码英文空列表、更新数量和状态标签。
7. `ProcessPanel` 与 `useProcessEntryDisclosure` 已拥有两级折叠、运行中自动展开、settled 后收起和手动 override；无需新增组件或 disclosure 状态。
8. stable structured output 规格与当前 canonical completion 仲裁存在独立漂移，但该问题已经由 #742 跟踪，本 change 不改变仲裁 owner。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Bash、Python、Rag 默认 DETAIL | 三者默认 SUMMARY | 配置基线和配置测试需要同步调整 |
| RAG SUMMARY 只含数量，DETAIL 才含来源预览 | 两档复用同一 `ragRetrieval` safe result | 后端需要停止向 SUMMARY 附加 `summarySafeResult` |
| 无有效摘要只显示标题状态 | command/workflow/CLIP formatter 与 raw fallback 会制造重复或占位摘要 | 需要统一删除无效成功摘要和 raw/JSON 浏览器推导路径 |
| ToolSearch、Cron 使用 typed 结构；TodoWrite 完整 i18n | 两类 safe result 未被前端 reader 识别，Todo 状态硬编码英文 | 需要扩展现有 closed reader/formatter 与 i18n 资源 |
| 既有 disclosure 行为不变 | 当前 disclosure 已满足目标 | 只需避免因 summary/detail 变化创建空展开入口，不改状态机和组件结构 |

### 修改方案

唯一实施路径是继续复用“应用启动期三档配置 → shared channel safe projection → Agent Web typed safe-result presenter → 现有 ProcessPanel”的链路，只做以下最小增量：

1. **配置基线**：在 `agent-app` 的内置表中把 `Rag`、`Bash`、`Python` 改为 `DETAIL`，同步配置单测。`default-level`、exact override、校验 schema 和 ready gate 不变。
2. **RAG 三档裁剪**：保留 `projectRagRetrievalSafeResult` 生成的现有 `safeResult`，停止把它复制到 `summarySafeResult`。summary descriptor 继续使用既有 `CAPABILITY_RESULT_RAG_RETRIEVAL { totalCount }`。DETAIL 的字段、50 项、来源 basename 与 40/100 code point 规则逐值保持。
3. **摘要价值判定**：后端仍生成语言中立 descriptor；前端 presenter 对已确认无独立价值的 command/program 成功、Workflow outer 状态和 CLIP event/completion 占位摘要返回空 summary。失败摘要不受影响。不得通过 string heuristic 扩大允许集合。
4. **封闭普通结果回退**：ordinary Capability result 没有 recognized safe result 或有效 safe descriptor 时，`describeGenericToolResult` 返回无正文的 lifecycle presentation；删除 `parseJsonRecord(text)` 和 `summarizeToolRawDetail` 对 ordinary Tool success 的摘要生成作用。产品显式 structured TEXT/PIU/DSL 继续走原有 structured renderer，不经过该 fallback。
5. **补现有 typed reader**：在 `SafeCapabilityResult` closed union 中增加后端已存在的 `toolSearch` 与 `cron` variants，并沿用 exact-key、type/range 校验和 fail-closed reader 风格。formatter 只使用后端已有字段，不新增容量边界。
6. **本地化 presenter**：给 ToolSearch、Cron、TodoWrite 增加中英文 i18n key。Todo content、activeForm、tool description、cron 表达等业务值逐值保持；只本地化平台标签与状态。
7. **disclosure 保持**：不修改 `ProcessPanel` 或 `useProcessEntryDisclosure` 的 open state。formatter 仅当 typed safe result 具有真实详情项或既有截断事实时设为 expandable；空成功只保留标题状态。

本 change 不处理 #742 的 structured/canonical arbitration；测试必须固定本次修改不会扩大或改写现有仲裁。它也不处理 #741、#681、#743–#748，代码中不得加入对应 future type、配置、helper 或占位分支。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `RAG 检索结果具有可展示的安全摘要` | 继续由 shared channel projector 唯一生成字段；SUMMARY 删除详情而不是浏览器隐藏；前端 raw/JSON fallback fail closed | SUMMARY payload 无 `safeResult`；DETAIL 字段和既有边界不扩大；unknown/invalid 不泄漏 |
| 可维护性 | 无新增黑盒质量目标 | closed safe-result reader 与专用 formatter 使用现有单一分派，不新增平行 presentation contract | backend kind 与 frontend reader 一一对应；i18n 无硬编码状态 |
| 可测试性 | 无新增黑盒质量目标 | 配置、projector、reader/formatter、ProcessPanel 行为分别在现有测试层验证 | 三档矩阵、空结果、非法 shape、中英文、live/history fixture |

## 验证策略（Verification Strategy）

- **unit/contract**：验证内置配置表、exact override、RAG SUMMARY/DETAIL 字段差异、Bash/Python DETAIL 既有字段、unknown/invalid fail closed。
- **frontend unit**：验证 ToolSearch/Cron exact parser、TodoWrite i18n、无效摘要省略、raw/JSON 不生成摘要，以及空详情不产生展开入口。
- **integration/characterization**：复用 shared stream/history projection fixtures，验证 live 与 history 形成相同安全字段和显示结果；确认既有 structured presentation 行为未被本 change 改写。
- **frontend build 与三宿主回归**：验证 local、immersive、collaborative 共用同一 presentation path；不新增宿主特判。
- **negative case**：覆盖 raw command/code/args、绝对路径、RAG 原始字段、非法 safeResult、unknown kind、占位 summary 和技术 JSON，确保均不进入普通 Web 正文。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：更新内置默认表、RAG SUMMARY/DETAIL、有效摘要和 typed safe-result 呈现规则。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：更新描述、处理过程、结果和 Capability 结果呈现级别规格行。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：提炼“更少占位摘要、默认可展开既有安全详情”的用户价值，不改变 Function 组成。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`、`openspec/designs/architecture/configuration-boundary.md`：更新默认基线与 RAG summary/detail 裁剪说明。
- `openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-web.md`：更新配置默认值、shared projector 与 typed presenter 的长期说明。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-run-status-visibility` 的默认表、RAG 三档与无效摘要说明。

## 风险与取舍（Risks / Trade-offs）

- 默认 DETAIL 会让用户主动展开后看到比以前更多的已有安全输出。通过保持步骤终态默认收起、保留 exact override 和不展示调用参数控制影响。
- 删除 raw/JSON 摘要 fallback 可能使某些 legacy/未知 Tool 只剩标题状态。这是有意的 fail-closed 结果；扩展 Tool 通用 DETAIL 由 #746 在安全规格完成后处理。
- Workflow outer summary 省略后，用户主要依靠 outer 标题状态和 inner product；其安全 answer preview 仍可在 DETAIL 下作为现有 fallback，当前 change 不改变 inner product 与 terminal answer。
- 本期不修复 #742 的 arbitration 漂移，因此某些同时产生 structured output 和 canonical completion 的场景仍可能存在既有问题；通过独立 Issue 保持 owner 和验收边界清晰。

## 待确认问题（Open Questions）

无。本 change 不修改 `agent-contracts`、Gateway、事件 vocabulary 或持久化 owner，不需要新增群内契约确认。#741、#742、#743、#744、#745、#746、#747、#748 的未决架构事项均不进入本 change 的 tasks。
