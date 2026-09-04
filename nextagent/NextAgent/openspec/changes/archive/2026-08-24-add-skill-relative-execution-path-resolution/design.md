## 设计范围

| Function | 目标变化 | delta spec | 设计章节 |
|---|---|---|---|
| `FN-5.5 执行命令和脚本` | Bash 对直接解释器执行的 Skill 相对脚本路径执行唯一匹配补全，并在 projection 安全边界内处理无匹配和歧义 | `command-script-tools` | [FN-5.5 执行命令和脚本](#fn-55-执行命令和脚本) |

## FN-5.5 执行命令和脚本

### 目标与规范依据

本 change 只在 Bash 已经完成确定性输入解析、但尚未提交 sandbox 的阶段增加窄兼容行为。命令文本、公共 Tool schema、默认 cwd、sandbox policy 和 Python Tool 不变。

#### 本 Function 的目标 Requirements

- canonical spec：`command-script-tools`
- `ADDED`：`Bash 补全唯一匹配的 Skill 相对脚本路径`
- `ADDED`：`Skill 相对脚本解析保持 projection 安全边界`

### 当前实现

`bash-tool` 通过 `parseBashInputForModelCorrection` 把 command-string mode 或 argv mode 规范化为 `ParsedBashInput { executable, args, environment }`。Python executable 还会经过现有 invocation guard，随后 `prepareBuiltinExecutableFacts` 和 sandbox execution port 接收解析后的 executable 与 argv。Bash 不读取 execution workspace，也不知道 Skill projection。

`WorkspaceFilePort` 已负责 Skill resource projection。`projectSkillResources` 生成 committed projection manifest；`discoverVerifiedSkillRoots` 只从当前 `ExecutionWorkspaceView` 的 `systemResources` root 枚举、验证并缓存 committed roots；`sandboxFilesystem` 把验证通过的 roots 作为只读逻辑 mount 提交 sandbox。Read/Glob/Grep 也复用同一 projection manifest、containment 和 link 防护。

当前没有把 `scripts/query.py` 或 `<skill-name>/scripts/query.py` 解析为 projection logical path 的窄接口。Bash 收到该写法时会按默认 cwd 原样执行并通常返回文件不存在。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 直接解释器执行可兼容两种 Skill 相对脚本写法 | Bash 只保留解析后的 argv，不补全 Skill path | 缺少可判定的调用形态识别和 argv 补全步骤 |
| 只消费当前 scope 的 committed verified projection | projection authority 在 `WorkspaceFilePort`，Bash 无权扫描 | 缺少由 authority owner 暴露的窄解析接口 |
| 唯一匹配补全、无匹配保持、歧义拒绝 | 当前没有候选结果模型 | 缺少确定的 `resolved/not-found/ambiguous` 结果和排序规则 |
| 不处理复杂 shell 或任意文本 | command-string mode 会产生 token sequence | 缺少在补全前排除 shell operator、interpreter flag 和不支持路径形态的 guard |
| 不扩大路径权限和不暴露物理路径 | 已有 projection 验证和 logical mounts 可复用 | 新接口必须复用现有验证，且返回值只能包含逻辑路径 |

### 修改方案

#### 1. 在 WorkspaceFilePort 增加窄解析接口

为 package-private `WorkspaceFilePort` 增加：

```ts
resolveSkillResourcePath?(
  relativePath: string,
  context: ToolExecutionContext,
): Promise<
  | { readonly status: 'resolved'; readonly logicalPath: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[] }
>;
```

该接口不接收 projection key、physical root、Agent/Owner id 或候选 roots。可信 scope 只来自 `ToolExecutionContext`，解析 owner 通过现有 `resolveView(context)` 获得当前 `systemResources` root，再调用 `discoverVerifiedSkillRoots(view)`。它是 `agent-capability` 已导出 SPI 上的向后兼容可选扩展，不修改 `agent-contracts`；产品的 `createWorkspaceFilePort` 始终实现该方法，历史测试或外部注入的自定义 port 缺少该方法时 Bash 保持原 argv，不产生类型级破坏。

输入 grammar 固定为：

```text
skill-relative-resource = "scripts/" resource-tail
                        | skill-name "/scripts/" resource-tail
resource-tail           = safe-segment *("/" safe-segment)
```

接口拒绝语法不安全输入并返回 `not-found`，不把绝对路径、空 segment、`.`、`..`、反斜杠或 known logical root 解释为候选。带首段 Skill 名时，只保留 root 中 `skillName` 精确相等的候选；不带时检查全部 verified roots。

对每个候选，先重新确认 cached/committed root 有效，再以 projection Skill physical root 为 containment base 验证目标：逐 segment `lstat` 拒绝 symlink/junction/reparse escape，目标必须是普通文件，且目标 logical path 必须存在于已提交 manifest 所代表的完整 projection。接口只收集 `.nextagent/skills/<projection>/<skill>/<resource>` logical paths，排序并去重后返回：零个 `not-found`、一个 `resolved`、至少两个 `ambiguous`。

#### 2. Bash 只识别直接解释器脚本执行

在 `parseBashInputForModelCorrection` 和既有 Python invocation guard 之后增加异步 preparation：

```text
if executable basename not in {python, python3, bash, sh}: unchanged
if args[0] is an interpreter mode/flag: unchanged
if parsed token sequence contains shell composition token: unchanged
if args[0] does not satisfy scripts grammar and interpreter extension: unchanged
resolution = WorkspaceFilePort.resolveSkillResourcePath(args[0], context)
resolved  -> replace args[0] only
not-found -> unchanged
ambiguous -> throw stable SafeError before sandbox
```

识别基于 parse 后的 token 边界，不扫描或替换原始 `command` 字符串。command-string mode 与 argv mode 因而使用同一规则。shell composition 的穷尽首版 token 为 `|`、`||`、`&`、`&&`、`;`、`>`、`>>`、`<`、`<<`，以及包含 `$(`、反引号的 token；一旦出现就跳过全部补全。`python -c`、`python -m`、`python -`、`bash -c` 和 `bash -lc` 因首参数不是受支持脚本路径而跳过。

解释器与后缀映射固定为：

| executable basename | 允许脚本后缀 |
|---|---|
| `python`、`python3` | `.py` |
| `bash`、`sh` | `.sh` |

Windows 或 Linux 下 executable 若包含路径，不参与兼容补全；首版只接受上述四个精确 executable token，避免把未知 wrapper 或不同解释器策略静默纳入。

`ambiguous` 由 Bash 转换为 `AgentError`：code `SKILL_RESOURCE_PATH_AMBIGUOUS`、category `VALIDATION`、`retryable=false`，safeDetails 只含排序后的 `candidates` 与不回显原始输入的修复提示。错误发生在任何 sandbox method 调用前。

#### 3. 保持原始诊断输入与 sandbox 逻辑输入分离

Tool invocation 的 canonical `toolInput` 继续来自模型原始参数，不修改 invocation input object。补全只创建新的 parsed argv array 并传给 sandbox。现有 sandbox runtime diagnostic 可以记录实际提交的逻辑 argv，但不得记录 physical path；本 change 不新增公共 observability 字段。

#### 质量属性影响

| 质量属性 | 规范依据 | Function 内机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Skill 相对脚本解析保持 projection 安全边界` | scope-derived view、committed manifest、link/containment validation、logical-path-only result、ambiguity fail closed | 跨 scope、未提交 projection、链接逃逸、物理路径泄露和 sandbox 零调用负例 |
| 可靠性/恢复 | `Bash 补全唯一匹配的 Skill 相对脚本路径` | 无匹配保持既有行为；不支持或复杂命令不改写；唯一匹配才改变 argv | 两种输入模式、解释器映射、无匹配和复杂表达式 characterization |
| 可测试性 | `Bash 补全唯一匹配的 Skill 相对脚本路径`、`Skill 相对脚本解析保持 projection 安全边界` | 三态 resolver 将路径 authority 与 Bash recognition 分离 | resolver 单元测试与 Bash 黑盒调用测试分别覆盖 |

#### 备选方案（Alternatives Considered）

- 对原始 Bash command 做正则替换：拒绝。无法可靠区分脚本参数、搜索文本、引号内代码和 shell 嵌套语义，会破坏原输入并扩大误改写面。
- Skill 激活后改变 Bash default cwd：拒绝。会改变所有 workspace 相对参数和命令的语义，也需要修改 sandbox filesystem contract，超出兼容目标。
- 把 active Skill root 写入 `flowVariables` 并只匹配最后激活 Skill：拒绝。一个请求可能装载多个 Skill，且 projection authority 不应由编排层的可变提示状态替代。
- Bash 直接枚举 `.nextagent/skills`：拒绝。会复制 projection manifest、scope 和 containment 规则，破坏 owner 边界。

## 验证策略（Verification Strategy）

- unit：覆盖直接解释器识别、后缀映射、两种相对 path grammar、复杂 shell exclusion、无匹配保持和歧义错误映射。
- integration：使用真实 Skill projection 与 workspace-backed sandbox port，断言唯一匹配时 gateway 收到 root-qualified logical argv，同时原 Tool input 不变。
- security negative：实际构造两个同名脚本、跨 scope projection、未提交 manifest、损坏 manifest、symlink/junction/reparse escape、绝对路径、父级穿越和显式 logical root，断言不误执行、不泄露 physical path。
- characterization：既有 Bash command-string、structured argv、streaming、background、Python module/version guard 和 sandbox policy 测试保持通过。
- architecture/review：确认不修改 `agent-contracts`、sandbox cwd、public Tool schema 或 workspace file canonical identity，且 projection authority 仍由 `WorkspaceFilePort` 独占。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/command-script-tools/spec.md`：增加 Skill 相对脚本补全与 projection 安全 Requirements。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.5-执行命令和脚本.md`：更新描述、处理过程、结果与规格。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.3-命令执行工具.md`：更新 Skill 脚本兼容用例与质量保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无；不改变 frozen sandbox contract 或跨模块公共边界。
- `openspec/designs/modules/agent-capability.md`：更新 Bash preparation 与 WorkspaceFilePort 的 projection authority 协作。
- `openspec/designs/adr/`：无；本 change 未引入需独立长期保存的新架构决策。
- `openspec/designs/spec-to-design-map.md`：若 module 验证入口变化，同步 `command-script-tools` 的测试导航。

## 风险与取舍（Risks / Trade-offs）

- 同一 scope 多个 Skill 包含同名脚本时，旧命令从“通常文件不存在”变为明确歧义失败。该变化是防止错误 Skill 执行的必要 fail-closed 取舍；候选 logical paths 支持模型显式重试。
- 无匹配保持原行为意味着文件不存在仍由 sandbox 返回普通非零进程结果，不提前转换为 validation failure。这保留 Bash 既有完成语义，也避免通过 resolver 建立额外路径探测接口。
- 每次候选解析需要验证当前 scope projection 与目标文件。实现复用有界 cache 和目录上限；安全验证优先于减少少量文件系统调用。
- 首版不支持带解释器绝对路径、Windows `py` launcher 或 shell wrapper，兼容覆盖有限但行为确定。扩展解释器集合必须通过后续 OpenSpec 修改精确集合。

### 新增目录架构评审结论

`openspec/changes/add-skill-relative-execution-path-resolution/` 是本 change 唯一新增目录。owner 为 OpenSpec 变更治理流程，职责仅承载本功能的 proposal、delta spec、design 和 tasks；生命周期从 active change 创建开始，到实现验收后由归档流程迁入 archive。该目录不进入 TypeScript package exports、运行时资源、前端 artifact 或本地安装包，不改变构建、打包和运行时目录边界。评审结论：通过。

## 待确认问题（Open Questions）

无。
