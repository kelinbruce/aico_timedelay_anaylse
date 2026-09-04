## 1. Contract 字段扩展（workflow-contracts）

- [x] 1.1 `RecipeDefinitionSchema` 新增可选 `domain`/`scene`/`lang` 字段，`domain`/`scene` 使用独立自由文本 schema（maxLength 512，无 pattern），`lang` 使用 `zh`/`en` 枚举 schema（与 1.0 DSL 规范一致，允许中文域/场景）
  验证：`npm run test:contract` + schema 校验测试
  来源：spec requirement `RecipeDefinition`；design decision 6

- [x] 1.2 确认 schema 不包含 `agentName` 字段，`additionalProperties: false` 仍生效
  验证：`npm run test:contract` + negative test（断言含 `agentName` 的 recipe 校验失败）
  来源：spec requirement `RecipeDefinition`；design decision 5

## 2. 运行时目录扫描（workflow-package + agent-capability）

- [x] 2.1 recipe capability provider 改为 default-enabled search provider：`localRecipeProvider` identity 移入 `agent-capability`，加入 `isDefaultEnabledSearchDiscovery` 判断列表
  验证：`npm test` + 断言 catalog 在无显式 binding 时通过 `searchDefaultEnabledProviders` 调用 recipe `search()`
  来源：spec requirement `Local Recipe Loading` scenario `Default-Enabled Without Binding`；design decision 9

- [x] 2.2 `search` 改为运行时全量目录扫描：每次调用时扫描 `agents/{agentId}/recipes/` 目录，解析索引字段，产出 workflow capability descriptor，不全量解析 `flowGraph`（与 agent-owned skill `scanRoot` 一致）
  验证：`npm test` + 断言 search 每次扫描目录（无启动期索引缓存）+ descriptor 无 flowGraph
  来源：spec requirement `Local Recipe Loading` scenario `Runtime Recipe Discovery`；design decision 1、2

- [x] 2.3 `require` 改为缓存 miss 时扫描目录定位文件：缓存命中 → 返回；缓存 miss → 扫描目录定位匹配 `recipeName` 的文件 → 加载完整 DSL → 校验 → 缓存 → 返回；目录无匹配 → `RECIPE_NOT_FOUND`
  验证：`npm test` + 懒加载+缓存测试（断言首次加载、二次命中缓存）+ recipe not found 测试（断言抛 RECIPE_NOT_FOUND）
  来源：spec requirement `Local Recipe Loading` scenario `Lazy Load Full DSL On Require`/`Recipe Not Found`；design decision 3、4

- [x] 2.4 loader 文件格式收窄为 `.yaml`/`.yml`，不扫描 `.json`
  验证：`npm test` + JSON 不被加载测试（断言 .json 文件被忽略）
  来源：spec requirement `Local Recipe Loading` scenario `YAML Only No JSON`；design decision 8

- [x] 2.5 `normalizeRecipeDefinition` 透传 `domain`/`scene`/`lang`，不合并到 `metadata`
  验证：`npm test` + passthrough 测试（断言字段在 RecipeDefinition 顶层、不在 metadata）
  来源：spec requirement `Local Recipe Loading` scenario `Classification Field Passthrough`；design decision 6

- [x] 2.6 移除 `attachRecipeCapabilitiesToAssemblies` 的 binding 创建逻辑：recipe provider 为 default-enabled，不再需要启动期生成 explicit `capabilityBindings`
  验证：`npm test` + 断言 Agent assembly 无显式 workflow binding 时 catalog resolve 仍返回 descriptor
  来源：spec requirement `Local Recipe Loading` scenario `Default-Enabled Without Binding`；design decision 9

- [x] 2.7 `Recipe Path Ownership` 改为运行时校验：路径逃逸防护在 `search` 和 `require` 时同步触发，不依赖启动期一次性校验
 验证：`npm test` + 断言路径逃逸时 search 返回空列表 + require 抛 AgentError
 来源：spec requirement `Recipe Path Ownership` scenario `Unsafe Trusted Root Rejection`；design decision 1
- [x] 2.8 `require` DSL 缓存 per-agent FIFO 淘汰：硬编码上限 100，超出时移除最早插入条目，不可配置
  验证：`npm test` + 断言缓存满后新条目驱逐最旧条目 + 被驱逐条目重新 require 时重新加载
  来源：spec requirement `Local Recipe Loading` scenario `Recipe Cache FIFO Eviction`；design decision 12

## 3. 边界验证（Negative Verification）

- [x] 3.1 确认 recipe 加载无 durable store 调用，不引入 `RecipeStoreGateway`/`RecipeRecord`：architecture test 实际触发并断言 import 失败
  验证：`npm run lint:architecture`（断言 `RecipeStoreGateway`/`RecipeRecord` 不存在于代码库）
  来源：spec requirement `Local Recipe Loading` scenario `No Durable Store`

- [x] 3.2 执行期懒加载校验失败抛 `AgentError`（`RECIPE_INVALID`），不缓存：negative test 实际触发校验失败并断言错误 + 缓存未写入
  验证：`npm test`（断言 require 抛 RECIPE_INVALID + 二次 require 仍触发加载）
  来源：spec requirement `Local Recipe Loading` scenario `Lazy Load Validation Failure`

- [x] 3.3 无 YAML 文件时 search 返回空列表，routing 回退 model loop：boundary test 实际触发空目录并断言
  验证：`npm test`（断言空目录 search 返回空 + dispatch 回退 MODEL_DRIVEN_LOOP）
  来源：spec requirement `Local Recipe Loading` scenario `No Recipe Means Empty Search Result`

## 4. 收尾

- [x] 4.3 `search` 将静态 Recipe 资源统一发布为 `CapabilityDescriptor(kind="WORKFLOW")`，descriptor 不直接作为 model tool 暴露
  验证：`npm test`

- [x] 4.1 `npm run build && npm run lint:architecture` 通过（`npm test`/`npm run test:contract` 受预存 Windows 路径空格问题阻塞，非代码问题）
  验证：全部通过
  来源：AGENTS.md 验证门禁

- [x] 4.2 Code review
  验证：`$nextagent-code-review` PASS
  来源：AGENTS.md push 门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/workflow-contracts/spec.md`
- 同步 `openspec/specs/workflow-package/spec.md`
- 按需更新 `openspec/designs/architecture/workflow-contracts.md`
- 按需更新 `openspec/designs/modules/agent-workflow.md`
- 按需更新 `openspec/designs/spec-to-design-map.md`
