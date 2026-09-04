# NextAgent 测试特性：对话交互

## 1. 基线与范围

| 项目 | 内容 |
|---|---|
| 核对日期 | 2026-08-13 |
| 代码基线 | `main@4f27c4a9fb` |
| 测试对象 | Agent Web 对话工作区 |
| 专题状态 | 可执行（第一批） |

本专题覆盖用户提交文本后的当次交互：请求开始、思考和工具过程、答案流式输出、请求终态、各类 Capability 成功结果的三档呈现、工具失败，以及 live 和 history 的差异。

本批不覆盖附件、取消/重试/编辑、Workflow 内部节点专项、PIU/Expand Panel、跨会话并发和权限管理。`AskUserQuestion` 只说明它在结果档位中的特殊显示规则，完整补充输入流程留到后续专题。

## 2. 测试准备原则

测试使用真实 fullstack 和当前 Agent 配置。测试人员通过受控 Skill、workspace 文件、RAG 知识条目、Cron 任务和 Workflow recipe 构造确定性场景，不以模型临场选择工具作为唯一前置条件。

一项场景数据应满足：

1. Skill 使用固定名称、固定输入和固定 Tool 调用顺序；
2. `allowed-tools` 只声明该用例需要的工具；
3. workspace、知识条目、任务和 recipe 使用测试专用标识，避免命中既有数据；
4. Skill 在任一步失败时停止，不用自然语言伪造后续成功；
5. 敏感值使用明显的 canary 字符串，测试界面和浏览器响应中均不可出现；
6. 每个档位使用同一份场景数据，只改变 `application.yaml` 的呈现规则并重启应用；
7. live 验证完成后刷新或重新进入会话，再验证 history。

### 2.1 场景 Skill 放置和绑定

测试 Skill 放在以下任一位置：

```text
<configRoot>/skills/<skill-name>/SKILL.md
<configRoot>/agents/<agentId>/skills/<skill-name>/SKILL.md
```

目录名必须与 frontmatter 的 `name` 一致，并在当前 Agent 的 `capabilityBindings` 中启用。基础模板：

```markdown
---
name: conversation-presentation-test
description: Execute deterministic tools for conversation presentation testing.
context: inline
user-invocable: true
model-invocable: true
allowed-tools: Read Glob Grep Write Edit Bash Python Rag ToolSearch TodoWrite Cron
metadata:
  version: "1.0.0"
  type: test-fixture
---

# Conversation Presentation Test

Only execute the scenario explicitly named by the user. Follow its fixed tool
order and fixed test data. Stop on the first failure and report only the safe
error code and failed step number.
```

实际执行时应按工具组拆成多个小 Skill，避免一个 Skill 获得不需要的工具权限。仓库已有场景样例可参考：

- workspace 工具链：`tests/e2e/fixtures/skills/workspace-tool-calling-load-test/SKILL.md`
- ToolSearch：`tests/e2e/fixtures/skills/tool-search-discovery-test/SKILL.md`
- TodoWrite：`tests/e2e/fixtures/skills/todo-write-test/SKILL.md`
- Cron：`tests/e2e/fixtures/skills/cron-tool-calling-test/SKILL.md`

这些文件是场景写法参考；测试环境仍需按自身 `configRoot` 和 Agent binding 安装对应 Skill。

## 3. 用户输入后系统如何呈现

一次标准成功交互按以下顺序呈现：

