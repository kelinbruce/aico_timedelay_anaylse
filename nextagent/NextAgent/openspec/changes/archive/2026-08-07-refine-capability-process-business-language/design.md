## 设计范围

| Function | 本次目标变化 | delta spec |
|---|---|---|
| `FN-2.4 查看请求状态` | Capability 过程使用最小公开身份和前端集中映射生成业务标题；过程结构与结果披露范围不变 | `ts-run-status-visibility` |

## `FN-2.4 查看请求状态`

### 第一性原理与不变量

真实问题是用户先看到实现标识，而不是系统缺少一套后端多语言名称服务。完成交付所需的最小事实只有两类：执行了哪个 Capability，以及通用执行入口本次选择了哪个目标能力。

因此本 change 固定以下不变量：

- 后端发布执行身份事实；前端拥有标题模板、本地化资源和业务名称映射。
- 执行入口身份由 `capabilityKind + capabilityId` 表达；`capabilityId` 不因展示需求改变既有执行、关联和审计语义。
- `Agent`、`Skill`、`Workflow` 通用入口只使用一个可选 `targetCapabilityId` 表示具体目标；该名称复用现有 routing contract 的目标能力标识词汇，不公开入口专属字段，不新增 `targetCapability` 对象。
- `targetCapabilityId` 的目标类型由执行入口确定：`Agent → AGENT`、`Skill → SKILL`、`Workflow → WORKFLOW`，不再增加 `targetCapabilityKind`。
- started 与 completed 携带同一身份；result delta 通过 `toolCallId` 关联，不重复新增身份字段。
- 不投影完整 Capability arguments，不从结果、描述、模型文本或浏览器状态猜测目标身份。
- 前端只有一个名称解析入口；平台和集成产品不得建立第二套标题配置。
- 业务标题适配不得改变条目数量、顺序、合并、层级、折叠、展开条件、动画和最终答案。
- 名称映射与 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 正交，不提高任何结果披露级别。

### 当前实现基线

#### 事件与投影链路

