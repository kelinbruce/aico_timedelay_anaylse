# workflow
我要基于/ADNClaw/openspec/changes/路径下的3个workflow相关的引擎设计进行workflow中具体的节点功能的开发，全部设计内容基于typescript语言设计。
workflow的执行依赖全局参数ProcessContext的传递，ProcessContext的字段定义如下：

export interface ProcessContext {
  activityId: string; // 节点名称
  variables: HashMap<string, object>; // 全局流程变量
  input: HashMap<string, object>; // 本节点的输入
  currentVariables: HashMap<string, object>; // 本节点输入和全局变量
  output: HashMap<string, object>; // 本节点输出，执行完成后替换最新值，合并写入variables
  executedParams: HashMap<string, object>; // 已提取的参数，如api节点的参数提参
  processStatus: ProcessStatus;
  taskInstance: object; // 本次workflow运行的实例
  recipe: Recipe; // workflow的DSL的对象定义
  recipeNodeMap: HashMap<string, object>; // workflow node的名称及节点对象的Map
  currentNode: object; // 当前节点的Node对象定义
  exception: object; // 异常对象
  startTime: number;
  spanLog: string; // log记录
  isLastNode: boolean;
  isLoopNode: boolean;
  isLastLoop: boolean;
};

export Enum ProcessStatus {
  NORMAL = 'NORMAL',
  EXCEPTION = 'EXCEPTION',
  STOP = 'STOP'
};

所有workflow的节点都需要继承自BaseNode，BaseNode需要做的主要内容如下：
1、BaseNode中具备三个核心方法：
1）方法1：节点执行前处理,主要用于将工作流传入的上下文提取数据并准备成节点执行所需要的ProcessContext，定义如下：
   fuction beforeExecution (context: object): ProcessContext {}
内部的关键步骤如下：
step1: 初始化ProcessContext
step2: 检查执行任务和执行上限
step3: 初始化taskInstance实例
step4: 缓存推荐问题

2) 方法2: 节点执行, 接收执行的入参，执行过程中更新入参各项数据并返回，定义如下：
   function execute (processContext: ProcessContext): ProcessContext {}
   
3）方法3: 节点执行后处理, 定义如下：
   function afterExecution (context: ProcessContext): void
内部的关键步骤如下：
step1: 更新任务实例状态
step2: 异常检查与处理
step3: 节点输出处理
step4: 发送消息给会话 // workflow执行在流式对话中，发送流式消息
step5: 检查下一节点
step6: 循环处理
step7: 更新全局变量

2）BaseNode中还要增加两个主要能力点
能力点1: 异常处理，含异常处理分类、节点异常跳转、错误消息发送，异常情况考虑如下

异常类型                处理方法                     任务状态  处理逻辑
APICheckException       handleApiCheckException()    PAUSE   发送参数校验消息，等待用户补充参数
RecipeInterruptException handleRecipeInterruptException() PAUSE 发送中断消息，暂停任务
PauseException          handlePauseException()       PAUSE   暂停任务
UnsafeException         handleUnsafeException()      UN_SAFE 发送不安全警告
QuestionRewritingException handleQuestionRewritingException() FAILED 发送完成消息，任务失败
MemoryRestfulException  handleMemoryRestfulException() FAILED 外部服务调用失败
BaseException           handleBaseException()        FAILED  通用业务异常
其他 Exception          handleCommonException()      FAILED  通用异常

能力点2: 工具方法，含参数校验与补全、API路径拼接、Annotation初始化（到具体节点设计及执行时可再考虑细化设计）


接下来将基于BaseNode的继承，实现各workflow的节点功能
## 基于llm驱动的节点设计，功能名称：add-ts-workflow-llm-nodes
### llm-router节点
节点功能：实现大模型的调用执行
取值部分：
const inputsMap = processContext.getVariables();
// 关键参数
const promptTemplate = MapUtils.getString(inputsMap, RecipeKeyConstant.PROMPT_TEMPLATE);
const promptTemplateName = MapUtils.getString(inputsMap, RecipeKeyConstant.PROMPT_TEMPLATE_NAME);
const inputQuestion = MapUtils.getString(inputsMap, RecipeKeyConstant.INPUT_QUESTION);
const isStream = Boolean(MapUtils.getString(inputsMap, RecipeKeyConstant.IS_STREAM));
const openGuardrail = MapUtils.getString(inputsMap, RecipeKeyConstant.OPEN_GUARDRAIL);
const scenarioKey = inputsMap.get(RecipeKeyConstant.SCENARIO_KEY) as string;