| 阶段 | 典型 event | 用户可见结果 | 断言 |
|---|---|---|---|
| 接收 | `REQUEST_ACCEPTED` | 用户消息进入当前轮次，执行状态开始 | 不能显示为已完成 |
| 思考 | `LLM_THINKING_DELTA` | 执行详情出现思考内容并随增量更新 | 与最终答案分区 |
| 工具开始 | `CAPABILITY_STARTED` | 对应能力名称和执行中状态 | 与同一调用的后续结果合并 |
| 工具结果 | `CAPABILITY_RESULT_DELTA` | 按有效档位显示状态、摘要或详情 | 不混入最终答案正文 |
| 工具结束 | `CAPABILITY_COMPLETED` | 同一步骤变为完成或失败 | 工具失败也使用该事件，没有 `CAPABILITY_FAILED` |
| 答案 | `LLM_CONTENT_DELTA` | 答案区域渐进显示文本或 Markdown | 过程与答案不重复 |
| 请求结束 | `REQUEST_COMPLETED` / `REQUEST_FAILED` | 本轮进入完成或失败状态 | 结束执行中状态，输入区恢复 |

`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` 已是当前终态类型，但不在第一批操作矩阵中。

## 4. 正常和请求失败流程

### 4.1 标准成功场景数据

准备 Skill `conversation-success-test`，固定执行：

```text
Read diagnostics/site-a/alarm.txt
→ Grep Alarm= diagnostics/site-a/alarm.txt
→ 输出固定结论“站点 A 告警数据检查完成”
```

文件内容：

```text
NE=LTE-eNodeB-001
Alarm=RRU_LINK_DEGRADED
Severity=minor
Action=pending
```

live 断言：

1. 用户问题先进入当前轮次；
2. 思考、`Read` 和 `Grep` 按执行顺序出现；
3. 工具结果只在执行详情中显示；
4. 最终答案在答案区域渐进出现；
5. 收到完成终态后不再显示执行中状态。

history 断言：

1. 刷新后用户问题、最终答案和已完成步骤仍存在；
2. 工具结果不丢失、不重复进入答案；
3. 页面直接显示稳定内容，不重播逐字增长和 live 动画；
4. 完整过程使用 history 返回的 envelope 重建，不依赖刷新前的浏览器内存。

### 4.2 请求失败场景数据

请求失败不能由 Skill 自行返回一段“失败了”的文字模拟。应通过测试模型 adapter 或集成测试 fixture 让当前请求产生受治理的模型失败，例如输出长度超限、provider 不可用或模型调用超时。

断言：

1. 请求先进入执行中状态，最终收敛为失败；
2. 界面显示本地化安全原因，不显示 provider 原始错误、prompt、凭据或内部路径；
3. 若失败前已有真实答案片段，片段可保留并与失败提示同时出现；没有答案时只显示失败提示；
4. 输入区在终态后恢复；
5. 刷新后仍为失败，不能回到执行中。

## 5. 成功结果三档配置

在部署方的 `application.yaml` 配置，不直接修改框架内置 `default-system.yaml`：

```yaml
nextAgent:
  system:
    capability-result-presentation:
      default-level: SUMMARY
      rules:
        - capability-id: Bash
          level: STATUS_ONLY
        - capability-id: Read
          level: DETAIL
        - capability-id: VendorNetworkProbe
          level: DETAIL
```

规则：

- 合法值只有 `STATUS_ONLY`、`SUMMARY`、`DETAIL`；
- `capability-id` 大小写敏感，按最终 Capability ID 精确匹配；
- 同一工具无论由模型、Skill 或 ToolSearch 激活，都按最终 ID 匹配；
- `rules` 最多 256 项，每个 ID 长度 1 至 128，不能重复；
- 重复 ID、空 ID、未知字段或非法档位会阻止应用进入 ready；
- 配置在启动期校验并冻结，修改后必须重启应用；
- 配置不能提高平台安全上限。没有受支持 projector 的能力即使请求 `DETAIL`，有效档位仍为 `STATUS_ONLY`。

### 5.1 三档通用规则

| 档位 | 显示 | 不显示 |
|---|---|---|
| `STATUS_ONLY` | 公开能力名称、执行中/完成状态；失败时仍显示安全失败事实 | 成功摘要、详情入口、`safeResult`、原始结果 |
| `SUMMARY` | `STATUS_ONLY` 内容，加有效且非通用的本地化安全摘要 | 详情正文、`safeResult`、原始结果 |
| `DETAIL` | `SUMMARY` 内容，加 projector 批准的有界详情和必要的展开入口 | 任意原始 JSON、未批准字段、超出容量边界的输出 |

