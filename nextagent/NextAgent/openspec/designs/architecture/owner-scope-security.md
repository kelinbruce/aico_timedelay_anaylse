# Owner Scope 和安全边界

## 核心结论

Owner scope 是 `tenantId` 和 `subjectId` 的组合语义，不引入独立 owner scope DTO。所有需要归属边界的 DTO 必须显式使用 `tenantId` 和 `subjectId`。Channel/auth boundary 解析当前身份；请求体、客户端 metadata、模型输出或 capability args 中的 owner 字段不得覆盖当前身份。

## Identity 传播

当前身份由可信 channel/auth boundary 注入，进入 runtime command 后贯穿：

- runtime lifecycle
- session/message/read model
- attachment metadata/status
- context assembly
- memory retrieval 和 maintenance
- capability catalog 和 invocation
- gateway owner-scoped operation
- audit 和 observability correlation

Runtime 必须使用 `identityContext.tenantId` 和 `identityContext.subjectId` 校验 session、latest request、message 和 run 的 owner scope。长期记忆和 task trajectory 还必须同时携带并校验 trusted `agentId`；memory search/detail/write、task trajectory query/build、extraction、aging 和 revival 不得只按 owner scope 查询。任何跨 owner 或跨 agent 访问都不能依赖下游存储偶然过滤。

Local configured authentication 是 localhost-only local product entry 的 channel/auth boundary 实现。它只能由 `agent-app` local product bootstrap 显式装配，并在 Web/API/SSE/WS 进入业务 owner 前注入 trusted `IdentityContext`。认证失败不得进入 runtime request lifecycle，不产生 session、RequestRun、message、attachment、memory、pending input、checkpoint 或 capability invocation。客户端 body、query、header 或 metadata 中的 identity/owner 字段不得覆盖该 trusted identity。

## Safe Error

模块需要抛出可预期业务或系统错误时，必须使用 `AgentError`，或在离开当前 boundary 前映射为 `AgentError`/`SafeError`。`AgentError` 不得直接作为 API、stream、capability result、audit 或 log payload 序列化输出。

`SafeError` 必须包含：

- stable error code
- user-visible message
- category
- retryable

`SafeError` 不得暴露：

- cause 或 stack
- raw provider error
- raw secret 或 raw credential
- 未脱敏路径
- 未授权对象内容
- 未脱敏模型输入、工具输入或用户内容

## Secret 和 Redaction

`SecretReference` 只表达 credential source 引用，不承载原始凭据。Raw credentials 不得进入 config examples、stream payloads、messages、traces、logs、metrics、health details、safe error、audit event 或 capability metadata。

Active secret reference 必须在 startup configuration validation 阶段由 `agent-app` 的单一 resolver 检查可解析性，并转为 safe issue contribution。Operator-facing diagnostics、readiness、release evidence、log、trace、metric、audit、safe error 和 stream 不得输出完整 `env:` / `file:` reference、resolved secret、secret file content、完整路径、adapter-native error 或 stack。

Capability metadata、availabilityReason、safe diagnostics 和 provider error mapping 必须使用安全 reason code 或 safe summary。若某个 metadata key 被多个 provider 共同使用并影响行为，必须提升为显式核心字段或由后续 OpenSpec change 定义 typed extension。

## Sandbox 安全边界

shell、python、脚本和模型生成代码等动态可执行内容只能通过 sandbox gateway contract 执行。Capability、hook、policy 不得直接启动 shell、python 或脚本，不得直接依赖 PaaS sandbox SDK。

Sandbox gateway contract 覆盖：

- executable request
- working directory boundary
- sanitized environment
- timeout
- stdout/stderr limit
- exit code
- safe failure

## 验证入口

- owner scope contract tests
- safe error tests
- secret leakage scan
- sandbox gateway contract tests
- architecture boundary tests
- log redaction tests

## 受控例外：查看分享

查看分享路径是 owner scope 隔离原则的受控例外。系统用 `ConversationShareRecord` 中冻结的创建者三元 scope `(tenantId, subjectId, agentId)` 和 `agentId` 去查询 messages，而非查看者的 scope。

触发此跨 scope 读取的唯一凭证是不可猜测的 `shareId`（密码学安全随机生成）。读取范围 MUST 严格锁定在 `runIds` 快照中的 run，MUST NOT 扩散到 session 的其他 run 或其他 session。此例外只存在于"查看分享"只读路径，MUST NOT 传染其他主路径的数据访问逻辑。

此受控例外的安全保证基于：`shareId` 的不可预测性（密码学安全随机生成）、读取范围的严格锁定（只读 `runIds` 快照）、以及只读语义（不产生任何写操作）。分享查看不阻塞 request terminal commit、不改变 canonical timeline、不修改 active context。

`loadShare` 不携带 owner scope——`shareId` 是全局唯一的主键，任何人都可凭 `shareId` 加载分享记录。跨 scope 访问的安全性由 `shareId` 不可预测性保证。`deleteSharesBySession` 带 scope，只在创建者 scope 下清理。详见 ADR `openspec/designs/adr/owner-scope-controlled-exception-share-viewing.md`。