节点主要实现逻辑：
step1: 从input参数中取promptTemplate或者promptName，如果是promptName则需要从数据库中取promptTemplate
step2: 取input参数中取用户的输入问题
step3: 取input参数中的是否流式输出的变量
step4: 遍历input的所有输入，将其与promptTemplate的缺省槽位值进行比对替换
step5: 调用模型进行流式或者非流式执行
step6: 设置调用结果到processContext

备注：input中的各个变量key值都有在RecipeKeyConstant固定的枚举字段，后续我将补全该Enum类型

### intent-recognition节点
节点功能：1）实现意图识别，返回用户意图列表；2）异步调用问题推荐接口，生成推荐问题，写入processContext
节点取值：
const inputsMap = processContext.getVariables();
const agentName = HttpHeaderUtil.getAgentName(headersMap);
const inputQuestion = getInputQuestion(inputsMap); // 先取重写后的问题，没有则用原始问题
const domain = MapUtils.getString(inputsMap, RecipeKeyConstant.DOMAIN);

节点主要实现逻辑：
1、先从数据库加载该Agent下的所有意图规则
2、根据匹配模式（any仅需匹配上一个、must必须全部匹配、not包含任意一个即失败），null时则直接通过，进行意图匹配
3、匹配失败后则使用IntentRecognitionTool工具提取
4、返回提取结果：
{
      intent_result: ["意图1", "意图2"],
      intent_type: "CLEAR/AMBIGUOUS/...",
      intent_list: [...] // 意图列表
  }

  日志:
  LOGGER.info("Intent recognition, intentMatchRule matched, intent result is {}", ...);
  LOGGER.info("Intent recognition, intent type is {},intent result is {}", ...);

  异常处理: 依赖 BaseNode 统一处理
### question-writing节点
节点功能：结合上下文对问题实现改写
取值部分：
const inputsMap = processContext.getVariables();
const question = MapUtils.getString(inputsMap, RecipeKeyConstant.INPUT_QUESTION);
const chatId = MapUtils.getString(inputsMap, RecipeKeyConstant.AIAGENT_KW_CHAT_ID);
const conversationId = MapUtils.getString(inputsMap, RecipeKeyConstant.AIAGENT_KW_CONVERSATION_ID);
const contextRound = MapUtils.getIntValue(inputsMap, RecipeKeyConstant.CONTEXT_ROUND);
const language = MapUtils.getString(inputsMap, RecipeKeyConstant.LOCAL_LANGUAGE, "zh");
const agentName = HttpHeaderUtil.getAgentName(headersMap);

节点主要实现逻辑：
1. 构建问题重写参数DTO
2. 执行问题改写方法（内部调用大模型）
3. 检查返回结果是否含askQuestion，如果含表明需要追问，抛出QuestionRewritingException
4. 重写后的问题写入processContext：processContext.setVariable(RecipeKeyConstant.REWRITTEN_INPUT_QUESTION, ...)

  返回数据格式:
  // outputs
  {
      rewritten_input_question: "重写后的问题"
  }

  日志:
  LOGGER.error("invalid dialogue state result, the chat stop, chatId : {}", chatId);

  异常处理:
  - 抛出 QuestionRewritingException，由 BaseNode 处理为 FAILED 状态
  - 如果启用了翻译，会先翻译再抛出异常

### translate节点
节点功能：实现翻译功能
取值部分：
const inputsMap = processContext.getVariables();
const chatId = MapUtils.getString(inputsMap, RecipeKeyConstant.AIAGENT_KW_CHAT_ID);
const agentName = HttpHeaderUtil.getAgentName(headersMap);
const translationInput = MapUtils.getString(inputsMap, TRANSLATION_INPUT);
const direction = MapUtils.getString(inputsMap, TRANSLATION_DIRECTION);
const type = MapUtils.getString(inputsMap, RecipeKeyConstant.TRANSLATION_TYPE);

