## 1. 节点 handler

- [x] 1.1 注册 `tool`、`tool-choice`、`restful`、`python`、`agent` handler，标准节点名采用 `{}-{}`；兼容现存 `tool_choice -> tool-choice`
  验证：`npm run build`
  来源：design 决策 D1

- [x] 1.1A 明确 capability node-specific schema owner：tool / api / script / agent 等字段只在本 change 定义；不得要求 `agent-contracts/core` 为其冻结强类型
  验证：code review 检查点通过；cross-artifact 文案一致
  来源：design 决策 D6

- [x] 1.1B 边界对齐：显式固化与 `package-composition`、`workflow-routing`、`execution-engine`、`gateway-nodes`、`knowledge-nodes`、`llm-nodes`、`interaction-nodes` 的职责分工，避免在 capability change 内重复承接 registry / dispatch / scheduler / pending / candidate-choice owner
  验证：code review 检查点通过；cross-artifact 文案一致
  来源：design boundary matrix

- [x] 1.2 将 `tool` / `agent` 接线到 `CapabilityInvocationService`
  验证：`npm run build`
  来源：spec requirements `Tool Node` / `Agent Node`

## 2. 安全与副作用边界

- [x] 2.1 为 `restful` 实现标准 `api_name` 解析、secret reference 注入和 safe result 映射
  验证：集成测试 C3
  来源：spec requirement `Restful Node`

- [x] 2.2 为 `python` 实现 sandbox gateway 调用、timeout 和 denial safe error
  验证：集成测试 C4、security test C7
  来源：spec requirement `Python Node`

- [x] 2.3 为 `agent` 实现子 agent 调用和父 scope 隔离
  验证：集成测试 C5
  来源：spec requirement `Agent Node`

## 3. 选择类节点

- [x] 3.1 实现 `tool-choice` 的 bounded candidate 选择和 mapped argument 生成，并兼容现存 `tool_choice`
  验证：集成测试 C2
  来源：spec requirement `Tool Choice Node`

## 4. 验证

- [x] 4.1 集成测试：`tool` 调用已治理 capability 成功
  验证：`npm run test`
  来源：verification C1

- [x] 4.2 集成测试：`tool-choice` 输出 `selectedToolId` 和 safe `mappedArguments`；现存 `tool_choice` 也能被兼容解析
  验证：`npm run test`
  来源：verification C2

- [x] 4.3 集成测试：`restful` 按标准 API 配置调用成功；secret reference 正确注入
  验证：`npm run test`
  来源：verification C3

- [x] 4.4 集成测试：`python` 在 sandbox 中执行并返回 safe stdout / stderr / exitCode
  验证：`npm run test`
  来源：verification C4

- [x] 4.5 集成测试：`agent` 调用子 agent，父 execution scope 保持不变
  验证：`npm run test`
  来源：verification C5

- [x] 4.6 Contract test：capability 节点 output 不含 secret 明文；side effect event 带 execution / node attempt 可追溯键
  验证：`npm run test:contract`
  来源：verification C6

- [x] 4.7 Security test：sandbox 拒绝越权访问；secret 解析失败不降为明文传递
  验证：`npm run test`
  来源：verification C7

- [x] 4.8 Architecture test：workflow capability 节点不新建第二套 capability path
  验证：`npm run lint:architecture`
  来源：design boundary

- [x] 4.9 Architecture test：capability 节点不新增 recipe registry、dispatch path、pending store 或 gateway control semantics；`tool-choice` 只选择不执行
  验证：`npm run lint:architecture`
  来源：design boundary matrix

## 5. 实现层 bugfix：risk policy 门禁与 stdout 变量投影

