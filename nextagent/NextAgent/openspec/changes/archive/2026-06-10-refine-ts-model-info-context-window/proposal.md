## 背景与问题（Why）

`add-ts-context-budget-explainability` Chunk β（commit `5a2a4af`）把
预算决策门接入了 `DefaultContextEngine.assemble()`，但无法诚实地
读取模型的 context window：

```ts
const window = (modelSelection.modelInfo as { readonly contextWindowTokens?: number }).contextWindowTokens
  ?? this.deps.contextWindowTokensFallback
  ?? DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK;
```

三层 shim：

1. `as { contextWindowTokens? }`——类型断言，读取一个不在
   `ModelInfo` 上的字段。运行时永远是 undefined。
2. `contextWindowTokensFallback`——为了让 unit test 通过而新增的
   依赖。
3. `DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK = 128_000`——静默默认值，
   在每条生产代码路径上都会生效，**与模型的真实
   context window 无关**。

这使预算门看起来在工作，但实际上无论配置
的是哪个模型，都按假定的 128k 窗口计算
`availableInputUnits`。一个 4k 窗口的模型（例如 gpt-3.5-turbo）
会得到 76k+ token 的"可用"预算——静默地违反
模型的真实容量。

根本的 contract 缺口：`refine-ts-model-profile-context-window` 新增了
`ModelProfile.contextWindowTokens`，但 runtime 执行子集
`ModelInfo`（实际传入 `DefaultContextEngine.assemble` 的 model-selection
resolver 的类型）并不携带该字段。所以即使 profile 里有数据，
该字段也到不了预算门。

本 refine 通过在 `ModelInfo` 上新增必填字段
`contextWindowTokens: number` 并通过 `modelInfoFromProfile` 传播它，
来关闭这个缺口。落地后，预算门直接从
`modelSelection.modelInfo.contextWindowTokens` 读取真实窗口；
fallback shim 被删除。

## 变更范围（What Changes）

- `agent-contracts/model.ModelInfo` 新增必填 `contextWindowTokens: number`。
- `packages/agent-app/src/composition/create-app.ts:modelInfoFromProfile`
  把 `profile.contextWindowTokens` 传播到构造出的 `ModelInfo` 中。
- 移除 `DefaultContextEngineDependencies.contextWindowTokensFallback`。
- 移除 `assemble-context.ts` 中的
  `DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK` 常量。
- `runBudgetGate` 直接读取 `modelSelection.modelInfo.contextWindowTokens`
  （无 `as` 断言、无 fallback 链）。
- 所有既有的 `ModelInfo` 字面量构造点（约 6 个 test fixture
  + 生产工厂）都新增该必填字段。
- 更新 `add-ts-context-budget-explainability-consistency.md` 的 Prereq B
  follow-up，记录 fallback shim 已退役。

## Capability 影响（Capabilities）

- 新增 `model-info-contracts` 作为 contract-refinement capability
  （新 capability，与更早 refine 中的
  `model-profile-contracts` 平行）。
- 不实现 model 调用、model 选择、fallback 语义或任何 model-provider
  行为——纯粹是 contract 新增 + shim
  移除。

## 影响范围（Impact）

- `add-ts-context-budget-explainability` Chunk β 的预算门现在读取真实
  的模型窗口，而不是 128k 常量。下游 chunk（γ / δ / ε）
  可以依赖准确的 `availableInputUnits` 计算。
- `agent-model` 和 `agent-runtime` 通过 `ModelInvocationRequest`
  （它展开 ModelInfo 的字段）消费 `ModelInfo`；它们
  会收到新字段但无需对其做任何处理（model 调用
  不会约束自身窗口，超出底层 provider
  拒绝范围的不算）。无行为变化。
- 所有构造裸 `ModelInfo` 字面量的约 6 个 test fixture 都需要新增
  该字段（编译期强制；无运行时意外）。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/model-info-contracts/spec.md`（新基线）
- `openspec/designs/architecture/core-contracts.md` 已经就绪
  （ModelInfo 已在那里记录）；如有需要补充一条小注
