## 背景和现状（Context）

当前 Bash 把 `python` 与 `python3` 识别为 Python sandbox route，并将已 token 化的 `command`/`args` 经 `SandboxExecutionPort` 提交给 `SandboxGatewayPort`。`restricted-local-sandbox.ts` 的 `translateExecutablePathArguments()` 将 Python 的首个参数一律解释为 logical script path；因此 `python -m scripts.nl2api.api_recall_main` 会把 `-m` 映射为 workspace 文件。

Skill resource projection 已为当前 run 将已加载 Skill 投影为只读 `.nextagent/skills/<projection-key>/<skill-name>/` root，并只把已授权 root 加入 `SandboxFilesystemLayout.roots`。默认 cwd 则是 execution scope 根，不是 Skill root。因此当前实现既没有 Python invocation mode 分类，也没有模块导入根语义。

当前 stable spec 只规定 Python 经 sandbox 和 trusted interpreter 执行，未定义 `-m`；实现的“首参总是脚本路径”正是本 change 要消除的 implementation-vs-spec gap。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让已授权、已投影的单个电信诊断 Skill 可以稳定执行 `python -m scripts.<module> [args...]`。
- 保持模块名、Skill root、宿主路径和环境变量的 authority 在 trusted execution facts 内。
- 复用现有 `SandboxExecutionRequest.filesystem`、`shell: false`、Python interpreter resolution、safe error、timeout、cancellation 与输出限制，不新增 public contract。

**非目标：**

- 不支持 `-c`、stdin、任意 Python interpreter options、virtualenv、pip、依赖安装、跨 Skill import 或第三方包管理。
- 不从模块名、SKILL.md 文本、客户端请求体、模型输入或环境变量选择 import root。
- 不改变 `python <logical-script-path>` 既有行为，不增加独立 public Python tool 或 Bash allowlist。

## 设计决策（Decisions）

### D1：在 restricted local sandbox 以小型分类器确定两种 Python invocation mode

`restricted-local-sandbox` 是唯一解释 Python argv 语义的 owner。它在 path translation 之前将请求分类为：

1. script-path mode：首参不是 `-` 开头的 interpreter option，沿用既有 logical path translation 和拒绝规则；
2. module mode：首两个参数严格为 `-m` 与非空 dotted module name，保留完整 argv，不做脚本路径 translation。

其他以 `-` 开头的形态 fail closed，返回既有 Python safe error vocabulary 中带受控 reason 的结果。不会把 `-m` 作为“恰好不存在的脚本”，也不会一般化支持 Python 全量 CLI。

选择在 gateway 分类，而非 Bash：Bash 只负责唯一 tokenization 和路由；local sandbox 已拥有 interpreter execution、filesystem roots、sanitized environment 与 process start，能在 shell-free 进程创建前做一次完整判定。

### D2：模块 import root 从现有 run-scoped projection root 唯一派生

`WorkspaceFilePort` 保留现有职责：把当前 run 全部已授权 projection roots 放入 `request.filesystem.roots`。local sandbox 在 module mode 查找 logical path 为 `.nextagent/skills/...` 的 read-only system resource root。恰好一个时，将其 physical path 作为本次子进程的唯一 `PYTHONPATH` entry；零个或多个时，sandbox 在启动进程前安全失败。

该 root 不是由 request body 传入的新字段，也不是模型可控值：`WorkspaceFilePort.sandboxFilesystem(context)` 仅从当前 run 的 `authorizedSkillRoots` 填入候选 roots，local sandbox 仅在 module mode 作唯一性判定。传给子进程的环境由 local adapter 从既有 sanitized environment 派生，覆盖/清除外部 `PYTHONPATH`，只注入该唯一可信根。该物理路径不进入 capability result、safe error、日志或 audit payload。

选择“唯一 root 或失败”而不是把多个 root 拼接到 `PYTHONPATH`：后者会带来同名 package shadowing 和调用结果依赖授权顺序的不可审计行为；从 module name 推断 Skill 也会把模型文本提升为授权事实。模块 import 需要多个 Skill 时，必须由后续 change 定义显式、可信的 dependency/projection contract。

### D3：不变更 SandboxGatewayPort 或公开模型工具 schema

模块 mode 是已有 Bash command token sequence 的运行语义，不是新的 Web API、tool input 或 gateway DTO。`SandboxExecutionRequest.filesystem` 已承载 trusted root layout；`environment` 仍由 trusted capability/runtime construction产生并在 local adapter 清洗。实现不增加 `importRoot` request field、`PYTHONPATH` 模型参数或新的 `SandboxExecutionResult`。

### D4：测试覆盖从 token 到实际模块导入的黑盒路径

测试至少包含：