- [x] 5.1 P0：workflow capability 节点调用 `capabilityInvocation.invoke()` 时补传第 3 个参数 `runtimeContext`，使 sandbox risk policy 的 `observabilityReady` 判定通过
  - `agent-workflow/src/nodes/shared.ts` 新增 `createWorkflowCapabilityRuntimeContext()`，提供 no-op `emitPolicyApplied`
  - `agent-workflow/src/nodes/capability-nodes.ts` 5 处 `invoke()` 调用（restful / restful-long-polling / restful-batch / python / agent）全部补传；agent 节点 merge 保留原有 `capabilityResolver`
  - 根因：sandbox-execution-port.ts 用 `context.emitPolicyApplied !== undefined` 判定 observabilityReady，workflow 未传 runtimeContext 导致 undefined，risk policy 返回 DEGRADED 拒绝执行
  验证：`tsc -b` 通过；`risk-policy-sandbox` 测试通过；`workflow-capability-contracts` 测试通过
  来源：bugfix 定位

- [x] 5.2 P0：sandbox-execution-port.ts 在 risk policy 非 ALLOW 时补 `sandbox.risk_policy.denied` warn 日志（Layer 4）
  - 字段：`executable`、`outcome`、`reasonCode`、`observabilityReady`、`sandboxReady`；不含 command/args/路径
  - 填补 workflow.python_node.failed 与 python.execution.started 之间的诊断空白层
  验证：`tsc -b` 通过；`risk-policy-sandbox` 测试通过
  来源：bugfix 定位

- [x] 5.3 P1：workflow python 节点 stdout JSON 变量投影修复（方案 A）
  - `agent-workflow/src/nodes/shared.ts` 新增 `expandStdoutJsonFields(payload)`：当 `payload.stdout` 为合法 JSON object 时，将顶层字段展开到 payload 顶层，不覆盖 `exit_code`/`stdout`/`stderr`/`timed_out`/`_trace`；非 JSON / array / primitive 原样返回
  - `agent-workflow/src/nodes/capability-nodes.ts` `executePythonNode` 在 `capabilityResultPayload` 后包一层 `expandStdoutJsonFields`
  - 根因：python tool 返回 `{ exit_code, stdout: string, ... }`，workflow 变量投影 `${python_result.xxx}` 是代码级路径解析，只遍历对象属性不解析 JSON 字符串，导致 stdout 内的 JSON 字段无法被 recipe 引用
  - 不改 python-tool contract、不改 `pythonOutputSchema.additionalProperties`、不改 recipe DSL
 验证：`tsc -b` 通过；`npm test` 836/836 通过
 来源：bugfix 定位

## 7. 实现层 bugfix：CLIP bodyRequired 工具 inputSchema 过严与 execute 命令格式不兼容

- [x] 7.1 P0：`clipInputSchema` 在 `bodyRequired=true && parameters.length===0` 时过严导致 `CAPABILITY_INPUT_INVALID`
  - 根因：`search_feature`、`search_object` 等 CLIP 工具的 `clipc describe` 返回 `body_required=true, params=[]`；原 `clipInputSchema` 生成 `{ type:"object", additionalProperties:false, required:["body"], properties:{ body:{ type:"object", additionalProperties:true } } }`，要求调用方必须传 `{ body:{...} }` 包裹格式；但 recipe RESTFUL 节点将 `query`、`max_num_results` 等字段直接作为顶层参数传入，无 body 包裹，导致 input validation 失败
  - 执行层 `buildClipExecutionArgs` 已通过 `request.arguments['body'] ?? request.arguments` 兼容无 body 包裹，但 inputSchema 未对齐
  - 修复：`clipInputSchema` 在 `bodyRequired=true && parameters.length===0` 时返回 `{ type:"object", additionalProperties:true }`，与 executor fallback 行为一致
  - `bodyRequired=true && parameters.length>0` 分支不变，仍要求 `body` + 声明参数
  验证：`npm test` clip-tool-source 测试通过（含新增 inputSchema 放宽测试）
  来源：RESTFUL 节点集成测试定位

