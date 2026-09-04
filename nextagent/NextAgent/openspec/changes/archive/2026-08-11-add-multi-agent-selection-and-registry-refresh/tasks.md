## 实施任务

### FN-3.5 Agent 选择策略

- [x] 在 `agent-contracts/agent-assembly` 新增 `AgentSelectionPolicy` 接口、`AgentSelectionRequest` 和 `AgentSelectionResult` 类型
  -> 验证: `tsc --noEmit` 通过；接口被 `agent-runtime` 和 `agent-app` 消费
- [x] 在 `agent-app/src/composition/agent-selection-policy.ts` 新增 `DefaultAgentSelectionPolicy` 默认实现（safeId 格式校验 + fallback + fail closed）
  -> 验证: unit test 覆盖格式合法选择、缺失 fallback、格式非法 fail closed
- [x] 在 `agent-contracts/runtime` 的 `RuntimeCreateSessionCommand` 新增可选 `agentId?: string` 字段（原始值，未经格式校验）
  -> 验证: `tsc --noEmit` 通过；contract test 校验 schema
- [x] 在 `agent-runtime/lifecycle/submit.ts` 的 `createSession` 中调用 `AgentSelectionPolicy.resolve` 做格式校验和决策，再调用 `assemblyRegistry.active(agentId)` 校验存在且 user-invocable，校验失败返回 missing-assembly safe failure
  -> 验证: unit test 覆盖校验通过绑定 session、格式非法 fail closed、agent 不存在 fail closed、未传 agentId fallback
- [x] 在 `agent-app/composition/channel-composition` 注入 `AgentSelectionPolicy` 实例到 runtime
  -> 验证: composition 正常初始化

### FN-3.2 编译智能体装配

- [x] 在 `agent-app/composition/assembly-composition.ts` 将 `baseRegistry` 改为 `let baseRegistry = input.baseRegistry`，list 方法改为闭包委托
  -> 验证: `tsc --noEmit` 通过；现有 model-reference-composition test 不回归
- [x] 扩展 `readActiveAgentDefinitionFingerprint` 为扫描整个 `agentsRoot` 下所有顶层 agent 目录的 agent.yaml 组合 fingerprint（不覆盖 subagents 目录）
  -> 验证: unit test 覆盖新增顶层目录、删除顶层目录、修改顶层 agent.yaml 均改变 fingerprint
- [x] 在 `refreshActiveAssemblyIfNeeded` 中增加 baseRegistry 重建逻辑（fingerprint 变化时调用 `createAgentDiscoveryAssemblies` + `createCompiledAgentAssemblyRegistry`），重建失败 try-catch 保留上一次有效集合
  -> 验证: unit test 覆盖 pub 新 agent 后 catalog 可发现、重建失败保留旧集合、已 accepted request 不受影响
- [x] 在 active/require/list 方法中触发 fingerprint 检查（同步）
  -> 验证: integration test 覆盖 catalog 查询时自动发现新 agent
- [x] 在 `agent-app/composition/capability-composition.ts` 将 `workspaceFileExtensionPolicies` 从静态 Map 改为从 `assemblyRegistry.require()` 动态获取
  -> 验证: unit test 覆盖新 agent 的 workspace file extension policy 可正确解析

### Web channel API 契约

- [x] 在 `agent-channel-web/routes/requests.ts` 新增统一 helper `resolveAgentIdFromHeader(request, defaultAgentId)`（header 解析 + safeId 格式校验 + brand + fallback），用于非 session 内端点
  -> 验证: unit test 覆盖有 header、无 header、非法 header
- [x] 在 createSession 和 convenience submit handler 中从 header `x-agent-id` 提取原始字符串值，传给 `RuntimeCreateSessionCommand.agentId`（不在 channel 层做格式校验或 brand）
  -> 验证: contract test 校验 header 存在时传原始值、不存在时不传
- [x] 将 `requests.ts` 中所有非 session 内端点的 `dependencies.defaultAgentId` 替换为 `resolveAgentIdFromHeader(request, dependencies.defaultAgentId)`（约 12 处：cron-tasks list/create、category-questions、frequent-questions、question-associations、annotations/favorite-turns、listSessions）
  -> 验证: contract test 校验各端点 header 指定 agentId 时传正确值
- [x] 将 `memory.ts` 中的 `dependencies.defaultAgentId` 替换为 `resolveAgentIdFromHeader`（约 2 处）
  -> 验证: contract test 校验 memory 端点 header 指定 agentId
- [x] 在 `agent-runtime/lifecycle/submit.ts` 的 `listSessions` 中支持动态 agentId（header 指定时按 agentId 过滤，未指定时保持当前行为）
  -> 验证: unit test 覆盖指定 agentId 过滤、未指定时行为不变

### Task channel 适配

- [x] 在 `agent-channel-task/routes/routes.ts` 的 createSession 调用处从 header `x-agent-id` 提取原始字符串值，传给 `RuntimeCreateSessionCommand.agentId`（不在 channel 层做格式校验或 brand）
  -> 验证: contract test 校验 task channel createSession header 指定 agentId

### 端到端验证

- [x] integration test: Web channel header 指定 agentId 创建 session + submit + 数据隔离（session.agentId 贯穿 submit/stream/message/attachment）
  -> 验证: 多 agent 并存互不干扰、default-agent 不被触发
- [x] integration test: task channel header 指定 agentId 创建 session + submit + 数据隔离
  -> 验证: task channel 多 agent 行为与 web channel 一致
- [x] integration test: pub 新 agent 后 header 指定该 agentId 创建 session 可用（FN-3.2 + FN-3.5 + channel 联合）
  -> 验证: 无需重启进程即可使用 pub 新增的 agent
- [x] integration test: 非 session 内端点（cron-tasks、memory、frequent-questions）header 指定 agentId 时数据隔离
  -> 验证: 产品 agent 的 cron-tasks、memory 等功能按 agentId 隔离
- [x] architecture test: `AgentSelectionPolicy` 接口在 `agent-contracts` 定义；createSession 路径不绕过 `AgentSelectionPolicy` 和 `assemblyRegistry` 校验
  -> 验证: source-level assertion

### 回归验证

- [x] 运行 `npm run build` 确认无类型错误
  -> 验证: build 通过
- [x] 运行 `npm test` 确认现有测试不回归
  -> 验证: 全部通过
- [x] 运行 `npm run lint:architecture` 确认架构边界不违规
  -> 验证: lint 通过
- [x] 运行 `openspec validate --all --strict` 确认 OpenSpec 校验通过
  -> 验证: validate 通过