没有有效摘要时省略摘要，不能用“暂无摘要”“结果已返回”“执行完成”等占位文字。没有有效详情时不能显示空展开入口。普通完成步骤默认收起，摘要不会成为收起步骤下方的常驻正文。

## 6. 各类工具在三档下的显示效果

### 6.1 文件和检索工具

| Tool | 默认档位 | `STATUS_ONLY` | `SUMMARY` | `DETAIL` | 场景数据 |
|---|---|---|---|---|---|
| `Read` | `SUMMARY` | 名称、状态 | 读取的安全显示路径 | 路径、读取范围、内容预览、是否截断/下一偏移 | 固定文本文件；另备超长文件 |
| `Glob` | `SUMMARY` | 名称、状态 | 匹配文件数量 | 最多 50 个安全路径及截断提示 | 生成多层目录和 51 个匹配文件 |
| `Grep` | `SUMMARY` | 名称、状态 | 匹配数、文件数及结果是否截断 | 文件模式显示安全路径；内容模式显示路径和行号，不显示匹配行正文 | 固定多个文件和确定行号 |
| `Write` | `SUMMARY` | 名称、状态 | 创建或更新的安全显示路径 | 仅显示安全路径，不显示写入正文 | 新文件用于 create；已有文件需先完整 `Read` |
| `Edit` | `SUMMARY` | 名称、状态 | 已更新的安全显示路径 | 仅显示安全路径，不显示 old/new 正文 | 先完整 `Read`，再替换固定字符串 |

推荐 Skill 顺序：

```text
Write 新文件 → Glob → Read 全文 → Edit → Grep
```

测试 `Read DETAIL` 时在文件中放置 `SECRET-FILE-CANARY-MUST-BE-BOUNDED`，只允许它按受控预览边界出现；宿主绝对路径、workspace root 和未读取区段不可出现。

### 6.2 命令、程序和知识检索工具

| Tool | 默认档位 | `STATUS_ONLY` | `SUMMARY` | `DETAIL` | 场景数据 |
|---|---|---|---|---|---|
| `Bash` | `DETAIL` | 名称、状态 | 成功时不显示“执行完成”类废话摘要；超时或非零退出可显示安全状态摘要 | exit code、stdout/stderr 有界预览、timeout、截断事实 | 分别构造空输出、短输出、长输出、非零退出、超时 |
| `Python` | `DETAIL` | 名称、状态 | 与 Bash 同形，但使用“程序”本地化文案 | 与 Bash 同一 `commandOutput` 详情结构 | 固定 Python 脚本覆盖五类结果 |
| `Rag` | `DETAIL` | 名称、状态 | 只显示召回数量 | 召回数量，加最多 50 项来源 basename 和内容预览；不显示 score/provenance | 测试索引中准备 3 条和 51 条确定知识条目 |

命令成功且 exit code 为 0、stdout/stderr 均为空时，即使默认 `DETAIL` 也只显示名称和完成状态，不显示空详情入口。命令正文、Python 源码、调用参数和脚本宿主路径不属于公开结果。

### 6.3 计划、发现和编排工具

| Tool | 默认档位 | `STATUS_ONLY` | `SUMMARY` | `DETAIL` | 场景数据 |
|---|---|---|---|---|---|
| `ToolSearch` | `SUMMARY` | 名称、状态 | 找到的 governed capability 数量 | 最多 50 个 capability 的名称、类型、ID、描述预览及截断提示 | 准备可 deferred discovery 的测试 Skill |
| `TodoWrite` | `DETAIL` | 名称、状态 | todo 数量或“列表已清空” | 最多 50 条 todo 的内容、active form 和状态 | 依次写入两条、替换为一条、全部完成后清空 |
| `Cron` | `DETAIL` | 名称、状态 | 创建/删除成功，或 list 数量 | create 显示任务 ID 和人类可读计划；delete 显示 ID；list 显示最多 50 个任务及截断提示 | 固定 cron、prompt，执行 create→list→delete→list |
| `Workflow` | `SUMMARY` | 名称、状态 | 普通终态不重复显示“Workflow 已完成”等状态摘要；流式 thinking/content 可显示对应安全摘要 | recipe 名称、状态和最多 10 段有界 answer preview | 固定 recipe 名称、状态和答案段 |