- local sandbox 以真实临时 projection root 执行 `python -m`，并证明 `-m` 没有被转换为路径；
- `WorkspaceFilePort` 在同一 run 只暴露已授权 projection root，跨 run/owner/Agent 不可复用；
- 多 root 与无 root 在 process start 前产生 safe failure；
- `python <script-path>` 回归通过，`-c` 与 `-` 被拒绝；
- Bash capability 将 module argv 原样传入 Python sandbox port。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | import root 只来自 run-scoped committed projection；单 root 限制避免 shadowing；禁用其他 interpreter mode 和模型指定环境。 | sandbox unit tests：无/多 root、`-c`、stdin、path injection；architecture review。 |
| 性能/容量 | 分类与 root 选择均为有限 roots 的本地线性扫描，不引入 I/O、扫描或缓存；一次 process 启动的资源约束不变。 | targeted Vitest；复用 timeout/output limit regression。 |
| 可靠性/恢复 | root 缺失或歧义在 process start 前 fail closed；无 fallback 与重试；现有 cancellation/timeout 仍由 gateway 管理。 | safe failure assertions 与既有 sandbox cancellation tests。 |
| 可维护性 | Python argv 解释仅在 local sandbox，projection authority 仅在 WorkspaceFilePort，Bash 不增加策略。 | `npm run lint:architecture`、source boundary review。 |
| 可测试性 | 使用临时投影目录、受控 `SandboxFilesystemLayout` 与 interpreter override 形成跨平台确定性测试。 | restricted-local-sandbox、skill-resource-projection、bash-capability tests。 |
| 审计/可追溯性 | 复用既有安全 sandbox operation summary；不记录 module root、完整 command 或 `PYTHONPATH`。 | observability mapping review 与现有 redaction assertions。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `-m <module>` 不被当成脚本路径且采用 `shell: false` | 2.1、3.1 | `restricted-local-sandbox.test.ts` module execution test |
| 仅单个 run-scoped authorized projection 可作 import root | 1.1、2.2、3.2 | `skill-resource-projection.test.ts` 与 sandbox no/multi-root tests |
| Bash 不拥有 module/import root policy | 2.3、3.3 | `bash-capability.test.ts` argv forwarding test、architecture review |
| 其他 Python option fail closed，脚本模式无回归 | 2.1、3.1 | sandbox negative/regression tests |
| 不新增 public contract 或 host path leak | 1.2、3.4 | TypeScript build、contract tests、safe output assertions |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/sandbox-runtime/spec.md` 主承载 invocation mode 和 trusted import-root 行为；`openspec/specs/bash-tool/spec.md` 主承载 Bash 转发行为；`openspec/specs/skill-resource-access/spec.md` 主承载 projection authorization 行为。
- 架构和跨模块设计：无。该 change 不改变 gateway public contract 或跨模块 state/data ownership。
- 模块设计：`openspec/designs/modules/agent-capability.md` 承载 WorkspaceFilePort projection authority 与 Bash 非职责；`openspec/designs/modules/agent-platform-gateway-local.md` 承载 argv 分类、受控环境和 local process start。
- ADR：无；这是既有边界下的最小收敛，不引入长期替换性取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 仅在上述 stable document 导航变化时更新。

## 风险与取舍（Risks / Trade-offs）

- [一个 run 加载多个可执行 Skill 时 module mode 失败] -> 这是刻意 fail-closed；调用方继续使用受控脚本路径，或由后续 change 定义显式可信的多 Skill import contract。
- [Skill 内模块依赖未被投影] -> projection integrity 继续是前置条件；失败表现为 Python 的普通非零结果，不增添 source-path diagnostics。
- [Windows/POSIX 的 `PYTHONPATH` 分隔符不同] -> local adapter 使用 Node `path.delimiter` 构造唯一 entry，测试覆盖当前平台并保留跨平台语义。

## 迁移计划（Migration Plan）

无需数据迁移、配置迁移或公开 API 发布。实现与测试发布后，Skill author 可以把已投影 Skill 内、仅依赖同一 Skill root 的调用说明改为 `python -m scripts.<module>`。回滚时回退本 change；现有脚本路径模式不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：提炼两种受支持 Python invocation mode、唯一可信 import root 和 fail-closed 条件。
- `openspec/specs/bash-tool/spec.md`：提炼 Bash 对 Python module token sequence 的转发非职责。
- `openspec/specs/skill-resource-access/spec.md`：提炼 projection authorization 对模块 root 的作用域事实。
- `openspec/designs/modules/agent-capability.md`：提炼 `WorkspaceFilePort` projection authority。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提炼 Python argv 分类与环境构造。
- `openspec/overview.md`、`openspec/designs/architecture/`、`openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：仅在导航变化时更新。

## 待确认问题（Open Questions）

无。
