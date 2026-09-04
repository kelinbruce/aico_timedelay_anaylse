## Contract Decisions

### Field Addition

`agent-contracts/model.ModelInfo` gains one required field:

```ts
interface ModelInfo {
  readonly providerKind: ModelProviderKind
  readonly modelName: string
  readonly contextWindowTokens: number   // 新增: 模型上下文窗口容量 (token), 必填
  readonly baseUrl?: string
  readonly credentialRef?: string
  readonly timeoutMs?: number
}
```

`contextWindowTokens` is REQUIRED (not optional) because:

- The budget gate needs the field unconditionally to compute
  `availableInputUnits = contextWindowTokens - reservedOutput - fixed-slots`.
- Making it optional would force every consumer to handle `undefined` with
  yet another fallback — exactly the shim pattern this refine removes.
- The value is always derivable from `ModelProfile.contextWindowTokens`
  (already required by `refine-ts-model-profile-context-window`), so the
  factory `modelInfoFromProfile` can always populate it.

### Propagation Path

```
ModelProfile.contextWindowTokens       (already required, from refine-ts-model-profile-context-window)
        │
        │ modelInfoFromProfile() in agent-app/src/composition/create-app.ts
        ▼
ModelInfo.contextWindowTokens          (this refine adds it)
        │
        │ modelSelection.modelInfo in DefaultContextEngine.assemble()
        ▼
runBudgetGate() reads real window      (Chunk β's shim deleted)
        │
        ▼
ContextBudgetPolicyInput.window        (accurate, model-specific)
```

No new agent-contracts subpath. No new owner. Same boundary as the
previous `refine-ts-model-profile-context-window`.

### Cleanup of the Chunk β shim

Removed from `agent-context-engine`:

```ts
// Removed: a runtime fallback for what should be a real contract field
readonly contextWindowTokensFallback?: number

// Removed: a default that silently masked the missing contract field
const DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK = 128_000

// Removed: a type assertion that lied about the type
const window = (modelSelection.modelInfo as { readonly contextWindowTokens?: number }).contextWindowTokens
  ?? this.deps.contextWindowTokensFallback
  ?? DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK
```

Replaced with:

```ts
const window = modelSelection.modelInfo.contextWindowTokens
```

## Why Not Optional

We considered marking the field optional and keeping a default in
`runBudgetGate`. Rejected because:

- It re-introduces the same silent-degradation pattern this refine
  exists to delete.
- It pushes default-handling into every consumer that needs to ask
  "what is the window?".
- `ModelProfile.contextWindowTokens` is already required, so the
  factory always has a real value to propagate. Making the runtime
  subset optional would be deliberately throwing away information.

## Why Not Move ModelProfile Directly Into the Engine

We considered changing `DefaultContextEngineDependencies.modelInfo` to
`modelProfile: ModelProfile`. Rejected because:

- Larger blast radius: every consumer of the engine (agent-app,
  agent-core, tests) would need to construct a full `ModelProfile`
  instead of the runtime subset.
- The runtime/model split between `ModelProfile` (configured, includes
  credentials) and `ModelInfo` (runtime-safe subset, no raw secret
  resolution responsibility) is intentional and useful.
- Adding one field to `ModelInfo` is the smaller, cleaner change.

## Rejected Alternatives

- Keep the fallback "for now" — rejected. The slop warning was correct:
  fallback layers without a documented justification become permanent
  technical debt. We have a clear path to remove it; we should.
- Use `Infinity` as a sentinel for "unknown window" — rejected. Either
  the field is known (always, since profile carries it) or this is a
  configuration error worth failing on.
- Hide the window inside `ModelOptions` — rejected. Window is a model
  capacity fact, not an agent-author behavior choice. Same reasoning as
  the earlier `refine-ts-model-profile-context-window`.