- `agent-core/src/tools/tool-loop.ts` 已在普通 Tool 执行前掌握最终 `CapabilityDescriptor`、`effectiveArguments` 和 `toolCallId`，并产生 started/completed lifecycle event。
- `Agent`、`Skill`、`Workflow` 都是 `kind=TOOL` 的通用执行入口；其执行参数分别使用 `agentId`、`name`、`recipeName` 指定具体目标。
- Tool loop 已产生 Workflow 外层 wrapper lifecycle，`WorkflowRuntimeEventProjector` 产生其内部节点 lifecycle，并通过父子身份保持层级；本 change 不增加或删除这些既有过程条目。
- `WorkflowRuntimeEventProjector` 已为 Workflow 节点产生 lifecycle event，但公开 payload 尚未形成统一 `capabilityKind`。Tool、Skill、Agent、Subflow 节点已有受治理节点类型和目标输入。
- `agent-runtime` 持久化 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED`；`CAPABILITY_RESULT_DELTA` 默认 live-only。
- `agent-channel-common/src/projections/stream-envelope.ts` 是 SSE、WebSocket 和 run-event history 的共享安全 projector。
- `frontend/agent-web/src/features/chat/process/processDetails.ts` 按 `toolCallId` 聚合 lifecycle event，当前标题最终回退到 `payload.capabilityId`，并在部分无摘要成功结果上生成占位文案。
- `CapabilityResultPresentationPolicy` 已按 `capabilityId` 配置 `STATUS_ONLY`、`SUMMARY`、`DETAIL`，与过程标题独立。

#### 当前公开身份差异

| 场景 | 当前执行入口 | 当前目标来源 | 目标公开身份 |
|---|---|---|---|
| 普通 Tool | descriptor `kind + capabilityId` | 无 | `capabilityKind + capabilityId` |
| Agent wrapper | `TOOL + Agent` | `effectiveArguments.agentId` | `targetCapabilityId`，目标 kind 推导为 `AGENT` |
| Skill wrapper | `TOOL + Skill` | `effectiveArguments.name` | `targetCapabilityId`，目标 kind 推导为 `SKILL` |
| Workflow wrapper | `TOOL + Workflow` | `effectiveArguments.recipeName` | 既有 wrapper lifecycle 使用 `targetCapabilityId`；本 change 不新增事件 |
| Workflow Tool 节点 | 节点 `tool_name` | 无 | `TOOL + tool_name` |
| Workflow Skill 节点 | 节点 `skill_name` | 无 | `SKILL + skill_name` |
| Workflow Agent 节点 | 节点 `agent_name` | 无 | `AGENT + agent_name` |
| Workflow Subflow 节点 | 节点 `recipe_name` | 无 | `WORKFLOW + recipe_name` |

`CapabilityKind` 复用现有 `TOOL | SKILL | AGENT | WORKFLOW` vocabulary；不得新增 `RECIPE` kind。非 Capability 的 Workflow LLM、DISPLAY、条件和网关节点不为满足标题映射而伪造 `capabilityKind`。

当前工作区中的 `businessLabel`、Tool `presentation`、Plugin SDK 名称扩展和后端名称 resolver 是与目标契约冲突的未完成草稿。实施开始时先移除这些草稿及其专属测试，再按本设计执行；不得在最终实现中同时保留两套路线。

### Capability 范围盘点

| 类型 | 当前生产对象 | 本 change 处理 |
|---|---|---|
| 文件 Tool | `Read`、`Write`、`Edit`、`Glob`、`Grep` | 前端平台固定映射 |
| 执行 Tool | `Bash`、`Python` | “执行命令”“执行程序”；不显示命令或脚本名 |
| 知识/计划 Tool | `Rag`、`ToolSearch`、`TodoWrite`、`Cron` | 前端平台固定映射；RAG 结果规则不变 |
| Memory Tool | `search_memory`、`get_memory_detail`、`add_memory` | 前端平台固定映射 |
| 可选能力获取 | `acquire_skill` | 前端平台固定映射 |
| wrapper Tool | `Agent`、`Skill`、`Workflow` | 固定模板 + 目标映射名称或目标 id |
| 专用交互 | `AskUserQuestion` | 专用呈现保持 |
| 平台内部调用 | `ApiCall` | 规范路径无普通卡 |
| Plugin/CLIP Tool | 动态普通 Tool | 集成产品映射；缺失时显示 id |

`topologyDiscovery`、`networkDiagnostic`、`inventoryLookup` 只存在于 UCD、mock 或测试夹具，不纳入平台内置映射。

### 当前场景到目标的完整矩阵

| 场景 | 现有显示 | 目标显示 | 降级显示 | 详情影响 | 显示策略 |
|---|---|---|---|---|---|
| 固定内置 Tool | 技术名 + 状态 | 平台业务标题 + 状态 | `capabilityId`，再到执行操作 | 只本地化平台标签 | 三档范围不变 |
| Bash | `Bash` + 状态 | `执行命令` + 状态 | `Bash`，再到执行操作 | 不新增命令名 | 当前 `SUMMARY` 不变 |
| Python | `Python` + 状态 | `执行程序` + 状态；摘要使用程序措辞 | `Python`，再到执行操作 | 不新增脚本/程序名 | 当前 `SUMMARY` 不变 |
| 扩展 Tool 映射命中 | 技术名 + 状态 | 集成业务标题 + 状态 | `capabilityId`，再到执行操作 | 不新增字段 | 三档范围不变 |
| 扩展或未来 Tool 映射未命中 | 技术名 + 状态 | `capabilityId` + 状态 | 执行操作 | 无 | 三档范围不变 |
| Agent wrapper | wrapper 技术名 + 状态 | `调用子智能体：{映射名称}` + 状态 | 映射未命中使用 `targetCapabilityId`；缺失时调用子智能体 | 不改变内容 | 当前 level 不变 |
| Skill wrapper | `SKILL` 或不稳定名称 + 状态 | `加载技能：{映射名称}` + 状态 | 映射未命中使用 `targetCapabilityId`；缺失时加载技能 | 正文、路径、参数仍隐藏 | 当前 `STATUS_ONLY` 不变 |
| Workflow wrapper | wrapper 技术名 + 状态 | `执行预设流程：{映射名称}` + 状态 | 映射未命中使用 `targetCapabilityId`；缺失时执行预设流程 | 不改变外层详情或子项 | 当前 level 不变 |
| 直接 Agent/Skill/Workflow 节点 | 节点或技术名 + 状态 | kind 模板 + 映射名称 | kind 模板 + `capabilityId` | 不改变既有父子层级 | 当前 level 不变 |
| AskUserQuestion | 专用问题和回答 | 保持现有专用呈现 | 既有兼容行为 | 无 | accepted-answer 不变 |
| ApiCall | 规范路径无普通卡 | 保持无普通卡 | 意外可见时沿 id 降级 | 不推导 HTTP 内容 | `STATUS_ONLY` 上限不变 |
| SUMMARY 有有效摘要 | 技术标题 + 摘要 | 业务标题 + 有效摘要 | 按身份降级链 | 无 | 有效性规则不变 |
| SUMMARY 无有效摘要 | 摘要占位语 | 仅标题 + 状态 | 按身份降级链 | 不创建详情 | level 仍为 SUMMARY |
| DETAIL | 技术标题 + 安全详情 | 业务标题 + 本地化标签 + 原证据 | 按身份降级链 | 不增删证据字段 | level 与安全上限不变 |
| 旧历史 | 技术 id | 既有合法 `capabilityId` + 状态 | 执行操作 | 不补目标字段 | 不提高披露级别 |
| 新历史映射更新 | 当前映射标题 | 使用更新后的当前映射 | id 降级 | 无 | 不冻结旧名称 |

### GAP

| 目标 | 当前事实 | 最小差异 |
|---|---|---|
| 前端能区分能力类型 | lifecycle Web payload 未统一公开 `capabilityKind` | 已有 Capability lifecycle 的 started/completed 增加现有 enum 值 |
| wrapper 显示具体目标 | 目标只在执行参数中 | 只 allowlist 一个归一化 `targetCapabilityId` |
| 业务名称集中管理 | frontend 直接显示技术 id | 新增一个 build-time 名称解析模块和平台模板 |
| live/history 一致 | history 只有既有 lifecycle 字段 | started/completed 保存同一身份字段 |
| SUMMARY 无摘要不填充 | frontend 主动生成占位语 | 无有效摘要时省略摘要 |

## 唯一实施路径

### 1. 执行边界形成最小身份事实

普通 Tool loop 使用已经解析的 descriptor 和 `effectiveArguments`，在首个 lifecycle event 前形成 request-local immutable identity：

```ts
interface CapabilityProcessIdentity {
  readonly capabilityKind: CapabilityKind;
  readonly capabilityId: CapabilityId;
  readonly targetCapabilityId?: string;
}
```

规则：

- `capabilityKind` 使用执行入口 descriptor 的实际 kind；wrapper 因此仍为 `TOOL`。
- `capabilityId` 使用执行入口 descriptor 的现有 id，不改写为目标能力 id。
- `capabilityId=Agent` 时只把 `effectiveArguments.agentId` 归一化为 `targetCapabilityId`。
- `capabilityId=Skill` 时只把 `effectiveArguments.name` 归一化为 `targetCapabilityId`。
- `capabilityId=Workflow` 时只把其已解析 `recipeName` 归一化为 `targetCapabilityId`，并由既有 wrapper started/completed 逐值复用。
- 普通 Tool 即使参数中存在同名字段也不得产生 `targetCapabilityId`。
- 目标值 trim 后为 1 至 128 个 Unicode code point 且不含 Unicode control character；非法值局部省略。
- 不读取或投影 Agent `prompt`、Skill `args`、Workflow `inputText/inputVariables`。
- started、成功 completed、执行异常 completed、结果校验异常 completed、超时和取消复用同一 identity。没有 started 的合法 completion-only 路径只发送能够安全确定的入口身份。

Workflow projector 不查询目录或名称配置，只从受治理的 Recipe 节点定义和事件输入形成直接能力身份。Tool、Skill、Agent、Subflow 分别投影现有 `TOOL/SKILL/AGENT/WORKFLOW` kind 与目标 id；非 Capability 节点保持原呈现。display-control、节点数量、父子关联和外层 wrapper lifecycle 保持不变。

### 2. Timeline 保存 started/completed 身份

目标 payload 示例：

```ts
// 普通 Tool
{ capabilityKind: 'TOOL', capabilityId: 'Read', toolCallId: 'call-1' }

