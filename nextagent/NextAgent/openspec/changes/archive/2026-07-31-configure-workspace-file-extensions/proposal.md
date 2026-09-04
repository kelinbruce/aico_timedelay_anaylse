## 背景与问题（Why）

NextAgent 的 Read、Glob、Grep、Write、Edit 已按 Agent Scope 和 execution workspace 目录策略限制文件访问，但当前目录授权一旦允许某个目录，就允许其中任意后缀的文本文件。电信运维 Agent 常同时接触配置、脚本、密钥旁路文件、导出数据和诊断产物；仅靠目录隔离无法表达“可读取 `.log`/`.json`，但不可读取或修改 `.pem`/`.sh`”这类最小权限要求。若各 Tool 分别实现后缀判断，还会产生同类文件操作策略不一致、Glob/Grep 旁路泄露以及 Write/Edit 规则漂移。

需要在现有可信 Agent workspace file policy 中增加统一、可配置、fail-closed 的文件后缀授权，并由 capability-owned `WorkspaceFilePort` 对所有模型发起的文件操作统一执行。

## 变更范围（What Changes）

- 在可信 `AgentDefinition.workspaceFiles` 配置中为读取类和写入类操作分别新增 allowlist/denylist：`readAllowedExtensions`、`readDeniedExtensions`、`writeAllowedExtensions`、`writeDeniedExtensions`。
  - 条目必须是以 `.` 开头的小写 ASCII 文件后缀；按目标文件名的最终后缀精确匹配，例如 `.gz` 匹配 `archive.tar.gz`，`.tar.gz` 不作为单个后缀语义。
  - 每类操作按唯一顺序判定：命中 denylist 必须拒绝；未命中 denylist 且 allowlist 缺省时允许；allowlist 已配置时仅允许命中 allowlist 的后缀。denylist 始终优先于 allowlist。
  - 某类操作的 allowlist 和 denylist 均缺省时保持现有“所有后缀均可”的兼容行为；显式空 allowlist 表示该类操作不授权任何后缀。运维配置应使用明确的文本文件清单，例如 `.txt`、`.md`、`.yaml`、`.yml`、`.json` 和 `.log`。
  - 读取与写入策略互不隐式扩权；覆盖已有文件的 Write 和 Edit 除满足写入策略外，仍必须能通过读取策略建立既有 full-Read snapshot。配置不得由 Tool input、模型输出或客户端 metadata 扩权。
- 将已校验配置编译为 `agent-app` 私有的 Agent/version scoped policy，并通过 composition provider 注入 `WorkspaceFilePort`；运行期只从当前 Agent Scope 读取，不回退到默认 Agent 或全局静态配置，不修改 frozen `AgentWorkspaceFilePolicy`。
- Read、Glob、Grep 使用统一的有效读取后缀策略；Write、Edit 使用统一的写入后缀策略。Glob 不返回、Grep 不扫描未授权后缀，Read/Write/Edit 对未授权目标返回安全错误且不泄漏目标是否存在或内容。该拒绝是可恢复的 Tool observation，模型可在同一 Agentic loop 中选择其他文件或操作，不得把 request/run 直接推进为 terminal failure。
- 后缀校验发生在路径规范化和目标 root 解析之后、文件内容读取或写入之前；大小写和无后缀文件使用跨平台一致语义，禁止通过大小写、尾随点或多后缀路径旁路。
- 内部非 Tool Calling 文件操作（例如 Skill resource projection 和 capability result externalization）不受该策略阻止，但模型后续通过 Read/Glob/Grep 访问其产物时仍须满足读取后缀授权。
- 补充 Agent definition/parser/private policy compiler、WorkspaceFilePort、Agentic loop 及五个文件 Tool 的正向、负向、Agent Scope 隔离和兼容性验证。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `app-config-schema`: 增加可信 Agent workspace file extension allowlist/denylist 配置、格式校验、deny-first 优先级和缺省/空数组语义。
- `agent-package-assembly`: 将已校验后缀授权编译为 app-private Agent-scoped policy，并保持 accepted Agent/version 固化且 frozen assembly contract 不变。
- `read-tool`: Read 在读取前执行有效读取后缀授权。
- `glob-tool`: Glob 仅枚举有效读取后缀允许的文件。
- `grep-tool`: Grep 仅扫描有效读取后缀允许的文件。
- `write-tool`: Write 在创建或覆盖前执行写入后缀授权。
- `edit-tool`: Edit 在读取和替换目标前执行写入后缀授权。

## 影响范围（Impact）

- Contract/config：Agent definition/parser、app-private policy compiler 和默认 Agent 配置说明；不修改 frozen `AgentWorkspaceFilePolicy`。
- Runtime/capability：`agent-capability` 的 `WorkspaceFilePort` 是唯一策略执行 owner；Read/Glob/Grep/Write/Edit Tool descriptor 不接收新参数。
- 安全：减少 Agent 可见和可修改文件类型；拒绝结果不得暴露文件存在性、物理路径或内容。
- 兼容性：未配置新字段的 Agent 行为不变；启用限制后，依赖 `tool-results/*.txt`、Skill resources 或 generated Skill manifest 的模型读取/编辑流程需要显式授权对应后缀。
- 测试：增加 parser/compiler contract、五类 Tool 黑盒行为、大小写/无后缀/多后缀 negative case、跨 Agent policy cache 隔离及架构边界验证。
- 无 Web API、stream event、gateway persistence 或数据库 schema 变化。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/app-config-schema/spec.md`：增加后缀配置、格式、缺省和空数组语义。
- `openspec/specs/agent-package-assembly/spec.md`：增加 Agent-scoped 后缀授权的编译与消费约束。
- `openspec/specs/read-tool/spec.md`、`glob-tool/spec.md`、`grep-tool/spec.md`、`write-tool/spec.md`、`edit-tool/spec.md`：增加各文件操作的后缀授权行为和安全拒绝场景。

长期背景：
- `openspec/overview.md`：补充 execution workspace 文件类型最小权限目标。

设计视图：
- `openspec/designs/architecture/configuration-boundary.md`：补充可信 Agent 配置到 runtime-facing policy 的后缀授权流。
- `openspec/designs/modules/agent-capability.md`：补充 `WorkspaceFilePort` 统一执行后缀策略的职责与内部文件操作例外。
- `openspec/designs/modules/agent-app.md`：补充 Agent definition 校验和 assembly 编译落点。
- `openspec/designs/adr/workspace-file-extension-authority.md`：记录 allowlist/denylist、deny-first、最终后缀精确匹配、缺省兼容及内部操作例外的长期取舍。
- `openspec/designs/spec-to-design-map.md`：增加受影响 specs 到上述设计和验证入口的导航。

验证入口：
- Agent definition parser/compiler 单元与 contract 测试。
- Read/Glob/Grep/Write/Edit capability 黑盒测试及禁止旁路的 negative case。
- accepted Agent/version policy cache 隔离测试。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
