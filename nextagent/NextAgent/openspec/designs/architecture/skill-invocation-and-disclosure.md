# Skill 调用与资源披露

## 背景

Skill 调用基线由 `skill-tool`、`skill-manifest-contract`、builtin/local/SkillHub source 和统一 Capability Catalog 承载。Skill source 负责 discovery、manifest 解析、provider-private loading facts 和 catalog governance；runtime、core、context、model、channel 不解析 Skill source layout，也不读取 provider-private source path。

Skill resource access 的稳定基线不是新增模型侧资源读取工具，而是把 authorized Skill resources 接入统一 execution file access policy。该 policy 让 `read`、`glob`、`write`、`bash`、`python`、Skill script 和 generated code 通过同一 accepted-run execution workspace view 访问三类逻辑 root：

- `workspace/`：durable read/write files。
- `.nextagent/`：system-managed authorized resources，只读。
- `temp/`：run-scoped scratch files。
- `shared-data/`：LOCAL-only shared public input root, read-only, derived from `<workspaceRoot>/shared-data/`.

模型、tool result、safe error、stream payload、audit/log 只暴露 logical execution path、safe display path 或 stable safe reason，不暴露 host/source/provider-private path。

## Skill 资源投影

Skill Tool 成功加载 governed `SKILL.md` body 并通过 body boundary validation 后，才请求 Skill resource projection。稳定基线只投影 active Skill 顶层 `scripts/`、`references/`、`assets/` 下的授权资源；root-level `README`、`LICENSE`、`NOTICE` 或其他文件不进入投影。

投影目标固定为：

```text
.nextagent/skills/<skillProjectionKey>/<skill-name>/
  scripts/
  references/
  assets/
```

`skillProjectionKey` 从 governed provider id、Skill name、Skill version 派生，使用短 deterministic hash。provider id、Skill name、Skill version 的三元组必须是 immutable content identity；同一三元组映射到不同 body、resource set 或 source facts 时，catalog/discovery 必须 fail closed，不能通过追加内容 token 规避冲突。

Skill Tool 在同一条 hidden generated Skill load message 中先注入 root-relative resource root location：

```text
.nextagent/skills/<skillProjectionKey>/<skill-name>/
```