Workflow 内部节点和结构化过程属于后续专项；本表只覆盖普通 Capability 结果卡片。

### 6.4 交互、Skill、Agent、Memory 和扩展能力

| Capability | 默认档位 | 三档实际效果 | 场景数据 |
|---|---|---|---|
| `AskUserQuestion` | `DETAIL` | 问题和已接受答案属于补充输入公开事实；把普通结果规则收窄到 `STATUS_ONLY` 也不会隐藏已接受答案。其余附属结果仍受档位控制 | 固定单选确认问题并提交答案 |
| `Skill` | `STATUS_ONLY` | 当前没有成功结果 projector；配置 `SUMMARY/DETAIL` 仍只显示目标 Skill 身份和状态，不显示 Skill 正文或返回正文 | 绑定一个返回 canary 的测试 Skill |
| `Agent` | `STATUS_ONLY` | 当前没有成功结果 projector；三档有效效果均为身份和状态，不显示子 Agent 原始结果 | 绑定只读测试 Agent 并返回 canary |
| `ApiCall` | `STATUS_ONLY` | 防御性上限为 `STATUS_ONLY`，不公开响应正文 | 测试 adapter 返回固定 canary JSON |
| `search_memory` / `get_memory_detail` / `add_memory` | `STATUS_ONLY` | 当前没有成功 projector；不显示记忆正文、ID、分数或其他结果字段 | 使用隔离 owner scope 的测试记忆数据 |
| `acquire_skill` | `STATUS_ONLY` | 当前没有成功 projector；不显示 provider、安装目录或 SkillHub 原始结果 | 使用测试 Skill source |
| 未知扩展 Tool | `default-level` 请求值；安全上限通常为 `STATUS_ONLY` | 没有平台 projector 时，即使配置 `DETAIL` 也只显示身份和状态 | 自定义 Tool 返回 `SECRET-EXTENSION-CANARY` |
| 已识别 CLIP Tool | 未命中精确规则时使用 `default-level` | `SUMMARY` 不显示 event 正文；completion/result 只有存在安全 event count 时才显示数量摘要。`DETAIL` 只显示有界 stream event/result projector 内容 | 使用当前已注册的 CLIP 测试能力 |

### 6.5 各档位正常输出示例

以下示例以默认中文界面、未配置自定义 Capability 标题资源为前提。表中的“标题 + 已完成”表示步骤行显示该 Tool 的业务标题和完成状态；具体标题可能由集成方提供的 presentation resource 本地化，但结果内容不得因此变化。

同一个正常结果分别配置三个档位进行验证。普通完成步骤默认收起；“展开内容”只有在用户主动展开且该步骤存在有效详情入口时显示。

#### 文件工具示例

固定数据：

```text
diagnostics/site-a/alarm.txt
NE=LTE-eNodeB-001
Alarm=RRU_LINK_DEGRADED
Severity=minor
```

