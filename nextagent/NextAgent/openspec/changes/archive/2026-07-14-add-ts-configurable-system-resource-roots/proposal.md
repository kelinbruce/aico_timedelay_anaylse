## 背景与问题（Why）

本地部署需要把 NextAgent 指向运维方管理的 Agent 包、本地系统 Skill 目录和电信 RAG 索引集，而不修改代码或重新打包。当前 app config 已经从 `configRoot` 派生 `agentsRoot` 和 `systemSkillsRoot`，RAG 索引冻结在 `DefaultSystemConfig` 中，但源配置无法覆盖这些 root，也无法从环境变量加载 RAG 索引名。

## 变更范围（What Changes）

- `default-system.yaml` / 应用 overlay MAY 配置 `paths.agentRoot` 以选择本地 Agent 包根目录。
- `default-system.yaml` / 应用 overlay MAY 配置 `paths.skillRoot` 以选择本地系统 Skill 根目录。
- 内置 `default-system.yaml` 把默认 root 字段声明为 `paths.agentRoot: "agents"` 和 `paths.skillRoot: "skills"`；overlay 中省略 root 字段仍保持相同的派生默认值。
- `rag.indexes` MAY 在 app config 源边界以 `env:<NAME>` 形式提供。环境变量的值在 schema 校验之前解析，并归一化为既有的冻结 `readonly string[]` 形态。
- `RAG_INDEXES` 环境变量值支持逗号分隔的索引名，也支持 JSON 字符串数组，方便已经以结构化环境变量管理的部署。
- 若应用 overlay 中引用的环境变量未设置或为空，该 overlay 字段 SHALL 被忽略，既有的默认 `rag.indexes` SHALL 保持生效。
- 环境变量展开仍归 `agent-app/config` 所有；下游 runtime、core、model、capability、gateway 和 channel package 继续只消费冻结的配置值，不得解析原始环境变量或配置文件。

## 非目标（Non-Goals）

- 本 change 不新增客户端控制的路径覆盖。
- 本 change 不移动 Agent 拥有的 Skill root；`{agentRoot}/{agentId}/skills` 仍从所选 Agent 包根目录派生。
- 本 change 不新增 RAG 检索语义或 provider 端点。
- 本 change 不在模型可见 context、日志、metric、stream event 或 Web DTO 中暴露原始宿主路径或原始环境变量值。

## 影响范围（Impact）

- `agent-app/config`：扩展 app 私有的原始配置 schema、路径归一化和源环境变量解析。
- `packages/agent-app/config/default-system.yaml`：声明默认本地 root 字段，同时保持内置默认启动不依赖 `RAG_INDEXES`。
- 打包：本地运行包包含与配置的 `paths.agentRoot` 匹配的默认 `agents/default-agent/agent.yaml` 源树。
- 测试：聚焦的 config/assembly 测试覆盖环境变量 RAG 索引和可配置的本地 root 路径。