执行的关键步骤:
  1. 检查 translationInput 是否为空
  2. 检查 direction（inbound=译入，outbound=译出）
  3. 根据 type 选择翻译方式：
    - small_model: 调用 translationService.translate() 使用小模型翻译
    - large_model: 调用 executeLargeModelTranslate() 使用大模型翻译
  4. 解析翻译结果，设置到 context
  5. 如果是 inbound，更新 Memory 中的扩展信息
  6. 如果是 outbound，设置任务的翻译标记

  返回数据格式:
  // outputs
  {
      translation_result: "翻译结果",
      translation_infer_result: "推理结果",
      input_language: "源语言",
      output_language: "目标语言" // inbound 时有
  }

  日志:
  LOGGER.error("TranslationNode: translation_input is empty");
  LOGGER.info("model route req is {}", ...);
  LOGGER.info("model route result is {}", ...);
  LOGGER.info("prompt req is {}", ...);

  异常处理:
  - 内部调用 exceptionHandle() → checkNodeExceptionHandler() + 抛出 AiAgentException

### data-analysis节点
节点功能：根据用户问题+数据分析Prompt，由大模型调用后生成对应的Python代码（含参数定义及参数值，放在代码最前面，由大模型提取），并执行返回结果，实现数据分析

执行的关键步骤：
  1. 用户问题+数据分析Prompt，合成调用模型前的最终Prompt
  2. 如果Prompt超长需要对其压缩
  3. 执行大模型调用，获取最终生成的工具调用代码（python形式，含参数定义及参数值，放在代码最前面）
  4. 沙箱执行python代码
  5. 返回python执行代码

  日志:
  LOGGER.error("chatId: {}  model action error: {}", chatId, errorMessage);

  异常处理:
  - UnsafeException → 发送错误消息，状态设为 UN_SAFE
  - BaseException → 调用 checkNodeExceptionHandler() + 抛出 AiAgentException

### param-extract节点
节点功能：实现API参数提取
取值部分:
  Map<String, Object> inputsMap = processContext.getVariables();
  String apiName = MapUtils.getString(inputsMap, RecipeKeyConstant.API_NAME);
  // 目标API的参数定义

  执行的关键步骤:
  1. 获取目标 API 参数定义
  2. LLM 提取参数
  3. 参数校验
  4. 返回提取的参数

  返回数据格式:
  // outputs
  {
      extracted_params: {
          param1: "value1",
          param2: "value2"
      }
  }

  日志:
  LOGGER.info("extract params for api: {}", apiName);
  异常处理: 抛出 APICheckException → BaseNode 处理 (PAUSE)
## 流控网关节点设计，功能名称：add-ts-workflow-gateway-nodes
该部分节点不继承BaseNode，因为不做任何的业务执行，但是与workflow引擎的设计息息相关
### start-event节点
节点功能：该节点不做任何执行，仅在workflow开始存在，所有的执行流程都会从该节点发起且唯一

### end-event节点
节点功能：该节点不做任何执行，仅在workflow结尾存在，所有的执行流程都会汇聚到该节点且唯一

### parallel-gateway节点
节点功能：并行网关，该节点不做任何的业务执行，仅控制流程流转方向，属于引擎自身能力
入口行为：等待所有分支到达，然后并行触发所有的输出分支
出口行为：所有输出分支同时执行，不等待其他分支完成
典型场景：并行执行多个独立任务，如同时调用多个API

### exclusive-gateway节点
节点功能：排他网关，该节点不做任何的业务执行，仅控制流程流转方向，属于引擎自身能力
入口行为：等待一个输入分支到达
出口行为：从多个输出分支中选择一条满足条件的执行
默认分支：如果所有条件都不满足，则使用默认分支
典型场景：根据条件选择不同的处理路径，如错误处理分支

## 能力节点设计，功能名称：add-ts-workflow-capability-nodes
### tool节点
节点功能：执行tool工具，根据工具名称及所有的输入参数进行tool的调用执行并返回结果
取值部分：
const inputsMap = processContext.getVariables();
const toolName = MapUtils.getString(inputsMap, RecipeKeyConstant.TOOL_NAME, StringUtils.EMPTY);
const input = processContext.getInput();
执行的关键步骤:
  1. toolExecutor.executeTool(toolName, inputsMap, processContext) - 执行工具
  2. processContext.setVariable(RecipeKeyConstant.TOOL_RESULT, result) - 存入结果

返回数据格式:
  processContext.getOutput(); // 包含 TOOL_RESULT

日志:
  LOGGER.info("execute tool: {}", toolName);

