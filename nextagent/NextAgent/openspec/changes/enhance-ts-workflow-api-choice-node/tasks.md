## 1. 路径入口控制

- [ ] 1.1 实现 `open_api_recall` 开关读取和路径分流：false/空走纯大模型路径，true 走 RAG 召回路径
  验证：集成测试覆盖两条路径
  来源：spec requirement `Path Entry Control`

- [ ] 1.2 `open_api_recall=false` + `candidateApis` 为空时报错终止（`WORKFLOW_API_CHOICE_NO_CANDIDATES`）
  验证：集成测试覆盖报错场景
  来源：spec scenario `No RAG No Candidates`

## 2. Prompt 配置（复用 LLM 节点机制）

- [ ] 2.1 复用 `prepareLlmPrompt` + `n()` 实现三路 Prompt 优先级：`top1_choice_prompt` > `api_choice_prompt_template_name` > 默认标签 `API_CHOICE`
  验证：单元测试覆盖三路优先级和 fallback
  来源：design D2

- [ ] 2.2 Prompt 变量替换：复用模板引擎 `n()` 的变量替换语法
  验证：单元测试覆盖变量替换和循环拼接
  来源：spec requirement `Pure LLM N-Select-1`

- [ ] 2.3 不开启 RAG 且无 Prompt 可用时报错终止（`WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE`）
  验证：集成测试覆盖报错场景
  来源：spec scenario `No Prompt No RAG`

## 3. 知识召回路径

- [ ] 3.1 将 `rag_index` 按 `indexType` 分为 API 类和 Knowledge 类两组
  验证：单元测试覆盖分组逻辑
  来源：design D3

- [ ] 3.2 实现 `open_api_knowledge_recall=true` 时的知识召回：Knowledge 类索引并行检索
  验证：集成测试覆盖双路召回
  来源：spec requirement `Knowledge Recall`

- [ ] 3.3 知识内容拼接为字符串，写入 `knowledge` 输出变量
  验证：集成测试验证 `knowledge` 输出
  来源：spec scenario `Knowledge Recall Enabled`

- [ ] 3.4 知识召回结果为空时报错终止（`WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY`）
  验证：集成测试覆盖空结果报错
  来源：spec scenario `Knowledge Recall Empty`

## 4. TopN 选 1 优化

- [ ] 4.1 RAG 召回仅 1 条时直接使用 API 名称，不调用大模型
  验证：集成测试验证单条结果跳过大模型
  来源：design D4、spec scenario `Single Recall Result`

## 5. 追问机制（复用 restful-param-extract 同形同策）

- [ ] 5.1 实现 open_reflection=true 时在 prompt 中添加 NEED_MORE_KEY 追问指引（与 restful-param-extract 同形同策）
  验证：单元测试覆盖 prompt 拼接
  来源：design D5、spec requirement Follow-up Question

- [ ] 5.2 大模型返回 NEED_MORE_KEY 时抛出 WORKFLOW_API_CHOICE_FOLLOW_UP 异常
  验证：集成测试
  来源：spec scenario Follow Up Question
## 6. 模型路由透传（复用已有机制）

- [ ] 6.1 复用 `resolveModelForParamExtract(request, model, modelGroup)` 读取节点级 `model`/`modelGroup` 参数覆盖全局配置
  验证：单元测试覆盖参数读取
  来源：spec requirement `Model Routing Passthrough`

- [ ] 6.2 `model_params` 合并到 `ModelCommonOptions`，节点级覆盖全局
  验证：集成测试验证透传
  来源：design D6

## 7. 中间步骤事件

- [ ] 7.1 通过 `emitOutputDelta` + `metadata.step` 产出 `step: "rag_recall"` 中间步骤事件
  验证：集成测试验证事件产出
  来源：spec requirement `Intermediate Step Events`

- [ ] 7.2 产出 `step: "rating"` 中间步骤事件
  验证：集成测试
  来源：spec requirement `Intermediate Step Events`

- [ ] 7.3 产出 `step: "llm_reasoning"` 中间步骤事件
  验证：集成测试
  来源：spec requirement `Intermediate Step Events`

## 8. Think 标签移除（Opt-in）与输出完善

- [ ] 8.1 仅当 `remove_think_tags: "true"` 时，提取 API 名称前移除 think 标签；默认不移除
  验证：单元测试覆盖两种场景
  来源：design D8、spec requirement `Think Tag Removal (Opt-in)`

- [ ] 8.2 将 think 标签移除逻辑提取为 `shared.ts` 工具函数
  验证：单元测试
  来源：design D8

- [ ] 8.3 RAG 路径补齐 `knowledge_diagnostic` 输出（来源 `WorkflowKnowledgeRetrievalResult.status` + `diagnosticReason`，与 `knowledge-search` / `recipe-choice` 同形同策）
  验证：集成测试
  来源：design D9

## 9. 验证

- [ ] 9.1 Integration test：不开启 RAG 时 `top1_choice_prompt` 正确传入大模型
  验证：`npm test`
  来源：验证入口

- [ ] 9.2 Integration test：`open_api_recall=true` 时走 RAG 召回 + TopN 选 1
  验证：`npm test`
  来源：验证入口

- [ ] 9.3 Integration test：`open_api_knowledge_recall=true` 时双路召回，`knowledge` 输出非空
  验证：`npm test`
  来源：验证入口

- [ ] 9.4 Integration test：`open_reflection=true` 时 `NEED_MORE_KEY` 追问异常正确抛出
  验证：`npm test`
  来源：验证入口

- [ ] 9.5 Integration test：节点级 `model_params` 透传到模型调用
  验证：`npm test`
  来源：验证入口

- [ ] 9.6 Integration test：中间步骤事件 `step: "rag_recall"` / `"rating"` / `"llm_reasoning"` 正确产出
  验证：`npm test`
  来源：验证入口

- [ ] 9.7 Architecture test：`api-choice` 不引入 dispatch、sub-recipe 执行或 restful side effect
  验证：`npm run lint:architecture`
  来源：边界对齐

- [ ] 9.8 Regression test：已有 `api-choice` 测试全部通过（向后兼容：`open_api_recall` 为空时保持现有隐式判断行为）
  验证：`npm test`
  来源：向后兼容

- [ ] 9.9 Integration test：`open_api_recall=false` + `candidateApis` 为空报错（`WORKFLOW_API_CHOICE_NO_CANDIDATES`）
  验证：`npm test`
  来源：spec scenario `No RAG No Candidates`

- [ ] 9.10 Integration test：默认不移除 think 标签，`remove_think_tags: "true"` 时移除
  验证：`npm test`
  来源：spec requirement `Think Tag Removal (Opt-in)`