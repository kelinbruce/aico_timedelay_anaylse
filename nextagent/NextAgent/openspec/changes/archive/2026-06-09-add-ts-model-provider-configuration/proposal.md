## 背景与问题（Why）

当前系统需要一套稳定的模型 provider 产品配置能力，用于在启动阶段明确：

- 系统接入了哪些模型 profile
- 每个 profile 对应哪个 provider 与模型
- 哪些 profile 可参与 fallback 候选
- 哪些凭据来源与访问地址是合法的

如果这部分没有被收敛成统一规格，配置解释就会散落在多个模块，启动失败时机会漂移，fallback 候选也会失去稳定边界。

## 变更范围（What Changes）

- 保留 `model-provider-configuration` 作为独立 capability。
- 在不修改 `agent-contracts` 的前提下，正式定义当前产品配置只允许启用 `OPENAI` provider；`MINIMAX`、`DEEPSEEK`、`QWEN` 等 provider 闭集扩展由后续 contract change 承接。
- 正式定义 `modelProfiles[]` 的稳定字段、启动期校验顺序、单一冻结快照和下游 selector 消费边界。
- 明确现有 `credentialRef` 字段只允许 secret reference 语法 `env:` 与 `file:`。
- 明确 fake/test provider 只允许用于测试与受控验证，不能进入产品配置。
- 明确该 change 只负责配置读取、校验、冻结和装配输入准备，不重新定义 model invocation、error mapping 或 fallback 执行。

## TS 首版补齐范围（TS First-Release Closure Scope）

- `env:` 与 `file:` reference 都必须由产品 credential resolver 支持；resolved secret 不得进入快照、日志或诊断。
- 冻结快照必须递归冻结 profile、enabled/fallback 索引、safe provider route descriptor、`modelOptions`、`providerOptions` 和 validation evidence。
- fallback-only profile 因非法 `credentialRef` 语法被剔除时，必须输出不含 raw secret 或路径的 operator-visible structured warning。
- 本 change 只拥有 model profile 的 secret reference 语法校验；active reference 的 ready 前可解析性校验与单一 resolver 注入由 `add-ts-secret-configuration-boundary` 拥有。

## Capability 影响（Capabilities）

### 新增 Capability
- `model-provider-configuration`: 定义启动期如何读取、校验、冻结和暴露模型 provider profile 配置，并为 selection、fallback 和 invocation 装配提供稳定输入。

### 修改的 Capability
- `agent-assembly`: 补充“ready 前必须完成模型 profile 配置冻结”的高层要求。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-app`
  - `modules/agent-model`
  - `modules/agent-context-engine`
  - `tests/contract`
  - `tests/integration`
- 受影响配置：
  - `adnclaw.system.model-profiles[]`
- `credentialRef`
- provider `base-url`
- `modelOptions`
- `providerOptions`
- 受影响协作边界：
  - `agent-app` 负责配置解释、校验、冻结 `modelProfileRegistry`，并在注册表内部维护 enabled/fallback 索引与 safe provider route descriptor
  - `agent-context-engine` 通过冻结后的 profile registry 和必要 selector 做 selection/fallback policy
  - `agent-model` 只消费已选 profile 或装配结果，不重新读取源配置

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/model-provider-configuration/spec.md`：新增

设计视图：
- `openspec/designs/architecture/agent-assembly-flow.md`
- `openspec/designs/architecture/context-engine-and-model-routing.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/modules/agent-model.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：
- bootstrap validator tests
- `tests/contract` 配置契约测试
- `tests/integration` 启动与多 profile 组装测试