异常处理: 依赖 BaseNode 统一处理### tool-choice节点
### restful节点
功能描述：Api节点调用执行，根据Api名称查询数据库中api的yaml定义，并提取Api入参参数并调用，支持长链接轮询和流式响应
取值部分：
const inputsMap = processContext.getVariables();
const apiName = MapUtils.getString(inputsMap, RecipeKeyConstant.API_NAME);
const apiGroup = MapUtils.getString(inputsMap, RecipeKeyConstant.API_GROUP);
const erReqHeaders = inputsMap.get(RecipeKeyConstant.ER_REQ_HEADERS) as Record<string, string>;
const executedParams = processContext.getExecutedParams(); // 已提取的参数
const chatType = String(processContext.getVariable(RecipeKeyConstant.CHAT_TYPE));
执行的关键步骤:
  1. setExecutedParams() - 设置已提取的参数
  2. getApiDo() - 根据 apiName 查询 API 定义
  3. structApiParams() - 组装请求参数
  4. recipeActionService.extractApiParam() - LLM 提取参数
  5. checkAndReplenishApiParam() - 参数校验与补全
  6. executeRestfulApi() - 执行 REST 调用
  7. 支持长链接轮询和流式响应

返回数据格式:
  // outputs
  {
      api_response: "API返回结果",
      api_resp_define: {...} // API响应参数定义
  }

日志:
  LOGGER.info("api group is : {}, api name : {} ", apiGroup, apiName);
  LOGGER.info("restful activityId:{}, agent:{}, defaultSingleOverTime:{}, defaultMaxTimeout:{}", ...);
  LOGGER.info("start struct api params, api name:{}. conversationId:{}.", apiName, conversationId);
  LOGGER.info("The task is not completed, but polling is stopped, api is {}", path);

异常处理:
  - API 不存在 → checkNodeExceptionHandler() + sendEr

### python节点
功能描述：执行Python代码的节点
取值部分：
const inputContents = processContext.getVariables();
const script = inputContents.get(RecipeKeyConstant.SCRIPT_TAG) as string;
const paramToJsonStr = MapUtils.getString(inputContents, RecipeKeyConstant.PARAM_TO_JSON_STR);
const currentNodeInputs = processContext.getCurrentNode().getInputs();
执行的关键步骤:
  1. 检查 script 是否为空，为空则调用 checkNodeExceptionHandler() + 抛出 AiAgentException
  2. getCodeParams() - 根据 paramToJsonStr 参数将输入参数转换为 Python 变量声明
  3. 拼接脚本：codeParams + script
  4. executePythonScript() - 调用沙箱执行 Python 脚本
  5. dealPythonResult() - 处理返回结果（支持 JSON 解析）

返回数据格式:
  // outputs
  {
      python_result: "执行结果 (自动解析为对象或列表)"
  }

日志:
  LOGGER.info("python script is : {}", script);

异常处理: 内部 try-catch，抛出 AiAgentException，依赖 BaseNode 统一处理

## RAG节点设计，功能名称：add-ts-workflow-knowledge-nodes
所有的Rag节点的共享组件：
  - IisTaskService: 执行 RAG 任务
  - IisNodeComponent: 获取 RAG API、参数验证、结果排序
所有的Rag节点的公共异常遵循统一处理原则
### knowledge-search节点
功能描述：
- 实现rag知识检索功能
- 支持问题改写 (query rewrite)、混合检索结果 (hybrid results)
- 对召回结果进行精排和优先级排序

取值部分：
const inputContents = processContext.getVariables();
// 主要输入
const query = inputContents.get("query"); // 用户问题
const ragIndex = inputContents.get("ragIndex"); // 知识库索引
const ENABLE_QUERY_REWRITE = inputContents.get("ENABLE_QUERY_REWRITE"); // 是否启用问题改写

处理逻辑：
1. 获取 RAG 接口 (KNOWLEDGE_SEARCH)
2. 验证并构建参数 IisNodeParam
3. 调用 ragTaskService.executeRagTask() 执行检索
4. 获取 KnowledgeRecallInfo 列表
5. 按精排得分 + 优先级排序
6. 返回知识文本列表

返回结果设置：
processContext.setVariable(RecipeKeyConstant.RECALL_RESULT, knowledgeRecallResult); // 带排序信息的完整对象
processContext.setVariable(RecipeKeyConstant.KNOWLEDGE_SEARCH_RESULT, knowledge); // 纯知识文本列表

日志记录：
// 成功
reportRagSuccess(spanLog, id, ragIndex, reRankScore);
CallChainUtil.reportMsg(spanLog, Constant.STATUS_CODE_OK);

