## MODIFIED Requirements

### Requirement: DSL Vite 别名 stub

vite 配置 MUST 在 dev 模式下将 `@cloudsop/dsl-engine-web` 别名到本地 stub 组件，并在生产构建中别名到真实包。该 stub MUST 导出一个渲染占位符的 `DSLEngine` 函数组件。

vite 配置 MUST 额外在 dev 模式下将子路径 `@cloudsop/dsl-engine-web/generateui` 别名到单独的本地 stub 模块，并在生产构建中别名到真实包子路径。generateui stub MUST 导出一个 `StreamDSLContext` React context Provider 组件，它透明地渲染其 `children` 而不注入任何 context 值（no-op 透传）。这两个别名 MUST 相互独立：`@cloudsop/dsl-engine-web` 别名 MUST NOT 因新增 `@cloudsop/dsl-engine-web/generateui` 别名而受影响，既有 `DSLEngine` 解析行为 MUST 保持不变。

#### Scenario: 本地 dev 模式解析到 stub

- **WHEN** vite dev server 以 local 模式启动
- **THEN** `import { DSLEngine } from "@cloudsop/dsl-engine-web"` MUST 解析到 stub 组件
- **AND** 该 stub MUST 无错误地渲染一个可见占位符

#### Scenario: 生产构建解析到真实包

- **WHEN** vite 为生产构建
- **THEN** `import { DSLEngine } from "@cloudsop/dsl-engine-web"` MUST 解析到真实 `@cloudsop/dsl-engine-web` 包
- **AND** 该包未安装时构建 MUST 失败

#### Scenario: generateui 子路径在 dev 中解析到单独 stub

- **WHEN** vite dev server 以 local 模式启动
- **THEN** `import { StreamDSLContext } from "@cloudsop/dsl-engine-web/generateui"` MUST 解析到一个单独的 stub 模块
- **AND** stub `StreamDSLContext` MUST 渲染其 children 而不注入任何 context 值

#### Scenario: generateui 子路径在生产中解析到真实包

- **WHEN** vite 为生产构建
- **THEN** `import { StreamDSLContext } from "@cloudsop/dsl-engine-web/generateui"` MUST 解析到真实 `@cloudsop/dsl-engine-web/generateui` 子路径
- **AND** 该包或子路径不可用时构建 MUST 失败

#### Scenario: 既有 DSLEngine 别名不受 generateui 别名影响

- **GIVEN** `@cloudsop/dsl-engine-web/generateui` 别名已被添加
- **WHEN** 解析 `import { DSLEngine } from "@cloudsop/dsl-engine-web"`
- **THEN** 解析结果 MUST 与添加 generateui 别名之前完全相同
- **AND** 既有 DSL 渲染行为 MUST NOT 改变