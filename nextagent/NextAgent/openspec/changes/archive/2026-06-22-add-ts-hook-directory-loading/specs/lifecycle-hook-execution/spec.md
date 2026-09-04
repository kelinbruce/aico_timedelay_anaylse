## MODIFIED Requirements

### Requirement: Hook definitions and Agent bindings remain separate and bounded

系统 SHALL 将 lifecycle hook code registration、hook definition 与 Agent hook binding 视为分离边界，但产品主路径的 trusted source SHALL 来自冻结的 `configRoot/hooks` 工程目录，而不是运行中手工拼装或外部动态发现：

- app composition SHALL 在启动期扫描 `configRoot/hooks` 下的一级 hook package 目录；
- 每个 hook package MUST 通过受信 manifest 提供 `hookId`、最小 definition authoring 字段与最小 binding authoring 数据，并通过受信 module entry 提供 TypeScript backend hook code；
- loader MUST 从 manifest 顶层 hook metadata 物化运行时 `LifecycleHookDefinition`，从 manifest `bindings` 物化 `AgentHookBinding[]`，并与模块导出的 hook handler 一起冻结后注入 runtime；
- runtime MUST 继续只消费冻结后的 code registration / definition / binding 快照，不直接读取目录或 manifest；
- `SYSTEM` hook MUST 先于 `CUSTOM` hook 执行，`SYSTEM` hook 仍不得被 Agent binding 禁用，且其 `failureMode` MUST 为 `FAIL`；
- startup composition 完成后，effective hook code registration、hook definitions 与 Agent hook bindings MUST 冻结，request 执行中不得重新扫描、重载或改变生效集合。

`configRoot/hooks` SHALL be derived from the frozen trusted `configRoot` in the same way `configRoot/skills` is derived for local Skill source. User-facing raw app config MUST NOT expose `paths.hooksRoot` or an arbitrary hook source path entry.

#### Scenario: Startup loads hook packages from trusted hooks directory

- **WHEN** app composition starts with a resolved trusted `configRoot`
- **THEN** system MUST derive the trusted hook root as `configRoot/hooks`
- **AND** app composition MUST scan only first-level hook package directories under that root
- **AND** runtime request execution MUST use only the frozen startup snapshot derived from that directory

#### Scenario: Hook package authoring remains split even if stored in one package directory

- **WHEN** a hook package is loaded from `configRoot/hooks/<hook-id>/`
- **THEN** the loader MUST separately validate and materialize the hook definition metadata, Agent bindings, and executable hook handler
- **AND** runtime MUST NOT treat a hook package as a new public `PolicyPort`, provider type, or generic plugin surface

#### Scenario: Runtime does not reload hooks during an active request

- **WHEN** startup composition has completed and a request is already executing
- **THEN** runtime MUST keep using the frozen startup registration / definition / binding snapshot
- **AND** modifications to files under `configRoot/hooks` MUST NOT change the effective hook set for that request

### Requirement: Hook code execution is app-composed and bounded

系统 SHALL 通过 app composition 从 trusted `configRoot/hooks` 加载 TypeScript hook code，并由 runtime hook executor 在绑定 stage 调用该 hook code。首版 hook directory loading MUST 满足以下约束：

- hook root MUST be `configRoot/hooks` and MUST NOT be replaced by raw path config, remote URL, user request, model output, or runtime hot-loading input;
- loader MUST only accept trusted local package directories under `configRoot/hooks`;
- each hook package MUST resolve to a local module entry inside its own directory and MUST NOT escape that directory through `..`, symlink, junction, reparse point, or equivalent path indirection;
- hook module MUST expose the single hook execution entry expected by app composition;
- first-version hook package entry MUST be a self-contained `index.js` that directly exports `invoke(input, signal)` and MUST NOT rely on startup-time `import` resolution;
- request execution MUST NOT load Python, Java, shell, Wasm, remote hook code, script-file hook code, model-generated code, or runtime-downloaded code as a lifecycle hook implementation;
- tests MAY still inject a `LifecycleHookPort` directly, but the product path SHALL use the trusted hook directory loader.

#### Scenario: Hook directory load failure stops startup

- **WHEN** any hook package under `configRoot/hooks` has an invalid manifest, duplicate `hookId`, invalid binding, missing entry module, invalid export, or path escape
- **THEN** startup composition MUST fail closed
- **AND** the app MUST NOT start with a partially loaded hook set

#### Scenario: Trusted hook module is loaded only from its own package directory

- **WHEN** the loader resolves a hook package entry
- **THEN** the resolved module path MUST stay inside that package directory
- **AND** the loader MUST reject symlink, junction, reparse-point, or path-traversal based escape

#### Scenario: First-version hook entry stays self-contained

- **WHEN** a hook package is loaded from `configRoot/hooks/<hook-id>/index.js`
- **THEN** the entry MUST directly export `invoke(input, signal)` from that file
- **AND** startup composition MUST reject an entry that depends on `import` declarations or cross-file startup-time module resolution

#### Scenario: Non-TypeScript or remote hook implementations remain unsupported

- **WHEN** the system runs in the hook-directory-loading mode
- **THEN** request execution MUST still use only trusted local TypeScript backend hook modules loaded by app composition
- **AND** the system MUST NOT execute Python, Java, shell, Wasm, remote, script-file, or model-generated hook implementations as lifecycle hooks

## ADDED Requirements

### Requirement: Hook directory loading is startup-validated and fail-closed

系统 SHALL 定义 `configRoot/hooks` 下的工程布局和启动期校验规则。首版 trusted hook package MUST 满足：

- path shape 为 `configRoot/hooks/<hook-id>/`
- package 目录名 MUST 与 manifest 中的 `hookId` 一致
- package MUST 同时包含 manifest 和本地 module entry
- manifest MUST provide `hookId`、`kind`、`supportedStages`、`executionMode`、`failureMode` and at least one binding entry carrying `agentId`
- loader MUST 在启动期完成 schema validation、duplicate detection、path validation、module export validation 和 frozen snapshot materialization

若 `configRoot/hooks` 不存在或为空，系统 MAY 视为“无外部 product hook”，并继续使用 no-op / manually composed defaults；但一旦目录存在且包含 candidate package，所有 candidate MUST 一致通过校验，否则启动失败。

#### Scenario: Empty trusted hooks root is allowed

- **WHEN** `configRoot/hooks` does not exist or contains no hook package candidate
- **THEN** app composition MAY start without loading product hooks
- **AND** runtime MUST continue using the remaining explicitly composed or default no-op hook inputs

#### Scenario: Duplicate hook ids are rejected at startup

- **WHEN** two hook packages under `configRoot/hooks` materialize the same `hookId`
- **THEN** startup composition MUST fail closed
- **AND** the app MUST NOT choose one package implicitly

#### Scenario: Invalid package binding is rejected before runtime starts

- **WHEN** a hook package manifest contains an invalid `AgentHookBinding` shape, unsupported stage narrowing, or a `SYSTEM` disable attempt
- **THEN** startup composition MUST fail closed
- **AND** runtime MUST NOT receive that invalid binding snapshot