// 错误
reportRagError(spanLog);
logger.error("no knowledge found! resp:{}", JsonUtils.toJSon(ragTaskRespList));

异常处理：
- 异常场景：retriever-klg api 不存在
处理方式：throw new AiAgentException ("recipe.api.not.found")
- 异常场景：响应为空
处理方式：throw new AiAgentException ("recipe.api.request.error")
- 异常场景：无知识召回结果
处理方式：throw new AiAgentException ("recipe.retriever.knowledge.response.empty")
- 异常场景：节点异常
处理方式：checkNodeExceptionHandler (processContext) + sendErrorMessage ()

### knowledge-qa节点
功能描述：
  - 检索 + LLM 总结：先召回知识，再让 LLM 对每条知识进行总结
  - 支持 FreeInfer（快速推理）
  - 支持节点循环输出追加
取值部分：
  Map<String, Object> inputsMap = processContext.getVariables();
  query = inputsMap.get("query")
  KNOWLEDGE_SEARCH_RESULT = inputsMap.get("KNOWLEDGE_SEARCH_RESULT")  // 如果前置有检索节点
  OPEN_FREE_INFER = inputsMap.get(RecipeKeyConstant.OPEN_FREE_INFER)
主要执行逻辑：
    1. 判断是否启用 FreeInfer → 直接返回 LLM 推理结果
    2. 调用 getKnowledge() 检索知识 (同 KnowledgeSearchNode)
    3. 遍历知识列表，对每条调用 LLM 总结
    4. getSummaryResult():
       - 构建 Prompt (summaryPrompt)
       - 模型路由 (ModelRouteService)
       - 调用 promptClient.modelInference()
       - 返回总结结果
    5. 设置输出变量
    6. 发送消息给用户
返回结果设置：
  processContext.setVariable(RecipeKeyConstant.KNOWLEDGE_SEARCH_RESULT, knowledgeList);  // 原始检索结果
  processContext.setVariable(RecipeKeyConstant.KNOWLEDGE_QA_RESULT, summaryResult);       // LLM 总结结果
  processContext.setVariable(RecipeKeyConstant.LLM_COMPLETION, messageAndAigcPair.getLeft());  // LLM 输出
日志记录：
  CallChainUtil.buildRecipeRagKnowledgeQa(...);  // 知识问答链路日志
  CallChainUtil.buildLLMMsg(...);                 // LLM 调用日志
  LOG.info("rewrite question result: {}", content);  // 问题改写结果
异常处理：
- 异常场景：retriever-klg api 不存在
处理方式：throw AiAgentException ("recipe.api.not.found")
- 异常场景：响应为空
处理方式：throw AiAgentException ("recipe.retriever.task.failed")
- 异常场景：LLM 调用 UnsafeException
处理方式：sendErrorMessage (UN_SAFE) + throw
- 异常场景：LLM 调用 BaseException
处理方式：sendErrorMessage ("recipe.model.error") + throw
  
### api-choice节点
功能描述：
  - 检索 + LLM 总结：先召回知识，再让 LLM 对每条知识进行总结
  - 支持 FreeInfer（快速推理）
  - 支持节点循环输出追加
取值部分：
  Map<String, Object> inputsMap = processContext.getVariables();
  query = inputsMap.get("query")
  KNOWLEDGE_SEARCH_RESULT = inputsMap.get("KNOWLEDGE_SEARCH_RESULT")  // 如果前置有检索节点
  OPEN_FREE_INFER = inputsMap.get(RecipeKeyConstant.OPEN_FREE_INFER)
主要执行逻辑：
    1. 判断是否启用 FreeInfer → 直接返回 LLM 推理结果
    2. 调用 getKnowledge() 检索知识 (同 KnowledgeSearchNode)
    3. 遍历知识列表，对每条调用 LLM 总结
    4. getSummaryResult():
       - 构建 Prompt (summaryPrompt)
       - 模型路由 (ModelRouteService)
       - 调用 promptClient.modelInference()
       - 返回总结结果
    5. 设置输出变量
    6. 发送消息给用户
返回结果设置：
  processContext.setVariable(RecipeKeyConstant.KNOWLEDGE_SEARCH_RESULT, knowledgeList);  // 原始检索结果
  processContext.setVariable(RecipeKeyConstant.KNOWLEDGE_QA_RESULT, summaryResult);       // LLM 总结结果
  processContext.setVariable(RecipeKeyConstant.LLM_COMPLETION, messageAndAigcPair.getLeft());  // LLM 输出