| Tool 与固定结果 | `STATUS_ONLY` 正常输出 | `SUMMARY` 正常输出 | `DETAIL` 正常输出 |
|---|---|---|---|
| `Read`：从第 1 行读取最多 10 行，未截断 | `Read` 标题 + 已完成 | 摘要：`已读取 diagnostics/site-a/alarm.txt，内容已返回。` | 与 SUMMARY 相同；可展开显示 `文件：diagnostics/site-a/alarm.txt`、`本次读取从第 1 行开始，最多包含 10 行。` 和三行内容预览 |
| `Glob`：匹配 `alarm.txt`、`kpi.txt` 两个文件 | `Glob` 标题 + 已完成 | 摘要：`找到 2 个匹配文件。` | 与 SUMMARY 相同；可展开显示两个安全相对路径，每行一个 |
| `Grep` content：1 条匹配，涉及 1 个文件，位置为 `alarm.txt:2` | `Grep` 标题 + 已完成 | 摘要：`找到 1 条匹配，涉及 1 个文件。` | 与 SUMMARY 相同；可展开显示 `diagnostics/site-a/alarm.txt:2`，不显示匹配行正文 |
| `Grep` files_with_matches：2 个匹配文件 | `Grep` 标题 + 已完成 | 摘要：`找到 2 个匹配文件。` | 与 SUMMARY 相同；可展开显示两个安全相对路径 |
| `Write`：创建 `diagnostics/site-a/result.txt` | `Write` 标题 + 已完成 | 摘要：`已创建 diagnostics/site-a/result.txt。` | 与 SUMMARY 相同；当前没有额外展开入口，不显示写入正文 |
| `Write`：更新已有 `result.txt` | `Write` 标题 + 已完成 | 摘要：`已更新 diagnostics/site-a/result.txt。` | 与 SUMMARY 相同；当前没有额外展开入口 |
| `Edit`：更新已有 `alarm.txt` | `Edit` 标题 + 已完成 | 摘要：`已更新 diagnostics/site-a/alarm.txt。` | 与 SUMMARY 相同；当前没有额外展开入口，不显示 old/new 字符串 |

截断变体：`Glob/Grep` 超过列表上限时，SUMMARY 摘要追加 `结果已截断`；DETAIL 的列表末尾也显示 `结果已截断`。`Read` 截断时，DETAIL 追加下一读取行或“只展示了部分内容”的说明，SUMMARY 不显示文件正文。

#### Bash、Python 与 RAG 示例

固定正常结果：Bash/Python 的 exit code 为 `0`、stdout 为 `Core-Router-01 latency=18ms`、stderr 为空；RAG 返回 2 条知识。

| Tool | `STATUS_ONLY` 正常输出 | `SUMMARY` 正常输出 | `DETAIL` 正常输出 |
|---|---|---|---|
| `Bash` | `Bash` 标题 + 已完成 | 与 STATUS_ONLY 相同；成功结果不显示“命令执行完成”占位摘要 | 与 STATUS_ONLY 相同；可展开显示 `退出码：0`、`输出：` 和 `Core-Router-01 latency=18ms` |
| `Python` | `Python` 标题 + 已完成 | 与 STATUS_ONLY 相同；成功结果不显示“程序执行完成”占位摘要 | 与 STATUS_ONLY 相同；可展开显示 `退出码：0`、`输出：` 和同一有界 stdout |
| `Rag` | `Rag` 标题 + 已完成 | 摘要：`已成功召回 2 条内容` | 与 SUMMARY 相同；可展开按顺序显示 `1. alarm-guide.md`、`2. handover-guide.md` 及各自有界内容预览 |

Bash/Python 空成功结果（exit code 为 0 且 stdout/stderr 均为空）在三个档位下都只显示标题和已完成，没有摘要和空展开入口。非零 exit code 属于命令结果变体，见 7.3 节，不要与 Capability 失败卡片混淆。

#### ToolSearch、TodoWrite、Cron 与 Workflow 示例

