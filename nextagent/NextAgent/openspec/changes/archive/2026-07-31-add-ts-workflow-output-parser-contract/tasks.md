## 1. output_parser 不投影

- [x] 1.1 `projectNodeOutputs` 中当 key 为 `output_parser` 时跳过投影
  验证：单元测试断言 `output_parser` 不出现在 projected result 中
- [x] 1.2 当 `outputs` 为空或 undefined 时，`output_parser` 过滤逻辑不影响原有行为
  验证：单元测试断言空 outputs 返回 bindings 不变

## 2. resolveOutputParser 新增 outputs.output_parser 来源

- [x] 2.1 `WorkflowRuntimeEventProjector.resolveOutputParser` 新增 `node.outputs.output_parser` 作为第三个来源
  验证：单元测试断言 `outputs.output_parser.show_title: false` 抑制 NODE_STARTED 的 TITLE structured delta
- [x] 2.2 `outputs.output_parser` 优先级低于 `presentation.outputParser` 和 `node.outputParser`
  验证：当 `node.outputParser` 存在时，`outputs.output_parser` 被忽略
- [x] 2.3 `readDisplayOutputType` 和 `readDisplayLevel` 也从 `outputs.output_parser` 读取
  验证：DISPLAY 节点配置 `outputs.output_parser.type` 和 `outputs.output_parser.level` 时正确生效
- [x] 2.4 `readWorkflowOutputSchema` 也从 `outputs.output_parser` 读取 schema/outputSchema
  验证：LLM 节点配置 `outputs.output_parser.schema` 时正确读取

## 3. serializeOutput 格式化

- [x] 3.1 单参数 output 直接返回 value，不包含 key
  验证：单元测试断言 `{answer: "诊断完成"}` 序列化为 `诊断完成`
- [x] 3.2 多参数 output 用 `\n` 拼接 value
  验证：单元测试断言 `{name: "Cell-3", status: "alarm active"}` 序列化为 `Cell-3\nalarm active`
- [x] 3.3 空 output 返回空字符串
  验证：单元测试断言 `{}` 序列化为 `""`
- [x] 3.4 number/boolean value 使用 `String(value)`
  验证：单元测试断言 `{count: 42}` 序列化为 `42`

## 4. 收尾

- [x] 4.1 `npm test` 全部通过
  验证：2026-07-30 根目录测试通过 125 个文件、1161 个测试
- [x] 4.2 `npx tsc --noEmit` 无类型错误
  验证：类型检查通过
- [x] 4.3 Code review
  验证：2026-07-30 `$nextagent-code-review` PASS