日志记录：
  CallChainUtil.buildRecipeRagKnowledgeQa(...);  // 知识问答链路日志
  CallChainUtil.buildLLMMsg(...);                 // LLM 调用日志
  LOG.info("rewrite question result: {}", content);  // 问题改写结果
异常处理：
- 场景：retriever-klg api 不存在
处理：抛出 AiAgentException，错误码 recipe.api.not.found
- 场景：接口响应为空
处理：抛出 AiAgentException，错误码 recipe.retriever.task.failed
- 场景：调用 LLM 触发 UnsafeException
处理：执行 sendErrorMessage (UN_SAFE)，再向上抛出异常
- 场景：调用 LLM 触发 BaseException
处理：执行 sendErrorMessage ("recipe.model.error")，再向上抛出异常
  
### recipe-choice节点
功能描述：
  - Recipe 召回：根据用户 query 从 Recipe 知识库中召回匹配的 Recipe
  - 类似于 KnowledgeSearchNode，但针对 Recipe 场景
取值部分：
  Map<String, Object> inputContents = processContext.getVariables();
  query = inputContents.get("query")
  ragIndex = inputContents.get("ragIndex")  // Recipe 索引
主要执行逻辑：
    1. 获取 RAG 接口 (RECIPE_RECALL)
    2. 构建参数 IisNodeParam
    3. 调用 ragTaskService.executeRagTask() 执行检索
    4. 获取 RecipeRecallInfo 列表
    5. 按精排得分 + 优先级排序
    6. 设置输出变量
返回结果设置：
  processContext.setVariable(RecipeKeyConstant.RECIPE_NAME, recipeRecallResult.get(0).getRecipeName());  // 第一个 Recipe 名称
  processContext.setVariable(RecipeKeyConstant.RECIPE_NAME_LIST, recipeNameList);  // Recipe 名称列表
  processContext.setVariable(RecipeKeyConstant.RECALL_RESULT, recipeRecallResult);  // 完整召回结果
日志记录：
  CallChainUtil.buildRagRecipeChoiceMsg(...);
  reportSuccessMsg(spanLog, recipeRecallInfos);  // 成功: 输出 Recipe 名称
  reportFailMsg(spanLog, "", Constant.STATUS_CODE_ERROR);  // 失败
  LOG.error("recipe not found!");
  LOG.error("retriever-recipe api response is empty, apiName is:{},", retrieverKlgApi.getName());
异常处理：
- 异常场景：retriever-recipe api 不存在
处理方式：throw AiAgentException ("recipe.retriever.api.not.exist")
- 异常场景：响应为空
处理方式：throw AiAgentException ("recipe.api.request.error")
- 异常场景：无 Recipe 召回结果
处理方式：throw AiAgentException ("recipe.not.exist")


## 用户交互与高级流控节点设计，功能名称：add-ts-workflow-interaction-nodes
### user-check节点
功能描述：
工作流执行过程中，当需要用户补全信息，或者需要根据工作流提供的选项让用户点选选项内容，需要使用该节点；用户补全的信息或选择的内容会用于后续的workflow工作流的执行
取值部分：
Map<String, Object> inputsMap = processContext.getVariables();
  String chatType = processContext.getVariable(RecipeKeyConstant.CHAT_TYPE).toString();
执行的关键步骤:
  1. taskRecordHandler.sendUserCheckMessage() - 发送用户确认消息
  2. throw new PauseException() - 暂停任务等待用户确认
返回数据格式:
  // outputs
  {user_check_result: "用户确认结果"}
日志:
  LOGGER.info("node:{} ,chat:{} user check append continue.", nodeName, chatId);
  LOGGER.info("chat:{} wait user check", chatId);
异常处理:
 直接抛出 PauseException，由 BaseNode 处理为 PAUSE 状态

### display-content节点
功能描述：展示节点，该节点不做任何的业务处理逻辑，只需要根据输入、输出的定义，将数据封装成输出的对象格式进行返回，用于前端展示
取值部分：
Map<String, Object> inputsMap = processContext.getVariables();
  Map<String, Object> inputs = processContext.getCurrentNode().getInputs();
  String tag = MapUtils.getString(inputsMap, "tag");