| Tool 与固定结果 | `STATUS_ONLY` 正常输出 | `SUMMARY` 正常输出 | `DETAIL` 正常输出 |
|---|---|---|---|
| `ToolSearch`：找到 2 个能力 | `ToolSearch` 标题 + 已完成 | 摘要：`找到 2 个可用能力` | 与 SUMMARY 相同；可展开逐项显示名称、`类型：TOOL/SKILL`、能力标识和有界说明 |
| `TodoWrite`：2 项任务 | `TodoWrite` 标题 + 已完成 | 摘要：`任务清单包含 2 项。` | 与 SUMMARY 相同；可展开显示 `1. [进行中] Inspect AMF alarm...`、active form，以及第 2 项的状态和内容 |
| `TodoWrite`：清空任务 | `TodoWrite` 标题 + 已完成 | 摘要：`任务清单已清空。` | 与 SUMMARY 相同；没有额外展开入口 |
| `Cron create`：ID `cron-test-01`，计划 `每天 03:17`，重复执行 | `Cron` 标题 + 已完成 | 摘要：`定时任务已创建。` | 与 SUMMARY 相同；可展开显示 `任务标识：cron-test-01`、`执行计划：每天 03:17`、`重复执行：是` |
| `Cron list`：返回 1 个任务 | `Cron` 标题 + 已完成 | 摘要：`找到 1 个定时任务。` | 与 SUMMARY 相同；可展开显示任务 ID、执行计划、Cron 表达式和是否重复 |
| `Cron delete`：删除 `cron-test-01` | `Cron` 标题 + 已完成 | 摘要：`定时任务已删除。` | 与 SUMMARY 相同；可展开显示 `任务标识：cron-test-01` |
| `Workflow` 终态：recipe `site-diagnosis`、状态 succeeded、一段 answer preview | `Workflow` 标题 + 已完成 | 与 STATUS_ONLY 相同；终态摘要不重复“工作流已完成” | 与 STATUS_ONLY 相同；存在 answer preview 时可展开显示有界预览正文，不显示 recipe 原始内部状态 |

Workflow 流式 `THINKING`/`CONTENT` 结果与普通终态不同：SUMMARY 可分别显示 `工作流正在生成思考过程。`、`工作流正在生成输出。`；DETAIL 才允许展开对应的有界文本。

#### AskUserQuestion、Skill、Agent、Memory 与扩展能力示例

| Capability 与固定结果 | `STATUS_ONLY` 正常输出 | `SUMMARY` 正常输出 | `DETAIL` 正常输出 |
|---|---|---|---|
| `AskUserQuestion`：用户选择“继续执行” | 问题交互和已接受答案仍显示；结果摘要为 `已收到补充信息。` | 与 STATUS_ONLY 相同 | 与 STATUS_ONLY 相同；不因 DETAIL 增加原始请求数据 |
| `Skill`：目标 `alarm-diagnosis-test` 成功 | 目标 Skill 身份 + 已完成 | 有效档位被安全上限收窄，输出与 STATUS_ONLY 相同 | 有效档位被安全上限收窄，输出与 STATUS_ONLY 相同；不显示 Skill 正文和返回正文 |
| `Agent`：目标 `readonly-network-agent` 成功 | 目标 Agent 身份 + 已完成 | 与 STATUS_ONLY 相同 | 与 STATUS_ONLY 相同；不显示子 Agent 原始结果 |
| `ApiCall`：返回 200 和 JSON | `ApiCall` 身份 + 已完成 | 与 STATUS_ONLY 相同 | 与 STATUS_ONLY 相同；不显示响应正文 |
| Memory Tool：检索到 3 条记忆 | 对应 Memory Tool 身份 + 已完成 | 与 STATUS_ONLY 相同 | 与 STATUS_ONLY 相同；不显示记忆正文、ID 或分数 |
| `acquire_skill`：成功获取测试 Skill | `acquire_skill` 身份 + 已完成 | 与 STATUS_ONLY 相同 | 与 STATUS_ONLY 相同；不显示 provider 或安装目录 |
| 未知扩展 Tool：返回 canary JSON | 扩展 Tool 身份 + 已完成 | 没有平台 projector 时收窄为 STATUS_ONLY | 没有平台 projector 时收窄为 STATUS_ONLY；canary JSON 不得进入浏览器 |
| 已识别 CLIP event：event type `DETAIL`、data preview `link=up` | CLIP Tool 身份 + 已完成 | 与 STATUS_ONLY 相同，不显示 event 正文 | 可展开显示有界 event type 和 `link=up` 预览 |

