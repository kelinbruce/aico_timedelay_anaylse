# AICOService 分析工作笔记

更新日期：2026-09-04。用途：阶段分析与跨对话交接；尚未生成正式运行说明文档。

## 用户意图与讨论结论

- 最终目标：依据现有代码、配置和运行材料，说明 AICOService 如何依托 NextAgent 运行。
- 已同意先追踪一条真实请求，从入口、配置、执行分支到模型、工具和结果返回，先理解主线，再扩展正式文档。
- 用户希望换对话后仍能保留讨论重点。因此交接既要记录事实和证据，也要记录文档要求、用户纠正、解释重点和未确认问题。
- 当前尚未确定正式文档读者、篇幅与格式；不得写成用户已选择某类读者。
- 尚未开始专项排障或修改业务代码。样本中的答案差异只记录，不推断业务根因。

## 分析基线与证据边界

- 服务静态基线：`aico_struct_code/aicoservice@27.68.169/`，重点为其 `node_modules/@nextagent/`、`config/`、`agents/aico-agent-m/zh_CN/`。
- 框架源码：`nextagent/NextAgent/`。尚未证实与服务包是同一构建。两边 `@nextagent/agent-runtime` 都写 `1.0.0`，这不足以证明内容一致；服务包 source map 只有映射信息，没有 sourcesContent。
- 最新运行材料：`e2e_delay/4_9.4/` 的测试 CSV 和日志分析 XLSX。它们是导出记录；本目录未提供这些会话的原始容器 JSONL。更早的 `e2e_delay/1/` 有原始日志，不能当成本次样本的原始日志。
- 已有 `aico_struct_code/aicoservice_request_lifecycle_wiki.md` 和 `aicoservice_import/pod-recipe-invocation.md` 仅作为定位线索。本轮关键启动、入口、Runtime、Skill/Workflow 与 Recipe 节点均重新查阅实际文件。
- 已证实样本加载的 Skill 正文与本地包有差异，不能把整包称为与 9 月 4 日部署完全一致。

## 样本与定位

- 问题：获取apo_test区域内机械下倾角是2°的5G小区一共有多少个？
- Session：`session-b357b3d1-7cc8-42ce-a48d-e8418b63a0eb`
- Request：`request-9850aa55-00bc-4428-bb31-3f079fb5dd75`
- Run：`run-d395669d-ec3c-4638-9831-3d200fedc672`，来自两次工具调用一致的 capabilityInvocationId 前缀。
- 请求开始：`2026-09-04T04:17:19.347Z`，即北京时间 12:17:19.347。
- CSV：`e2e_delay/4_9.4/查数_150.csv`，包含表头的第 2 条逻辑记录。CSV 字段含换行，不能把逻辑记录号当文本行号。
- XLSX：`e2e_delay/4_9.4/all_operational_logs_knowledge-qa性能分析_无线.xlsx`，`会话明细!A1637:AE1637`。
- [证据摘录](outputs/aico_request_sample_20260904.json)：含源文件 SHA-256、关联坐标、原样导出的 Agent 轨迹、会话步骤、Skill 差异和计时核对。不是原始日志。
- 选样原因：问题直观，CSV 与会话表唯一匹配，包含 Skill、Workflow 和最终模型结果，适合讲清两层执行关系。它不是答案正确性的示范样本。

## 第一条请求的主线

下面入口与 Runtime 部分由本地代码支持，样本未提供入站 HTTP 或逐帧 SSE 原始记录；Agent 与 Workflow 步骤由导出轨迹及会话表支持。不要把所有环节都标为本次运行已经逐事件验证。