- [x] 7.2 P0：`clipc execute` 命令从 `--request` envelope 改为 `-b` 直传 body
  - 根因：远程环境部署的 `clipc` 版本不支持 `--request '{"params":{...},"body":{...}}'` envelope 格式，执行后返回 `invalid_request_body`
  - 手动验证 `clipc execute search_feature <ref> -b '{...}'` 可成功调用 API
  - 修复：`buildClipExecutionArgs` 在 `bodyRequired=true` 时改用 `-b` 直接传 body；`parameters.length>0` 时追加 `--params` 传路径/查询/头参数
  - 保留 commit `617f21e83` 的 `declaredSystemHeaders` 过滤逻辑，不回退安全修复
  验证：`npm test` clip-tool-source 测试通过（含 2 处 --request 断言更新为 -b）
  来源：RESTFUL 节点集成测试定位

- [x] 7.3 P1：流式 frame 解析异常未 catch 导致 CLIP/Bash 执行终止
  - 根因：emitClipOutputFrame 和 emitBashOutputFrame 直接调用 parseClipOutputFrame，后者在 trimmed.startsWith('{') 时调用 JSON.parse 无 try-catch；流式 stdout chunk 可能包含不完整 JSON 或非 JSON 内容，SyntaxError 冒泡到 onStdoutChunk 回调导致整个执行被标记为 CLIP_EXECUTION_UNAVAILABLE / BASH_EXECUTION_UNAVAILABLE
  - 最终结果由非流式的 parseClipExecutionOutput(stdout) 处理，流式 delta 中解析失败的 frame 不应终止执行
  - 修复：在 emitClipOutputFrame 和 emitBashOutputFrame 中对 parseClipOutputFrame 调用加 try-catch，解析失败记 clip.streaming.frame_parse_error / bash.streaming.frame_parse_error debug 日志后跳过
  验证：npm test clip-command-output 测试通过（含新增 malformed JSON frame 测试）
  来源：RESTFUL 节点流式输出集成测试定位

- [x] 7.4 P2：buildClipExecutionArgs dead computation 清理
  - 根因：bodyRequired=true && parameters.length===0 时 params 变量被计算为 { path:{}, query:{}, header: declaredSystemHeaders } 但不被使用；declaredSystemHeaders 在无声明参数时返回空对象，该计算无副作用也无消费者
  - 修复：将 params 计算移到实际使用分支内（bodyRequired=true && parameters.length>0 和 bodyRequired=false 各自计算），消除 bodyRequired=true && parameters.length===0 时的 dead computation
  验证：npm test clip-tool-source 测试通过（行为不变，现有断言无需修改）
  来源：code review P2 follow-up

## 6. restful batch 并发执行模型修复

- [x] 6.1 P1：parallel 模式 batch 内元素串行执行导致 `batchParallelism` 失效
  - 根因：`processBatch` 用 `for...await` 串行处理 batch 内元素；当 `items.length <= batchSize`（默认 10）时只有 1 个 batch，外层 group-level `Promise.all` 无法产生并发
  - 修复：parallel 模式改用 worker pool（`mapWithConcurrency`），`batchParallelism` 直接控制元素级并发度，不再受 `batchSize` 约束
  - serial 模式不受影响
  - spec 补充 `Restful Batch Execution` requirement，覆盖触发机制、核心判断逻辑、输出与副作用、流程接入、失败与降级和 4 个 scenario
  - 验证：`tsc` 通过；`agent-workflow` 328/328 测试通过（含 2 个新增并发测试）
  来源：spec 补齐 + 并发模型修复
- [x] 5.4 P1：executor.ts catch 块补 `capability.invocation.error` warn 日志（Layer 2）
  - 字段：`capabilityId`、`errorName`；不含 arguments
  - 填补 capability invocation 生命周期中 catch 路径无日志的诊断空白
  验证：`tsc -b` 通过；`npm test` 836/836 通过
  来源：bugfix 定位