上述输出是正常成功路径。只要 Capability 状态为 `FAILED`，不得继续套用这些成功摘要和详情，统一按第 7 章显示安全失败事实。

## 7. 工具失败显示

### 7.1 所有档位共同规则

三档只控制成功结果。Capability 进入 `FAILED` 后，`STATUS_ONLY`、`SUMMARY`、`DETAIL` 必须显示相同的事实性安全原因：

1. 步骤标题和失败状态始终可见；
2. 主原因始终可见且只出现一次；
3. 已知 safe code 优先，其次按 safe category，最后使用通用失败说明；
4. 技术详情默认收起，只允许安全 code、category 和调用状态；
5. `DETAIL` 不会增加 raw exception、stack、命令、参数、文件正文或上游错误文案；
6. 失败后的重试、读取或恢复必须作为独立新步骤出现，不能写进旧失败卡片成为未发生的承诺；
7. history 中保持相同失败原因、技术详情和步骤顺序。

### 7.2 失败类型与界面效果

| 失败事实 | 典型 safe code/category | 主状态/原因效果 | 推荐构造方式 |
|---|---|---|---|
| 输入或 schema 非法 | `CAPABILITY_INPUT_INVALID` / `VALIDATION` | 无法运行；输入无效 | Skill 固定传入缺字段或非法枚举 |
| 未先完整读取 | `WRITE_REQUIRES_FULL_READ`、`EDIT_REQUIRES_FULL_READ` / `CONFLICT` | 未能完成；修改前需完整读取最新内容 | 对预置已有文件直接 Write/Edit，不先 Read |
| 读取后目标已变化 | `WRITE_TARGET_CHANGED`、`EDIT_TARGET_CHANGED` / `CONFLICT` | 未能完成；目标已变化 | 在 Read 与写入间由测试夹具修改文件 |
| 路径或命令被策略拒绝 | `CAPABILITY_PATH_REJECTED`、`COMMAND_NOT_ALLOWED` / `POLICY_DENIED` | 已阻止；策略不允许 | 使用越权逻辑路径或被拒绝命令 |
| 目标不存在 | category `NOT_FOUND` | 未找到 | Read 不存在的测试相对路径 |
| 平台不支持 | `PLATFORM_UNSUPPORTED` | 无法运行；当前平台不支持 | 在不支持的平台调用对应能力 |
| 依赖不可用 | `INTERPRETER_UNAVAILABLE`、`SANDBOX_UNAVAILABLE` / `UNAVAILABLE` | 暂不可用 | 注入不可用 sandbox/interpreter fixture |
| 超时 | category `TIMEOUT` | 已超时 | 测试 gateway 延迟超过受控 timeout |
| 结果过大 | `CAPABILITY_RESULT_LIMIT_EXCEEDED` | 结果不可显示；超过容量边界 | Tool 返回超过公开容量的结果 |
| 内部异常 | category `INTERNAL` | 系统错误 | 测试 adapter 抛出受控异常 |
| 未知失败 | 未知 code 且无已知 category | 未能完成；通用失败原因 | 自定义 Tool 返回未知 safe code，不带 raw message |

### 7.3 Bash/Python 的非零结果与 Capability 失败

需要分别覆盖两种情况：

- 命令确实执行并返回非零 exit code：这是受识别的 `commandOutput` 结果。`SUMMARY` 可显示命令/程序失败或超时摘要，`DETAIL` 可显示有界 stderr、exit code 和截断事实；
- Capability 在执行边界失败：使用上一节的统一安全失败卡片，三档显示同一原因，不把 stderr 或 raw exception 当作失败原因透传。

## 8. live 与 history 对照