1. 本地 `bin/start.sh:75` 设置配置目录与 remote 部署模式，`:80` 启动 AICO channel 的 `entrypoints/start.js`。入口 `start.js:42` 启动 remote runtime package，beforeStart 注册 A2A-T 等专用接口。
2. `config/default-system.yaml:38` 配置 Fastify UDS `/opt/sidecar/backend/http.sock`，active Agent 为 `AICOServiceAgent`。Agent 配置位于 `agents/aico-agent-m/zh_CN/agent.yaml`。
3. `agent-channel-aico/dist/a2at/routes/task-forward.js:158` 注册 `POST /rest/naie/aicoservice/v1/a2at/task`。请求校验、身份提取、协议投影后，新请求调用 `runtime.submit()`（同文件 `:79`）。本样本是否确实从该接口进入，仍需入站记录确认。
4. `agent-runtime/dist/lifecycle/submit.js:652` 受理请求；`:725` 一带准备 request/run/context 标识并固化 Agent assembly；保存用户消息和 QUEUED run，`:823` 发出 REQUEST_ACCEPTED，`:844` 排队。`:3566` 获取 Agent 实例，`:3567` 调用 agent.execute。受理与实际执行是两个阶段。
5. `agent-core/dist/agent/default-agent.js:32` 决定路由，确定性 Recipe 分支可直接执行；`:125` 起是模型与工具循环。本样本可观察到模型驱动的 Skill → Workflow 路径，未取得具体 routing reason。
6. 第一次外层模型返回 `Skill(name=wireless-search-net-fast-4-4, args.question=原问题)`。Skill 工具返回 `status=loaded` 的执行说明，核心要求为无线数据请求交给 WATT_PLEX；本次 Skill 加载本身没有完成查数。
7. 第二次外层模型返回 `Workflow(recipeName=WATT_PLEX, inputText=原问题, inputVariables={})`。内建 Workflow 工具验证当前 Agent scope 中的工作流能力，再通过 workflow execution port 查找 Recipe 定义并传递 session/request/run 上下文。
8. 会话步骤显示 WATT_PLEX 执行预处理、并行入口/汇合、结果整理、一次协商规划模型节点、两次 executor 模型节点，中间调用一次 `call_param`，随后展示结果。
9. 本地 WATT_PLEX 的 `call_param` 映射 `queryEngineerParam`，收到工具结果后更新 tool history，再调用 executor，直到生成可展示结果。
10. Workflow 返回 succeeded 和“区域下未查询到小区、数量为 0”的文本。第三次外层模型生成最终内容，无新 tool call。该最终文本还包含 sub_questions JSON。
11. 本地 Runtime `submit.js:3668` 统一提交执行终态。A2A-T 路由 `task-forward.js:197` 设置 SSE，`:214` 订阅运行事件，`:97` 起投影/写入响应并在终止事件后关闭。样本缺逐帧 SSE，不判断用户端看到各片段的准确顺序。

## 两层模型调用与耗时

外层步骤取自 `会话明细!Z1637`，精度保持原表：

| 步骤 | 秒 | 观察 |
|---|---:|---|
| 外层 Model 1 | 6.984 | 请求加载 Skill |
| Skill | 0.029 | 加载无线查数执行说明 |
| 外层 Model 2 | 9.699 | 请求执行 WATT_PLEX |
| Workflow WATT_PLEX | 37.016 | 包含内部模型、查询和节点处理 |
| 外层 Model 3 | 5.301 | 生成最终回复 |

- 外层串行步骤合计 59.029 秒；会话表总时长 59.87 秒（F1637）；CSV 测试端记录 59.671 秒。口径不同，不强制对齐；0.841 秒差值不能直接归为排队或网络。
- 会话表内部节点：`call_nego_plan_llm` 10.969 秒；`call_exec_llm` 第一次 5.949 秒，第二次 14.674 秒；`call_param` 0.146 秒。
- CSV 完整轨迹和表格的 Model 调用次数都是外层 3 次；结合内部节点及本地定义，可识别另 3 次模型调用节点执行。应写“3 次外层 + 3 次工作流内模型节点”，不要声称已核实所有下游 HTTP 请求次数、重试或辅助模型调用。
- 内部模型节点合计 31.592 秒，已包含在 Workflow 37.016 秒中。表里“能力调用总耗时”73.18 秒也不能再与 Workflow/会话总时长相加。
- CSV provider 结果时长 6.966 / 9.585 / 5.258 秒，与步骤表 Model 时长略不同；未取得原始采集实现，暂保留两套口径。

## 本地代码支持的内部边界

以下路径都相对于服务包：

