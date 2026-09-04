## 0. 前置确认

- [ ] 0.1 串行准入：`persist-ts-refresh-stable-completed-turns` 完成并以普通流程归档前，本 change 禁止实施或归档；其后必须先基于新的 stable `workflow-event-history` 重写 proposal、design、specs 与 tasks，删除 lifecycle input/output/nodeDesc、内部 `CAPABILITY_RESULT_DELTA` 和 output-parser 控制 Event body 等冲突语义，并重新通过 `$nextagent-skill-review`。在完成重写前不得执行后续任务。
  验证：`openspec list --json` 保持本 change 为 0 个完成任务；`openspec instructions apply --change add-ts-workflow-event-history --json` 即使报告 CLI ready，也必须由本首项未完成门禁阻止误实施
- [ ] 0.2 确认 channel-web stream-envelope.ts 的 copySafeFields 不会因新增 inlinePayload 字段而改变行为
  验证：代码审查 copySafeFields 实现，确认只取已知字段
- [ ] 0.3 确认 WorkflowExecutionEvent 契约 owner（engine-contracts change）允许扩展 input 字段
  验证：代码审查 WorkflowExecutionEvent 定义位置和 change 归属

## 1. WorkflowExecutionEvent input 字段扩展（workflow-contracts）

- [ ] 1.1 WorkflowExecutionEvent 新增可选 input 字段（JsonObject）
  验证：npm run test:contract + schema 校验测试
- [ ] 1.2 engine executeNode 在 handler 调用前统一 resolveNodeValue + resolveSecrets + redactSecretsFromValue，把 safe resolved inputs 放入 NODE_STARTED event
  验证：npm test + input 字段断言测试
- [ ] 1.3 NODE_COMPLETED/NODE_FAILED 事件不携带 input 字段
  验证：npm test + 字段缺失断言测试
- [ ] 1.4 input 中的 secret 明文通过 redactSecretsFromValue 替换为 [REDACTED]
  验证：npm test + secret redaction 断言测试

## 2. 通用节点投影补全

- [ ] 2.1 WorkflowRuntimeEventProjector.project() 新增通用投影分支：非 capability/llm/display 节点按 NODE_STARTED->CAPABILITY_STARTED、NODE_COMPLETED->CAPABILITY_COMPLETED、NODE_FAILED->CAPABILITY_COMPLETED(FAILED)、NODE_SKIPPED->CAPABILITY_COMPLETED(DEGRADED) 投影
  验证：npm test + gateway/knowledge/restful 节点投影测试
- [ ] 2.2 start_event 节点 NODE_STARTED 投影为 CAPABILITY_STARTED（与 end_event 对称），无 NODE_COMPLETED 事件，inlinePayload 只含 workflowEventType/nodeId/nodeType（无 input/output）
  验证：npm test + start_event 投影测试
- [ ] 2.3 end_event 节点 NODE_COMPLETED 投影为 CAPABILITY_COMPLETED（不投影为 REQUEST_COMPLETED）
  验证：npm test + end_event 投影测试

## 3. interaction 节点投影

- [ ] 3.1 user-check 节点 NODE_WAITING 投影为 USER_INPUT_REQUIRED
  验证：npm test + user-check pending 投影测试
- [ ] 3.2 user-check 节点恢复后投影为 USER_INPUT_RECEIVED
  验证：npm test + user-check resume 投影测试

## 4. inlinePayload workflow 专属字段

- [ ] 4.1 所有投影的 inlinePayload 补充 workflowEventType（原始 NODE_STARTED/NODE_COMPLETED/... 值）
  验证：npm test + 字段断言测试
- [ ] 4.2 所有投影的 inlinePayload 补充 nodeId/nodeType/retryCount
  验证：npm test + 字段断言测试
- [ ] 4.3 所有投影的 inlinePayload 补充 nodeDesc（来自 node.description）
  验证：npm test + 字段断言测试
- [ ] 4.4 NODE_STARTED 投影的 inlinePayload 补充 input（来自 event.input，safe resolved）
  验证：npm test + 字段断言测试
- [ ] 4.5 NODE_COMPLETED/NODE_FAILED 投影的 inlinePayload 补充 output（节点 outputVariables）
  验证：npm test + 字段断言测试
- [ ] 4.6 NODE_FAILED 投影的 inlinePayload 补充 diagnostic（若有 reasonCode）
  验证：npm test + 字段断言测试

## 5. output_parser 显示控制

- [ ] 5.1 解析 node.presentation.outputParser 或 node.outputParser（snake_case 兼容）的 show_title/show_content
  验证：npm test + 解析测试
- [ ] 5.2 show_title === false -> inlinePayload 不含 nodeDesc，但 event 仍写入
  验证：npm test + show_title=false 测试
- [ ] 5.3 show_content === false -> inlinePayload.output 替换为隐藏标记，但 event 仍写入
  验证：npm test + show_content=false 测试
- [ ] 5.4 未定义 outputParser -> 默认全部记录
  验证：npm test + 无 outputParser 测试

## 6. 失败与降级

- [ ] 6.1 投影异常 catch + warn log，不阻塞 workflow 执行，event 用 fallback 值仍写入
  验证：npm test + 投影异常测试

## 7. 安全验证

- [ ] 7.1 inlinePayload 不含 prompt/raw model output/raw capability payload/secret/path
  验证：npm test + 安全断言测试
- [ ] 7.2 input 中的 secret 明文已 redact，不进入 inlinePayload
  验证：npm test + secret redaction 断言测试

## 8. 收尾

- [ ] 8.1 npm run build && npm test && npm run test:contract && npm run lint:architecture
  验证：全部通过
- [ ] 8.2 openspec validate --strict
  验证：通过
- [ ] 8.3 Code review
  验证：$nextagent-code-review PASS

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的归档前更新基线处理：
- 同步 openspec/specs/workflow-contracts/spec.md（WorkflowExecutionEvent input 字段）
- 同步 openspec/specs/workflow-execution-engine/spec.md（Event Emission requirement）
- 按需更新 openspec/designs/modules/agent-workflow.md
- 按需更新 openspec/designs/spec-to-design-map.md