// Skill wrapper
{
  capabilityKind: 'TOOL',
  capabilityId: 'Skill',
  targetCapabilityId: 'network-diagnosis',
  toolCallId: 'call-2'
}
```

- 新产生且具有受治理 Capability 身份的用户可见 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 携带 `capabilityKind`。
- `Agent`、`Skill`、`Workflow` wrapper 事件至多携带一个 `targetCapabilityId`；其他入口不得携带。
- `CAPABILITY_RESULT_DELTA` 不新增 `capabilityKind` 或 `targetCapabilityId`；继续携带既有 `capabilityId` 和 `toolCallId`。
- 使用既有 timeline payload、sequence 和持久化，不新增 Message、Record、Gateway 或数据库表。
- 公共 schema 将新增字段保持 optional，以兼容旧 timeline 和不代表受治理 Capability 的既有 Workflow 节点事件；新目标路径通过 producer 测试保证字段存在。

### 3. 共享 channel 做 schema allowlist 投影

`agent-channel-common` 对 started/completed 复用一个身份 projector：

- 只接受现有 `CapabilityKind` 值、有界 `capabilityId` 和有界 `targetCapabilityId`。
- 只有 `capabilityId` 严格等于 `Agent`、`Skill` 或 `Workflow` 时才复制 `targetCapabilityId`；其他入口携带该字段时局部省略。
- completed 从 timeline 事实取身份，不从 Message、result、Capability 目录或前端映射恢复。
- delta 不复制新增身份字段。
- 非法新增字段不得丢弃既有合法 `capabilityId`、状态、安全失败或其他步骤。
- SSE、WebSocket、live history 和刷新 history 复用同一 projector。

这些字段为 additive optional Web payload。旧 frontend 可忽略；新 frontend 对旧 backend 或旧 history 直接使用既有 `capabilityId`。

### 4. Agent Web 集中解析名称和标题

Agent Web 新增一个纯函数名称解析模块，由 `processDetails.ts` 的既有 tool-call aggregation 调用。模块输入只包含安全投影后的身份和当前 i18n 函数，不访问 Capability 目录、模型或后端配置。

解析顺序：

1. `capabilityId=Agent` 且 `targetCapabilityId` 合法：以 `AGENT + targetCapabilityId` 查询名称；命中后显示“调用子智能体：{名称}”，未命中显示“调用子智能体：{targetCapabilityId}”。
2. `capabilityId=Skill` 且 `targetCapabilityId` 合法：以 `SKILL + targetCapabilityId` 查询名称；命中后显示“加载技能：{名称}”，未命中显示“加载技能：{targetCapabilityId}”。
3. `capabilityId=Workflow` 且 `targetCapabilityId` 合法：以 `WORKFLOW + targetCapabilityId` 查询名称；命中后显示“执行预设流程：{名称}”，未命中显示“执行预设流程：{targetCapabilityId}”。
4. wrapper 目标缺失或非法：显示对应中性标题。
5. 非 wrapper 或直接 Capability 具有合法 `capabilityKind + capabilityId`：查询映射；Tool 映射值是完整业务标题，Agent、Skill、Workflow 映射值由固定 kind 模板包装。
6. 映射未命中但 `capabilityId` 合法：普通 Tool 显示原 `capabilityId`；直接 Agent、Skill、Workflow 使用固定模板包装该 id。
7. 所有身份均缺失或非法：显示“执行操作”/`Execute operation`。

状态继续使用既有 lifecycle/failure mapping，并只拼接一次。started 建立身份；delta 只更新结果并复用；delta 早于可见 started 时临时显示其既有 `capabilityId`，completed 到达后按同一 `toolCallId` 更新标题。

#### 映射 owner

- 平台在同一前端模块维护内置 Tool、Memory Tool、`ToolSearch`、`acquire_skill` 的 i18n key 和固定模板。
- 集成产品在同一扩展入口维护普通扩展 Tool、Agent、Skill、Workflow 的 i18n key 与当前部署支持的语言资源，并随前端产物发布。
- 同一前端产物服务范围内，相同 `kind + id` 必须具有唯一、稳定的用户语义；不能满足时不得配置该映射，只显示 id。
- Tool 映射值是完整业务标题；Agent、Skill、Workflow 映射值只提供资源业务名称，由平台固定模板包装。
- 当前语言资源缺失时视为映射未命中，不借用另一语言；本 change 只使用现有 `zh-CN`、`en-US` i18n 机制，不增加通用 locale registry。
- 映射值不得包含状态、HTML、Markdown 或详情内容。
- 本 change 不新增 runtime configuration、远程名称查询或 hot reload。

历史只保存执行身份，不保存业务名称。映射或前端语言资源更新后，历史按当前前端产物重新渲染；本 change 不处理运行时语言切换。

### 5. 保持结果显示策略和 RAG 不变

实现不得修改 `CapabilityResultPresentationPolicy` 类型、内置 level、minimum-level 算法或 safe projector 白名单。同一标题分别通过三档策略时，只允许结果字段按既有规则变化：

- `STATUS_ONLY`：标题、状态和既有允许的安全失败事实。
- `SUMMARY`：在既有有效安全摘要存在时显示摘要；否则只显示标题和状态。
- `DETAIL`：在既有安全投影允许时显示详情；标题映射不得新增证据。

删除成功结果的 `resultReturnedWithoutSummary` 回退。安全失败原因继续由既有 failure renderer 负责。RAG `SUMMARY` 已有的 `safeResult`、来源和预览规则不在本 change 调整。

Python 对关联 `capabilityId=Python` 的成功、失败、超时安全摘要使用“程序”措辞；Bash 保持“命令”措辞，不改变 summary code、args 或 level。

### 6. 详情只转换平台标签

DETAIL renderer 只本地化平台拥有的字段标签。Bash/Python 的 command、code、script、arguments 不进入新增 identity，也不增加详情字段；既有 stdout/stderr、路径、错误码、顺序和截断逐值保持。

## 失败与降级

| 情况 | 行为 |
|---|---|
| `capabilityKind` 缺失或非法 | 保留合法 `capabilityId`；前端显示 id |
| wrapper `targetCapabilityId` 缺失或非法 | 显示 wrapper 中性标题；执行不受影响 |
| 非 wrapper 携带 `targetCapabilityId` | channel 省略该字段，保留入口身份 |
| 前端映射未命中 | wrapper 或直接资源显示模板 + id；普通 Tool 显示 `capabilityId` |
| `capabilityId` 也缺失或非法 | 显示执行操作 |
| result delta 没有可见 started | 临时显示 delta 的合法 `capabilityId`；completed 可更新同一步骤 |
| 旧历史无新增身份字段 | 显示既有 `capabilityId`，不查询后端目录补名 |
| SUMMARY 无有效摘要 | 只显示标题和状态 |
| 单条身份投影非法 | 局部降级，不隐藏其他步骤、过程面板或最终答案 |

## 质量属性与验证

| 属性 | 设计约束 | 验证重点 |
|---|---|---|
| 安全 | 只 allowlist kind、入口 id 和一个目标能力 id；不投影完整 arguments | prompt/args/inputVariables、控制字符和错误入口负例 |
| 可靠性/恢复 | started/completed 保存同一身份，id 兼容降级 | live、重连、刷新、completion-only 一致 |
| 可维护性 | 一个前端解析模块和一个映射入口；不改注册链 | 无平行配置、无后端名称 resolver |
| 可测试性 | identity projector 和 title resolver 均为确定输入输出 | 固定 Tool、扩展 Tool、三类 wrapper、直接节点、旧历史 |
| 审计/可追溯性 | capabilityId 保持执行入口语义，targetCapabilityId 只补充本次目标坐标 | started/completed 逐值一致、delta 不重复 |

验证层次：

- characterization：三档结果、RAG、AskUserQuestion、条目数量、顺序、合并和展开。
- unit：目标能力 id 提取、字段校验、平台映射、集成映射、标题降级、Python 摘要。
- contract：started/completed、delta 不重复、SSE/WS/history 同形、completion-only、旧历史和非法字段。
- integration：Tool loop/Workflow projector → timeline → channel → Agent Web。
- e2e：local、immersive、collaborative 三宿主及刷新 history。

## 公共契约与兼容性

- 用户可见 started/completed payload 增加 optional `capabilityKind` 和 `targetCapabilityId`。
- 新产生且具有受治理 Capability 身份的 started/completed 必须携带 `capabilityKind`。
- `targetCapabilityId` 只在 `capabilityId=Agent|Skill|Workflow` 时表示对应目标能力 id，不改变 runtime/session Agent Scope 字段或任何资源注册字段的语义。
- `capabilityId` 保持执行入口语义；result、权限、Provider 路由和审计逻辑不得读取前端映射。
- 旧 backend/history 没有新增字段时，新 frontend 显示既有 id；旧 frontend 忽略新增字段，因此不要求原子部署。
- 本 change 不修改 `agent-contracts/capability`、Plugin SDK 或 Capability Descriptor。

## 不修改的边界

- 不新增或修改 Gateway port、Record、table 或 migration。
- 不修改 Capability 注册、discovery、availability、权限、routing、参数 schema、执行和审计身份。
- 不修改 Message 结构或 Capability result 内容。
- 不新增新的顶层 stream event、timeline type、Provider type、registry 或 action enum。
- 不修改 Workflow 节点数量、display-control、父子关系、外层 wrapper lifecycle 或输出投影。
- 不修改三档结果配置、RAG `safeResult` 或 AskUserQuestion 专用呈现。

## 长期基线刷新计划

归档前把稳定事实同步到：

- `openspec/specs/ts-run-status-visibility/spec.md`：最小公开身份、前端映射、标题降级、摘要与详情边界。
- `openspec/designs/architecture/stream-projection.md`：started/completed 身份 allowlist 与 history 一致性。
- `openspec/designs/modules/agent-core.md`：执行入口和 wrapper 目标能力标识投影责任。
- `openspec/designs/modules/agent-channel-web.md`：共享安全投影责任。
- `openspec/designs/modules/frontend-agent-web.md`：集中名称映射、模板和兼容降级。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-run-status-visibility` 映射。