| 文件与位置 | 支持的说明 |
|---|---|
| `node_modules/@nextagent/agent-capability/dist/builtins/skill-tool.js:131` | 加载受治理的 Skill 正文；本样本工具返回明确为 loaded |
| `node_modules/@nextagent/agent-capability/dist/builtins/workflow/workflow-tool.js:23` | 校验输入、解析工作流能力、调用执行端口 |
| `node_modules/@nextagent/agent-workflow/dist/workflow-tool-port.js:8` | agentId + recipeName 查定义，传递请求关联标识 |
| `config/default-system.yaml:103` | workflow-execution 为 LOCAL；整体 remote 模式不等于工作流引擎在远端 |
| `node_modules/@nextagent/agent-app/dist/composition/workflow-composition.js:52` | 依据配置选择本地或远端工作流服务 |
| `agents/aico-agent-m/zh_CN/recipes/WATT_PLEX.yaml:113` | 并行检索实际 next 为 7 分支，描述中的“8路”不能当真实分支数 |
| 同一 Recipe `:1593` | 协商规划节点为 RESTful chat_completions |
| 同一 Recipe `:2120` | executor 模型节点为 RESTful chat_completions，可以在循环中重复执行 |
| 同一 Recipe `:2269` | call_param → queryEngineerParam |
| `node_modules/@nextagent/agent-workflow/dist/nodes/capability-nodes.js:87` | RESTful api_name 交给 capability invocation |
| 同一节点实现 `:309` | Python 节点通过 sandboxExecution.runPython 执行 |

本地 Recipe 为规划模型配置 netmo-deepseek-v4-flash、executor 配置 netmo-qwen3.6-27b；仅外层 netmo-deepseek-v4-flash 在本样本模型轨迹中直接得到验证。由于部署文件存在差异，不能据本地 Recipe 直接断言本样本内部实际模型型号。

## 已发现差异与待确认项

1. 样本加载 Skill 的“未查到数据”与失败处理要求仅回复“未查到信息”；本地 Skill 无相同的空结果要求，失败处理为简要说明原因。两者 Smartcanvas 请求体也不同。具体差异保存于证据 JSON，不推断是热更新还是包版本变化。
2. 本样本返回数量 0，CSV 参考答案为 1，且最终文本出现内部分类 JSON。只能确认与参考答案/Skill 要求存在差异；缺少实际 queryEngineerParam 入参、返回体与数据快照，不能判断根因在模型、查询条件还是数据。
3. 未取得入站 HTTP、routing reason、原始模型输入、内部模型响应、查数工具入参与返回、逐帧 SSE。因此不得写“Quick QA 因某分数未命中”或还原不存在的 SQL/过滤参数。
4. 会话表 Rag 指标为 0，但步骤包含 parallel_search；导出未列出每个子分支。这不足以证明没有检索，也不能说明检索耗时是 0。
5. 本地包、当前 NextAgent TS 源码与 9 月 4 日运行部署的完整对应关系仍未确认。已知 Skill 不一致，仅可对已匹配部分解释机制。

## 下一步

- 先与用户沿着这条样本讨论，确认哪些环节仍不清楚；随讨论更新本笔记的关注点与纠正。
- 优先展开“第二次外层模型如何调用 Workflow，以及 Recipe 内如何规划 → query_param → 返回”。若需要解释这次答案错误，先补齐该 session/run 的原始日志和查询输入输出。
- 之后再覆盖 Quick-QA 分支、启动配置与部署依赖、失败/取消/恢复等正式文档所需范围。不要把单条无线查数请求推广为所有请求。

## 本轮验证与变更

- CSV 中该 session 唯一；XLSX 会话表中该 session 唯一；两次工具的 run 前缀相同；导出模型事件数量、CSV Model 次数及会话表 Model 次数均为 3。
- 已计算串行步骤合计并保留不同计时口径；已对加载 Skill 与包内正文做文本差异比较。
- 仅新增本工作笔记和证据 JSON；没有修改业务代码或输入表格。未启动服务、调用生产接口或运行构建/测试，因为本轮为静态分析与数据核对。
