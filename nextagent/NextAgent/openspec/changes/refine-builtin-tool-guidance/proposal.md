## 背景与问题（Why）

当前模型可见的内生 Tool 描述分别形成于各 Tool 的实现阶段，跨 Tool 的选择规则、已知与未知目标判断、能力可见性判断和结果恢复原则分散且存在语义不对称。模型在电信运维诊断、配置核查和脚本执行任务中，可能仅因输入包含文件名就先调用 `Glob`，把已有 Python 脚本误交给 `Python`，或把未暴露的 Skill、Agent 和普通 Tool 混同处理。这些额外调用增加任务轮次，也可能丢失前序工具已经确认的完整路径。

部分描述还与当前实现不完全一致，例如 Bash 的实际命令权限由 composed sandbox policy 决定，Rag 的 provider status 会映射为不同 Tool outcome，Python timeout 不是普通成功结果，Bash background completion 不提供自动通知。模型需要看到与当前 schema、权限和结果状态一致的指导，而不是针对单个测试错例编写的窄化规则。

## 变更范围（What Changes）

- 为 `SYSTEM_PROMPT` 增加统一的 Tool 选择、前序结果复用和 outcome 处理规则，使共享约束只有一个主承载位置。
- 优化 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`Rag`、`Skill`、`Agent` 和 `ToolSearch` 的英文 model-visible description，使每个描述只承载自身功能域、权限、输入输出、硬前置条件和特有恢复语义。
- 仅在字段描述与实际 schema 或 runtime 行为不一致时修正 schema field description；不改变合法输入集合。
- 增加描述 contract 门禁，覆盖已知路径、名称搜索、内容搜索、脚本执行、知识检索、Skill/Agent 可见性、deferred capability discovery、降级和超时等正反场景。
- 将当前请求中已披露的 Skill/Agent 列表定义为 capability visibility 的权威事实，禁止用文件工具或 `ToolSearch` 重新发现已披露能力，并限制 execution view 空结果的证据范围。
- 增加最小调用与收敛后的并行原则；同一文件类别的多个扩展名可由一个受支持的 Glob pattern 覆盖时，只生成一次调用。
- **BREAKING**：无。Tool 名称、schema、执行权限、outcome mapping、gateway contract、持久化和 runtime lifecycle 均不改变。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-10.4 自定义工具和提示词`：修改其唯一主规格 `prompt-template-assembly`，使模型可见的统一 Tool guidance 与各 Tool descriptor 形成一致、可验证且不重复的选择和恢复契约。

## Feature 影响

- 无 Feature delta。用户价值和 Function 组成不变；本次仅提升既有工具调用指导的准确性、可维护性和任务完成效率。

## 影响范围（Impact）

- `agent-context-engine`：更新 builtin `SYSTEM_PROMPT` 的 tooling、workspace 和 delegation guidance；不修改 Agent disclosure 的渲染条件或文案。
- `agent-capability`：更新 11 个既有 Tool descriptor 以及必要的 schema field description。
- tests：新增统一 guidance contract test，并更新受影响的 Tool descriptor assertions。
- 不修改 `agent-contracts`、runtime lifecycle、sandbox authority、workspace path resolution、RAG gateway、Skill/Agent execution、ToolSearch activation 或持久化。
