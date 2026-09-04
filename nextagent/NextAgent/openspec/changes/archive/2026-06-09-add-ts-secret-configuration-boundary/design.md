## 背景和现状（Context）

当前代码已经存在一条可工作的 secret 路径：

- `agent-common` 拥有 `SecretReference`，只允许 `env:` / `file:`；
- `packages/agent-app/src/config/validation.ts` 校验 model profile 的 `credentialRef` 语法；
- `packages/agent-app/src/config/env.ts` 提供 `createAppCredentialResolver`；
- `packages/agent-app/src/composition/create-app.ts` 创建 resolver 并注入 `agent-model`；
- provider 在调用期通过注入 resolver 获取凭据，不读取源配置。

当前最小缺口是：active credential reference 尚未统一在 ready 前完成可解析性检查，secret 校验结果尚未以 app-config 的安全 issue contribution 形式统一汇总，负向泄漏验证也不完整。

## 黑盒目标（Blackbox Goal）

系统进入 ready 前，所有 active 已声明 credential reference 均已通过语法和可解析性校验，active required credential 字段也已通过 presence 校验。失败以安全 issue contribution 进入 app-config 的唯一 readiness 判定；raw secret、环境变量值、文件内容和本地 secret 路径不进入任何可见输出。

## 边界与 Owner

- 主 owner：`agent-app`
- 负责：credential-bearing entry 识别、启动期 secret 校验、resolver composition、safe issue contribution
- app-config 负责：criticality、viable set、最终 readiness state、`DefaultSystemConfig.configEvaluation` 和 `ConfigValidationEvidence`
- 各配置组 owner 负责：声明其 credential-bearing 字段、active/inactive 状态和是否 required
- observability/redaction 负责：守护输出边界，不参与配置读取、resolver 调用或 readiness 判定

本 change 不修改 `agent-contracts`，不新增跨 package secret DTO、secret snapshot 或 resolver public port。

## 唯一实施路径（Unique Implementation Path）

1. `agent-app` 使用现有 configuration loader 和 owning schema 得到 active/inactive entries；不得创建第二套 loader。
2. 各 owning schema 将 credential-bearing entry 投影为 app-internal validation input：
   - `entryRef`
   - `fieldRef`
   - `reference`
   - `referenceKind`
   - `active`
   - `required`
3. `agent-app` 使用现有 `SecretReference` grammar 校验 reference。
4. `agent-app` 创建单一 resolver 实例，并将同一实例用于：
   - ready 前 active reference 可解析性检查；
   - app composition 向 adapter/provider 注入。
5. Secret 校验只产生 app-internal safe issue contribution。它不判断 `READY`、`DEGRADED_READY`、`BLOCKED`，也不自行判定 criticality 或 viable set。
6. `add-ts-app-config-schema` 将 contribution 合并到 `DefaultSystemConfig.configEvaluation` 的 safe diagnostics，并生成最终 readiness state 与 `ConfigValidationEvidence`。
7. 下游继续通过固定窄投影和注入 resolver 消费：
   - model 使用由 `DefaultSystemConfig.modelProfiles` 构造的 restart-scoped `ModelProfileRegistry` 与 injected resolver；
   - gateway 使用 app-composed gateway port 与其 injected dependency；
   - capability 使用 capability catalog/provider registry 与其 injected dependency；
   - local auth 使用其 app-composed窄输入；
   - readiness/release 只消费 `ConfigValidationEvidence`。

禁止创建 `SecretUsageSnapshot`、`SecretReadinessState`、共享 `SecretValidationResult`、第二个 resolver 实例或源配置读取旁路。

## 触发机制与规则顺序

触发点固定为 startup/bootstrap 的 app configuration validation 阶段，同步发生在 ready publication、request submission 和 adapter 可用之前。它不属于 request lifecycle、后台 job、replay 或 stream reconnect。

固定顺序：

1. owning schema 确定 entry 的 active/inactive、required 和字段归属；
2. 校验 required credential 字段是否存在；
3. 校验 `SecretReference` grammar；
4. inactive reference 在 grammar 合法后停止，不要求当前可解析；
5. active reference 使用单一 injected resolver 检查可解析性；
6. 将结果转换为 app-internal safe issue contribution；
7. app-config 汇总所有配置贡献并判定最终 readiness；
8. 仅在 app-config 允许继续时完成窄投影冻结和 composition。

