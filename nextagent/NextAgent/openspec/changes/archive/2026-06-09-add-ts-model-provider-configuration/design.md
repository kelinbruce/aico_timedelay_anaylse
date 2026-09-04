## 背景和现状（Context）

本 change 关注模型 provider 配置如何在启动期被读取、校验、冻结，并为后续 selection、fallback 候选集和 invocation 装配提供稳定输入。

## 黑盒目标（Blackbox Goal）

系统在启动阶段读取 `modelProfiles[]`，完成校验、冻结和注册表生成，并向下游暴露只读 `modelProfileRegistry` 与必要 selector。

## 边界（Boundary）

- 负责：产品配置字段定义、启动期同步校验、secret reference 边界、冻结快照、safe provider route descriptor 准备、fail-fast 与受控降级边界
- 不负责：模型调用契约、stream normalization、provider error mapping、fallback policy、routing evidence
- owner：`agent-app` 主责，`agent-model` 强相关协作

## 输入输出（Inputs / Outputs）

输入：

- `profileId`
- `providerKind`
- `modelName`
- `baseUrl`
- `credentialRef`
- `timeoutMs`
- `modelOptions`
- `providerOptions`
- `enabled`
- `fallbackEligible`

输出：

- `modelProfileRegistry`

`modelProfileRegistry` 是唯一启动期冻结产物，内部包含：

- validated profiles by `profileId`
- enabled profile index
- fallback-eligible profile index
- safe provider route descriptors by `profileId`
- validation evidence

对外只暴露冻结 registry 和必要 selector；不得把并列的 mutable set/catalog 作为独立运行时状态暴露。safe provider route descriptor 只能包含访问装配所需的非敏感稳定字段；adapter factory、SDK client、resolved credential 或其他可变运行期句柄不得进入 registry。

## 核心实现策略（Core Implementation Strategy）

- 配置解释集中在启动边界完成，而不是分散到请求期。
- 先把源配置校验成稳定 profile 集，再把 profile、enabled/fallback 索引、safe route descriptor 和 validation evidence 合并冻结为一个只读快照。
- 运行时只消费快照与 selector，不重复读取源配置。
- provider 访问所需的 secret 只以 reference 形式出现在配置与运行时快照中，解析后的敏感值停留在内部装配边界。
- `env:` / `file:` 由 `agent-app` 注入的 credential resolver 解析；本 change 只校验 model profile reference 语法，active reference 的 ready 前可解析性校验由 `add-ts-secret-configuration-boundary` 统一拥有。

## 关键约束（Key Constraints）

- 当前不修改 `agent-contracts`，产品 enabled 配置仅允许 `OPENAI` provider；多 provider 闭集扩展由后续 contract change 承接
- `credentialRef` 仅允许 `env:` 和 `file:`
- raw secret、`direct:`、`none`、fake/test provider 不得进入产品配置
- 启动前必须完成同步校验，请求期不得重新解释源配置
- 冻结产物必须是单一只读 registry，下游只能消费 registry 和必要 selector
- profile 校验失败不得静默丢弃
- TS 首版仅允许 fallback-only profile 的非法 `credentialRef` 语法走受控剔除；其他配置错误保持 fail-fast
- 受控剔除必须输出不包含 raw secret、路径或 resolved credential 的 operator-visible structured warning

## 关键业务流程（Key Flow）

1. Assembly/bootstrap 读取 `modelProfiles[]`
2. 校验 provider kind、secret reference、唯一性、`enabled` / `fallbackEligible` 关系
3. 若无可运行 enabled profile，则启动失败
4. 生成 validated profiles、enabled index、fallback-eligible index、safe provider route descriptor 和 validation evidence
5. 将上述内容合并冻结为单一 `modelProfileRegistry`
6. selection/fallback/invocation 只消费冻结 registry 和必要 selector

## 典型用例（Typical Use Cases）

- 生产环境配置两个 `OPENAI` profile：主 profile 正常启用，备用 profile 设置 `fallbackEligible=true`。启动成功后，两个 profile 都进入 `modelProfileRegistry` 的 enabled index，备用 profile 同时进入 fallback-eligible index。
- 运营人员误把 `credentialRef` 写成明文 API key。系统在启动校验阶段直接拒绝进入 ready，而不是等首个请求时报错。
- 多 profile 场景下，某个 fallback-only profile 使用非法 secret reference 语法，但主 profile 仍完整可用。系统剔除该 fallback profile，并输出 operator-visible evidence 后继续启动。
- 某个 active profile 使用合法 `file:` reference，但文件在启动校验时不存在。secret boundary 产生安全配置 issue，不把路径或 resolved secret 暴露给上层。
