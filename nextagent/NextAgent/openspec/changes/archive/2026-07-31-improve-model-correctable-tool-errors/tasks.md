# Tasks: Improve model-correctable Tool errors

## 1. 通用 JSON Schema 诊断

- [x] 1.1 为 required、type、additional-property、range、
  enum 和 array 边界失败新增黑盒测试，包括 JSON 编码的对象输入和原始
  值不泄漏 canary。
- [x] 1.2 在 `agent-capability` 中新增 provider 中立的有界 Ajv 诊断格式化器；
  为 output/config 调用方保留 `validateJson(...)`，
  只在 Tool 输入边界使用详细结果。
- [x] 1.3 更新 `BuiltinToolsExecutor` 以返回详细的 safe message，同时
  保留既有 code/category/retryable 行为，且不引入按 Tool 名称的
  分支。

## 2. Builtin 语义校验诊断

- [x] 2.1 为当前消息泛化的 Skill、workspace
  文件 Tool、Glob、Grep、Python、Agent、ToolSearch 和 Workflow 输入失败新增聚焦负向测试。
- [x] 2.2 用稳定的按字段或按约束的 message 替换泛化的
  模型可纠正校验消息；保留已经可操作的消息，
  并使授权、策略、内部、来源、路径和
  输出校验细节保持粗粒度。
- [x] 2.3 新增纠正循环 characterization 测试，证明失败的 Tool
  结果暴露 `errorMessage`，且随后的纠正调用
  无需基础设施自动重试即可成功。

## 3. 安全与回归验证

- [x] 3.1 新增不泄漏测试，覆盖 message、safeDetails 和模型可见
  capability-result payload 中的 secret/token canary、原始 query/content、
  路径、regex source 和未知属性值。
- [x] 3.2 运行聚焦的 `agent-capability` 和 `agent-core` 测试并记录精确
  结果。
- [x] 3.3 运行 `npm run build`、`npm test`、`npm run test:contract` 和
  `npm run lint:architecture`；在所需 CLI 可用时运行
  `openspec validate --all --strict`，否则记录明确的工具阻断项。

## 验证证据

- 聚焦 capability/core 回归：12 个文件通过；181 个测试通过，7 个
  既有平台特定测试被跳过。
- `npm run build`：通过，包括 TypeScript project references 和 workbench
  生产构建。
- `npm test`：103 个文件通过；849 个测试通过。
- `npm run test:contract`：34 个文件通过；295 个测试通过。既有的 Fastify
  override 和 listener-count 警告保持非致命。
- `npm run lint:architecture`：dependency-cruiser 和 package-manifest 策略
  通过；架构 Vitest 报告 214 通过、1 个失败，位于
  `runtime-logging-boundary.test.ts`。该失败指名了本 change diff 之外的
  两个遗留 acquisition owner：
  `packages/agent-app/src/composition/workflow-composition.ts` 和
  `packages/agent-workflow/src/engine/index.ts`。
- `npx --yes @fission-ai/openspec@1.6.0 validate --all --strict`：218 个
  OpenSpec changes/specs 通过，包括 `improve-model-correctable-tool-errors`。