| 观察点 | live | history/reload |
|---|---|---|
| 答案 | 随 delta 渐进增长，可显示流式视觉效果 | 直接显示稳定合并结果，不重播动画 |
| 思考/工具 | 执行中状态随 event 推进 | 重建为已持久化的最终过程状态 |
| 工具结果档位 | 使用请求启动期冻结策略生成的投影 | 使用已持久化投影，不按浏览器当前配置重新计算 |
| 请求终态 | 收到终态 event 后收敛 | 从 conversation/history 恢复为完成或失败 |
| 临时提示 | 可出现 live 专用提示 | `history-load` 不重放临时提示 |
| 完整过程 | 当前 event 与后续 history 可组合 | process history 可用时重建完整 envelope；旧数据不可用时显示明确状态 |

history 验证必须刷新或重新进入会话。不能只在同一页面等待终态后观察。

## 9. 第一批覆盖矩阵

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| CI-001 | 标准 Skill 成功流 | 接收→思考→工具→答案→完成顺序正确 |
| CI-002 | 成功流 history | 答案和工具结果不丢失、不重复、不重播 |
| CI-003 | 请求级失败 | 安全原因、失败终态、输入区恢复，history 一致 |
| CI-004 | 所有内置默认档位 | 与第 6 章默认列完全一致 |
| CI-005 | 每个有 projector 工具的 `STATUS_ONLY` | 无成功摘要、详情或 raw result |
| CI-006 | 每个有 projector 工具的 `SUMMARY` | 只有有效安全摘要，无 `safeResult` |
| CI-007 | 每个有 projector 工具的 `DETAIL` | 只有表中批准的有界详情 |
| CI-008 | 无 projector 能力请求 `DETAIL` | 有效结果仍为 `STATUS_ONLY` |
| CI-009 | 成功空结果 | 无占位摘要、无空详情入口 |
| CI-010 | 长列表/长文本 | 项数和文本受限，截断事实明确 |
| CI-011 | 工具失败跨三档 | 主原因和技术详情集合完全一致 |
| CI-012 | safe code/category/generic 优先级 | 已知 code 优先，未知 code 不泄漏上游文案 |
| CI-013 | 失败后继续执行 | 后续步骤独立呈现，无虚假恢复承诺 |
| CI-014 | 配置精确匹配 | 最终 Capability ID 大小写敏感且与调用来源无关 |
| CI-015 | 非法配置 | 应用不 ready，不接受测试请求 |
| CI-016 | live/history 档位一致 | 级别、失败事实、详情和顺序一致 |

## 10. 证据入口

- 配置 schema 和内置默认：`packages/agent-app/src/config/validation.ts`
- 部署方配置：`docs/developer/12-deployment.md`
- 后端安全 projector：`packages/agent-channel-common/src/projections/stream-envelope.ts`
- Web event 校验：`frontend/agent-web/src/features/chat/utils/streamValidation.ts`
- 过程和工具状态合并：`frontend/agent-web/src/features/chat/process/processDetails.ts`
- 摘要与失败本地化：`frontend/agent-web/src/features/chat/utils/safeSummaryPresentation.ts`
- 失败原因映射：`frontend/agent-web/src/features/chat/utils/failureDetails.ts`
- live/history 呈现：`frontend/agent-web/src/features/chat/components/TurnBlock.tsx`
- 三档投影测试：`packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`
- Web 过程测试：`frontend/agent-web/src/features/chat/process/processDetails.test.ts`

## 11. 当前限制与刷新触发

- 本文说明的是当前普通 Agent Web 投影，不把开发者诊断日志或原始 Tool 结果当作用户界面预期；
- 需要中途外部修改、依赖故障或 provider 故障的场景，应使用测试 gateway/adapter 构造，不能由 Skill 文案模拟；
- 第一批未覆盖的终态和交互不能按本文自行补充预期；
- Capability 默认档位、配置 schema、安全 projector、失败字段、stream/history 投影任一变化时，必须刷新本文。