随后附加原始 Skill body。稳定基线不改写 Skill body 正文、代码块或示例，也不注入 `/work/...` sandbox absolute path。模型应使用被注入的 root location 解析 body 中的相对资源引用，例如 `references/a.md` 映射到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/a.md`。

## 投影提交协议

`WorkspaceFilePort.projectSkillResources(...)` 是 system-only projection 写入口，只由 Skill Tool 调用。普通 file tool、sandbox、Skill script 和 generated code 不获得 `.nextagent` 写权限。

投影执行协议：

1. 根据 governed Skill identity 派生 `skillProjectionKey`。
2. 检查 `.nextagent/skills/<skillProjectionKey>/.projection.json` committed marker；marker 匹配同一 provider id、Skill name、Skill version 和 projection format 时复用 target，不调用 provider list/read。
3. marker miss 时通过 `.nextagent/skills/.locks/<skillProjectionKey>/` 获取 filesystem lock；已有 lock 时 bounded wait 并在释放后复查 marker。
4. 获取 lock 后再次复查 marker，仍 miss 才调用 provider `listSkillResources(...)` 读取 safe metadata。
5. 逐项调用 provider `readSkillResource(...)`，流式写入 `.nextagent/skills/.staging/<operation-key>/<skill-name>/`，并校验数量、大小、路径深度、路径长度、media/encoding 和 staged tree。
6. 删除未提交或旧格式 target，将 staged `<skill-name>/` rename 到 final target，最后写 committed marker。
7. 任一步失败都不返回 resource root location，staging/lock/旧 target 由 cleanup job 后台清理。

Provider 边界只暴露 safe relative path、resource kind、size metadata 和按项 content stream。manifest path、artifact ref、frontmatter hash、zip/blob/registry loading key 等 private facts 留在 provider 内部，不进入 runtime、core、context、model、channel、safe error 或 audit。

## Execution File Access 协作

Accepted run 的 execution workspace view 由 `agent-runtime` resolver 单入口派生。Capability 层通过 `ToolExecutionContext` 中已有 trusted facts 调用 resolver-backed `WorkspaceFilePort` 或 sandbox port，不能从 app 启动期静态 `workspaceDir`、Skill source path 或模型文本派生物理 root。已提交且通过身份/完整性校验的 Skill projection 在同一 execution scope 内是持续只读 authority；新 run 或新进程从该 committed fact 恢复，不通过历史消息或 current-run reauthorization 补授权。

Path 解释规则：

- root-aware Read、Write、Edit、Glob、Grep 与 sandbox command 的无已知 root 前缀相对路径统一从 accepted-run execution view 根解释；LOCAL 映射当前物理 `scopeBase`，REMOTE/PaaS 映射 `/work`，公共结果只保留规范化逻辑路径。
- `workspace/` 继续是 durable read/write root；需要跨 run 保留的产物应显式使用 `workspace/...`，`temp/...` 只用于当前 run 临时文件。
- root-qualified path 例如 `workspace/a.txt`、`.nextagent/skills/.../references/a.md`、`temp/work.csv` 只有 root-aware consumer 且授权时可解析。
- known-root access mode、Agent-scoped directory authority、Skill projection authorization 和 link containment 在默认根统一后仍依次生效；`"."` 的目录授权不能扩大 `.nextagent/` 或 `shared-data/` 写权限。
- Glob/Grep 的缺省搜索展开为普通 execution view 根与当前 view 的受授权 roots；普通根首层排除全部 known-root 目录，再按可信映射受控重入，并让全部目标共享一个排序、遍历、读取和结果预算。
- Skill body 相对资源引用由模型根据 injected resource root location 拼接，不创建隐式 Skill cwd。
- sandbox command 在 LOCAL mode 可从物理 `scopeBase` 解析 root-qualified paths，在 REMOTE/PaaS mode 从 `/work` 解析相同 logical paths。

`.nextagent/` 是 system-managed read-only projection。file write/edit tools、sandboxed commands、Skill scripts 和 generated code 不能创建、修改、rename 或删除 `.nextagent` 内容；scripts 位于 `.nextagent/.../scripts/` 只表示可读资源，执行仍必须通过 capability binding、Skill metadata、request-local policy、risk policy 和 sandbox policy。

`shared-data/` 是 local public input root, not output space. Read/Glob/Grep and sandbox root-aware path handling may read it when LOCAL execution view exposes it. Write/Edit, generated code and Skill scripts must not create, modify, rename or delete shared-data files. Shared Python scripts can run only through an explicit interpreter and explicit root-qualified script path; shared-data is not added to `PATH`, `PYTHONPATH`, module search path or executable search authority.

## Sandbox 和 Deployment Mode

Dynamic execution 必须经过 sandbox gateway boundary。Capability sandbox port 使用同一 run view 生成 `SandboxExecutionRequest.filesystem`：

- `workspace/` read/write。
- `.nextagent/` read-only，只有被授权的 script resource 可执行。
- `temp/` read/write。

REMOTE/PaaS mode 将 execution view 映射到容器内 `/work`：

```text
/work/workspace   RW
/work/.nextagent  RO
/work/temp        RW
cwd               /work
```

LOCAL development mode 可使用物理 `scopeBase` 作为 cwd，以便 root-qualified relative paths 在本机进程中解析，但只能声明 best-effort enforcement。LOCAL mode 可对 committed projection subtree 施加只读 ACL/chmod；清理失败记录 safe diagnostics 并延迟重试，不能影响 request terminal handling。

Gateway adapter 从 `filesystem.defaultCwd` 和 `temp` root logical path 派生标准 temp env。REMOTE/PaaS canonical temp 为 `/work/temp`；LOCAL temp 为 run-derived physical temp root。

## Cleanup 和审计

Cleanup 不属于 runtime terminal path。`agent-capability` 拥有 Skill projection、projection staging、stale lock 和 LOCAL run temp cleanup jobs；`agent-app` 只注册 jobs；gateway adapter 按 deployment mode 调度执行。REMOTE/PaaS shared storage cleanup 必须由 platform lifecycle、CronJob、singleton worker 或 gateway-adapter-configured platform worker 承载，业务 pod 不应各自扫描删除 shared projection directories。

Audit/log 记录 operation、root kind、safe Skill id、safe display path、status、reason code、duration、byte counts 和 sandbox outcome。不得记录 prompt、模型输出、file body、script source、full stdout/stderr、raw provider error、raw path、credential 或高基数字段。

## 文档主承载

- 行为契约：`openspec/specs/skill-resource-access/spec.md`。
- Agent assembly 和 execution workspace public contract：`openspec/specs/agent-package-assembly/spec.md`、`openspec/specs/ts-core-contracts/spec.md`。
- 配置根和 runtime workspace root 派生：`openspec/specs/app-config-schema/spec.md`、`openspec/designs/architecture/configuration-boundary.md`。
- Runtime resolver 和 run view lifecycle：`openspec/designs/modules/agent-runtime.md`。
- WorkspaceFilePort、Skill Tool、sandbox request preparation 和 cleanup job：`openspec/designs/modules/agent-capability.md`。
- Local sandbox adapter 和 scheduled execution：`openspec/designs/modules/agent-platform-gateway-local.md`。
- Local shared input root trade-off: `openspec/designs/adr/local-shared-data-root.md`。