执行的关键步骤:
  1. 检查是否有 REJECT 标签
  2. 如果有 tag=REJECT，调用 setChatReject() 更新对话敏感级别
  3. 直接透传输出

返回数据格式:
  // outputs (直接透传)
  {}
日志: 无特殊日志
异常处理: 依赖 BaseNode 统一处理

### guardrail-check节点
功能描述：安全护栏校验节点，输入为一段文本，输出是否合格及校验信息
取值部分：
Map<String, Object> inputsMap = processContext.getVariables();
  String chatId = MapUtils.getString(inputsMap, RecipeKeyConstant.AIAGENT_KW_TASK_ID);
  String nodeName = processContext.getCurrentActivityId();
  Object guardrailInput = MapUtils.getObject(inputsMap, RecipeKeyConstant.GUARDRAIL_CONTENT);
  String guardrailTypeStr = MapUtils.getString(inputsMap, RecipeKeyConstant.GUARDRAIL_TYPE);
执行的关键步骤:
  1. 检查 guardrailInput 是否为空
  2. 获取 GuardrailTypeEnum（QUESTION/TOPIC/ANSWER）
  3. 从节点配置中获取 guardrailParams 参数
  4. 合并用户传入的参数和节点配置的参数
  5. guardrailService.check() - 调用安全校验服务
  6. 设置校验结果到 context

返回数据格式:
  // outputs
  {
      guardrail_result: true/false,
      guardrail_response: {...} // 校验响应详情
  }

日志:
  LOGGER.error("guardrail content is empty, chatId: {}, node: {}", chatId, nodeName);
  LOGGER.info("guardrail custom parameters : {}", JsonUtils.toJSon(reqBody));

异常处理:
  - 内部调用 exceptionHandle() → checkNodeExceptionHandler() + sendErrorMessage() + 抛出 AiAgentException
### delay-gateway节点
功能描述：在workflow中仅作等待操作，即线程休眠等待特定事件后，再执行后续节点
取值部分：
Map<String, Object> inputsMap = processContext.getVariables();
  String delayTimeStr = (String) inputsMap.getOrDefault(RecipeKeyConstant.DELAY_TIME, "60");

执行的关键步骤:
  1. handleDelayTime() - 处理延迟时间（单位秒）
  2. ThreadUtils.sleepSeconds(delayTime) - 线程休眠等待

返回数据格式:
  // outputs (无特殊输出)
  {}
日志:
  LOGGER.info("Recipe handle {} start, delay time is {}s.", currentNodeId, delayTime);
  LOGGER.info("Recipe handle {} end.", currentNodeId);

异常处理: 
依赖 BaseNode 统一处理

### interrupt-gateway节点
功能描述：符合条件的状况下中断workflow的执行并抛出异常
取值部分：
Map<String, Object> inputsMap = processContext.getVariables();
  String chatType = String.valueOf(processContext.getVariable(RecipeKeyConstant.CHAT_TYPE));
  boolean interruptCondition = MapUtils.getBooleanValue(inputsMap, RecipeKeyConstant.INTERRUPT_CONDITION);
执行的关键步骤:
  1. 如果是 WAKE 类型的会话，直接返回（唤醒时结束当前节点）
  2. 检查 interruptCondition 是否为 true
  3. 如果满足中断条件，设置异常：processContext.setException(new RecipeInterruptException(...))
返回数据格式:
  // outputs
  {}

日志:
  LOGGER.info("Interrupt condition passed. This recipe node will be interrupted.");

异常处理:
  - 设置 RecipeInterruptException，由 BaseNode 处理为 PAUSE 状态
  - 也支持通过 inputHandle() 提前计算中断条件

### sub-recipe节点
功能描述：在workflow中执行子workflow的节点
取值部分：
  Map<String, Object> inputsMap = processContext.getVariables();
  String subRecipeId = MapUtils.getString(inputsMap, RecipeKeyConstant.SUB_RECIPE_ID);
执行的关键步骤:
  1. 查询子 Recipe 定义
  2. recipeDomain.selectById() - 获取 Recipe 配置
  3. taskExecutor.execute() - 异步执行子流程
  4. 等待子流程完成或直接返回
返回数据格式:
  // outputs
  {
      sub_recipe_result: "子流程执行结果",
      sub_recipe_status: "COMPLETE/FAILED"
  }
日志:
  LOGGER.info("execute sub recipe: {}", subRecipeId);

异常处理: 依赖 BaseNode 统一处理