## 输入与输出

输入：

- owning schema 已确定的 app-internal credential validation input
- `agent-common.SecretReference`
- `agent-app` 创建的单一 resolver

输出：

- 成功：该 entry 不贡献 secret issue
- 失败：app-internal safe issue contribution，字段仅包含：
  - `issueCode`
  - `scope`
  - `fieldRef`
  - `referenceKind`
  - `safeMessage`

app-config 根据 owning schema 将 contribution 映射为 `DefaultSystemConfig.configEvaluation` 的 safe diagnostic，并补充 severity 与 readiness impact。secret contribution 不决定最终 readiness。输出不得包含完整 `secretReference`、raw secret、环境变量值、文件内容、完整路径、adapter-native error 或 stack trace。

## 可解析性和失败语义

- `env:`：目标变量必须存在且非空。
- `file:`：目标文件必须存在、可读且内容非空。
- missing、empty、unreadable、unsupported reference 和 resolver internal failure 必须转换为稳定 safe issue code。
- active reference 失败不得延迟到首个请求。
- inactive reference 当前不可解析不产生当前启动 blocker；grammar 非法仍作为配置 issue 交由 app-config 汇总。
- 本 change 不定义通用 resolver timeout。若 owning resolver 本身定义受控 timeout，其 timeout 失败按 resolver failure 转为 safe issue。

## 安全边界

- 原始 `SecretReference` 只保留在 `agent-app` 内部配置和各 owner 已定义的窄运行投影中。
- operator-facing diagnostics、readiness、release evidence、log、trace、metric、audit、safe error 和 stream 不得输出完整 `env:` / `file:` reference。
- resolved secret 只允许作为 injected resolver 的瞬时返回值进入目标 adapter/provider 调用，不得冻结、缓存为共享 snapshot、持久化或进入模型上下文。
- resolver 错误必须在 `agent-app` 校验边界或 adapter safe-error boundary 被安全映射。

## 存量增量路径

- 扩展现有 `packages/agent-app/src/config/validation.ts` 与 `system-config.ts`，不创建新的配置读取或校验框架。
- 复用并收紧 `packages/agent-app/src/config/env.ts` 的 resolver；确保安全错误不泄漏路径或内容。
- 保留 `packages/agent-app/src/composition/create-app.ts` 的 resolver 注入方式，并确保启动校验与 adapter 注入复用同一实例。
- 将 secret issue contribution 接入 `add-ts-app-config-schema` 定义的内部 validation 汇总路径。
- 对尚未落地的 gateway/capability/local-auth credential consumer，只固定接入规则；由各自 owning change 实施，不在本 change 创建占位 adapter 或公共契约。

## 验收场景

### 正常路径

active required `credentialRef=env:OPENAI_API_KEY` 可解析。启动校验无 secret issue，app-config 可在其他配置也有效时判定 `READY`。

### 边界路径

inactive branch 使用 grammar 合法但当前不可读的 `file:` reference。secret 校验不尝试读取该文件，也不因该项阻断 active branch。

### 失败路径

active required reference 缺失、使用 raw value、目标环境变量为空或文件不可读。secret 校验产生不含 reference/path/value 的 safe issue，app-config 根据 owning schema criticality 和 viable set 判定最终 readiness。

### 安全路径

resolver 抛出包含路径或原始异常信息的错误。所有 operator-visible 和 request-visible 输出只保留稳定 issue code、safe field ref 和 safe message。

## 验证策略

- unit tests：grammar、env/file resolvability、inactive branch、safe issue mapping
- bootstrap integration tests：ready 前完成校验，启动校验与 adapter 注入复用同一 resolver
- app-config integration tests：secret contribution 进入唯一 config readiness 判定
- architecture/contract negative tests：禁止 public secret snapshot、第二 resolver 路径、下游源配置读取和完整 reference 输出
- 门禁：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-secret-configuration-boundary --strict`

## 一致性结论

- 复用冻结的 `SecretReference`，不修改核心契约或 `agent-contracts`。
- 最终 readiness、criticality、viable set 和 release/readiness evidence 仍由 `add-ts-app-config-schema` 唯一拥有。
- 下游继续使用已定义的窄投影和 resolver 注入，不形成第二套配置总线。
