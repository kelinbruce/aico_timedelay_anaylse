## 1. 模板引擎模块

- [ ] 1.1 在 agent-workflow/src/template-engine/ 中实现模板渲染引擎
  - 支持 for/endfor 循环语法
  - 支持 if/endif 条件语法（扩展真值判断：空数组/空对象/空字符串/0/null/undefined 为 falsy）
  - 支持 for/if 任意嵌套
  - 支持 ${var.path} 和 {{ var.path }} 双语法变量引用
  - 循环体内可引用循环变量和外部变量
  验证：UT for 循环展开、if 条件、空数组 falsy、嵌套 for/if、双语法变量、循环变量访问

- [ ] 1.2 实现安全限制
  - 循环最大迭代数 10，超限抛 TEMPLATE_LOOP_LIMIT_EXCEEDED
  - 未闭合标签抛 TEMPLATE_UNCLOSED_BLOCK
  - 未知语法抛 TEMPLATE_SYNTAX_ERROR
  验证：UT 超限、未闭合、语法错误均明确报错

- [ ] 1.3 暴露 renderTemplate(template, scope) 函数
  验证：导出检查 + UT

## 2. 流式/非流式双模式

- [ ] 2.1 LLM 节点根据 inputs.is_stream 字符串比较选择 stream() 或 complete()
  验证：Integration test is_stream="true" 走 stream，is_stream="false" 走 complete

- [ ] 2.2 默认流式判定：主 recipe（subRecipeDepth 未定义或为 0）+ 当前节点 next 指向 END
  - 不新增 context 字段，复用 executionMetadata.subRecipeDepth 和 recipe flowGraph 推断
  验证：Integration test 主 recipe 最后节点默认流式

- [ ] 2.3 子 recipe 内节点不触发默认流式
  验证：Integration test 子 recipe 最后节点走非流式

- [ ] 2.4 流式输出通过 emitOutputDelta 带 level 字段发送，复用 projector fast-path 走 TOOL_STRUCTURED_DELTA
  - content: emitOutputDelta({ channel: "CONTENT", content: delta, level: "ANSWER" })
  - reasoning: emitOutputDelta({ channel: "THINKING", content: delta, level: "DETAIL" })
  验证：Integration test 流式场景下前端收到 TOOL_STRUCTURED_DELTA

- [ ] 2.5 流式发送完毕后完整输出存入 llm_completion
  验证：Integration test 流式场景下 outputVariables.llm_completion 与非流式一致

## 3. llm_result 和 llm_completion 输出绑定

- [ ] 3.1 llm_result MUST 为完整模型原始输出对象：{ content, reasoning?, toolCalls?, finishReason?, usage? }
  - content 来自 parseWorkflowLlmPayload 结果
  - reasoning/toolCalls/finishReason/usage 来自 modelResult，有值时包含
  - 验证：Integration test llm_result 包含全部字段

- [ ] 3.2 llm_completion 默认只包含 content，result_with_think="true" 时包含 reasoning
  - 未配置或 result_with_think="false" -> tryParseJsonContent(content)（只有 content）
  - result_with_think="true" 且 reasoning 存在 -> { content, reasoning }
  - content 自动 JSON.parse（先 stripJsonFence）
  - 验证：Integration test 默认不含 reasoning、result_with_think=true 含 reasoning

- [ ] 3.3 迁移现有引用 ${llm_result} 期望 content 的测试到 ${llm_completion}
  - llm_result 从“content”变为“完整对象”，直接引用得到包装对象
  - 验证：全量 UT 回归通过

## 4. Prompt 生成流程

- [ ] 4.1 prompt_template 从 context.node.inputs 原始值读取，经模板引擎渲染后作为 systemPrompt
  - 不从 resolvedInputs 读取，避免  被提前替换
  - userPrompt 保持现有逻辑，不经过模板引擎
  验证：Integration test 含 for/if 的 prompt_template 正确渲染

- [ ] 4.2 prompt_template_name 从 context.node.inputs 原始值读取名称，查模板库后经模板引擎渲染
  - 两层渲染：assemblePrompt 替换 {{agentId}} 等 agent 元信息，模板引擎替换  workflow 变量
  - 模板库内容引用 workflow 变量必须使用  语法
  验证：Integration test 模板库内容含  变量时正确渲染

- [ ] 4.3 均空时使用 context.variables 的 query/question 作为 userPrompt
  - userPrompt 不经过模板引擎渲染
  验证：Integration test userPrompt 为 query 值，无 systemPrompt

## 5. 集成与架构验证

- [ ] 5.1 全量 UT 通过
  验证：npx vitest run packages/agent-workflow/tests/

- [ ] 5.2 Architecture lint 通过
  验证：npm run lint:architecture

- [ ] 5.3 不影响非 workflow 场景
  验证：npx vitest run packages/agent-core/tests/ + packages/agent-channel-common/tests/