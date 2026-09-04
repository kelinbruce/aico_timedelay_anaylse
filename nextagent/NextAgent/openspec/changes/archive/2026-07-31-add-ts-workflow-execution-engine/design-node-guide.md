# Workflow Node Design Manual

> Last updated: 2026-06-26

---

## 目录结构与产物

### 开发流程

recipe.yaml -> handler -> assets 目录 -> assets/

- handler: 负责解析输入 + 调用 + 绑定输出
- assets 目录: 为 assets/ 资源提供声明式引用
- assets/: 部署在 agents/{agentId}/recipes/assets/ 下

### assets 目录结构

agents/{agentId}/
  agent.yaml
  recipes/
    *.yaml
    assets/
      api-specs/{api_name}.json            <- RESTFUL
      prompts/{prompt_name}.txt            <- LLM_ROUTER
      rag-indexes/{index_name}/            <- KNOWLEDGE_SEARCH / API_CHOICE / RECIPE_CHOICE
      tools/{tool_name}.json               <- TOOL
      skills/{skill_name}/                 <- SKILL 能力目录

### handler 职责划分

| 环节 | handler 职责 | 引擎职责 |
|---|---|---|
| 变量解析 | resolveNodeValue | - |
| secret 变量解析 | resolveSecrets | - |
| 变量解析 -> 资产引用 | 资产引用求值 | 解析 assets |
| retry / timeout | 引擎统一处理 | 引擎处理 |
| 执行结果回填 | 节点输出绑定 | 引擎 |
| 输出脱敏 redact | 脱敏 resolvedSecretValues | - |
| API 调用 / HTTP 超时 | - | 资产解析 + provider 调用 |

## 节点类型总览

| 节点类型 | YAML type | 关键配置 | assets 引用 |
|---|---|---|---|
| RESTFUL | restful | api_name | api-specs/{name}.json |
| LLM_ROUTER | llm-router | prompt_template_name | prompts/{name}.txt |
| TOOL | tool | tool_name | tools/{name}.json |
| PYTHON | python | 内联 Python 代码 | 无 |
| AGENT | agent | agent_name | agent.yaml 引用 |
| TOOL_CHOICE | tool-choice | 复用 LLM 配置 | 无 |
| KNOWLEDGE_SEARCH | knowledge-search | rag_index.index_name | rag-indexes/{name}/ |
| API_CHOICE | api-choice | rag_index.index_name | rag-indexes/{name}/ |
| RECIPE_CHOICE | recipe-choice | rag_index.index_name | rag-indexes/{name}/ |
| KNOWLEDGE_QA | knowledge-qa | rag_index.index_name | rag-indexes/{name}/ |
| SUBFLOW | sub-recipe | recipe_name + is_node_record_with_recipe_result | 同 agent 的 recipes/ |

## 节点输出变量

| 节点 | 输出变量 | 类型 | 说明 |
|---|---|---|---|
| RESTFUL | api_response | JsonObject | capability 返回的 structuredPayload |
| RESTFUL | invocation_trace | JsonObject | 调用追踪信息 |
| LLM_ROUTER | llm_result | any | 路由结果及其解析产物 |
| SUBFLOW | sub_recipe_result | JsonObject | sub-recipe summary: recipe_name, executionId, status |
| SUBFLOW | recipe_result | JsonObject | sub-recipe node results map (when is_node_record_with_recipe_result=true) |
| LLM_ROUTER | input_question | string | 路由产出的追问文本 |
| TOOL | tool_result | JsonObject | capability 返回的 structuredPayload |
| PYTHON | python_result | JsonObject | 脚本执行结果 |
| AGENT | agent_result | JsonObject | 子 Agent 执行结果 |
| AGENT | child_chat_id | string | 子会话 ID |
| TOOL_CHOICE | tool_choice_result | object | 工具选择结果 |
| KNOWLEDGE_SEARCH | knowledge_search_result | array | 检索结果列表 |
| API_CHOICE | api_name | string | 选中的 API ID |
| RECIPE_CHOICE | recipe_name | string | 选中的 Recipe 名称 |
| KNOWLEDGE_QA | knowledge_qa_result | object | QA 应答结果 |

## 错误码总览

| 错误码 | 适用节点 | 触发条件 |
|---|---|---|
| WORKFLOW_NODE_INPUT_INVALID | RESTFUL/TOOL/PYTHON/AGENT | 输入变量校验失败 |
| WORKFLOW_CAPABILITY_BOUNDARY_UNAVAILABLE | RESTFUL/TOOL/PYTHON/AGENT | capability 边界不可用 |
| WORKFLOW_SECRET_RESOLUTION_UNAVAILABLE | RESTFUL | secret 解析服务不可用 |
| WORKFLOW_SECRET_RESOLUTION_FAILED | RESTFUL | secret 解析失败 |
| WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE | LLM/TOOL_CHOICE/KNOWLEDGE_QA | model 边界不可用 |
| WORKFLOW_LLM_BUDGET_EXCEEDED | LLM | prompt 超过 contextWindow |
| WORKFLOW_LLM_OUTPUT_INVALID | LLM | JSON 输出或 schema 校验失败 |
| WORKFLOW_GUARDRAIL_REJECTED | LLM | guardrail 拦截 |
| WORKFLOW_ENTRY_NODE_UNRESOLVED | engine | recipe 无法解析出有效 START |
| WORKFLOW_PARALLEL_GATEWAY_NO_MATCH / WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED | workflow-parallel-gateway | PARALLEL safe failure |

## 文件与模块归属

| 职责 | 文件 |
|---|---|
| capability-nodes.ts | RESTFUL/TOOL/PYTHON/AGENT/TOOL_CHOICE handler |
| llm-nodes.ts | LLM_ROUTER/INTENT_RECOGNITION/QUESTION_REWRITING/TRANSLATION/DATA_ANALYSIS/PARAM_EXTRACT |
| interaction-nodes.ts | DISPLAY/USER_CHECK/INTERRUPT/SUBFLOW/GUARDRAIL/DELAY |
| knowledge-nodes.ts | KNOWLEDGE_SEARCH/KNOWLEDGE_QA/API_CHOICE/RECIPE_CHOICE |
| nodes/index.ts | 节点注册入口 |
| nodes/shared.ts | 节点共享工具函数 |
| nodes/types.ts | 节点类型定义 |
| constants/recipe-key-constant.ts | RecipeKeyConstant |
| engine/index.ts | 引擎主流程 |
| agent-app/.../workflow-recipe-loader.ts | Recipe 加载 + Schema 校验 |
| agent-contracts/.../core/index.ts | 契约定义 |
| agent-common/.../index.ts | WorkflowNodeType 枚举 |

## 验证命令

npm run build              # TypeScript 编译
npm run test               # 81 tests
npm run test:contract      # Contract test
npm run lint:architecture  # dependency-cruiser
