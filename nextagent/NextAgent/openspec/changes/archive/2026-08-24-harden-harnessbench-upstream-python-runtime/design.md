## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | Windows 上游 task 与 Oracle 使用本次运行已预检的 Python 解释器，无法保证解释器身份时前置失败 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本设计消除 Windows 主机命令名差异对固定 HarnessBench 评分的影响，同时保持固定上游、真实 NextAgent 产品边界和主机全局环境不变。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`Windows 上游 Python 命令使用已预检解释器`

### 当前实现

`tests/harnessbench/run.mjs` 从 `HARNESSBENCH_PYTHON` 或平台默认命令选择 Python，并用该命令运行模型前置检查及 HarnessBench wrapper。传给上游 task 的环境固定了 `PYTHONPATH`、provider、grader 和本机 mock endpoint，但没有提供 `python3` 命令。

固定上游 commit 中部分 Oracle 通过 `subprocess.run(["python3", ...])` 启动校验脚本。Windows 主机即使已有可工作的 `python.exe`，也可能没有可执行的 `python3`；08-14 的 083、085 因此在 Agent 已产出工作区结果后发生 Oracle 失败。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 上游 `python3` 使用已预检解释器 | runner 只为自身 wrapper 选择 Python，上游继承主机 `PATH` | 上游命令名与已预检解释器没有身份绑定 |
| 命令只在当前运行生效 | 当前没有运行级工具链目录或 task 专用 `PATH` 前缀 | 缺少隔离的命令暴露边界 |
| 无法保证身份时在 task 前失败 | 现有前置检查不执行上游实际使用的 `python3` 命令 | 环境偏差会推迟到 Oracle 阶段并污染评分 |

### 修改方案

`tests/harnessbench/run.mjs` 继续作为评测 task 环境 owner，并采用以下唯一实现路径：

1. 在模型前置检查前，通过选定 Python 执行 `sys.executable` 查询，取得并校验绝对解释器路径；后续模型前置检查和 HarnessBench wrapper 均直接使用该路径，避免命令搜索再次漂移。
2. 模型前置检查成功后，仅在 Windows 把已预检的 `python.exe` 复制为 `<runRoot>/harness-toolchain/python3.exe`，并复制该解释器目录中启动所需的 `.dll` 文件；解释器路径含引号、换行或不是绝对路径，以及复制失败时 fail closed。该方式让上游保持直接进程启动，不引入 shell 参数重解释，也不要求符号链接权限。
3. 只在 `buildHarnessTaskEnvironment` 构造的 HarnessBench task 环境中，把该目录前置到现有 `PATH`，并把 `PYTHONHOME` 固定为已预检解释器报告的 prefix，使复制后的 launcher 使用同一标准库与安装环境。实现复用调用者环境中实际存在的 `Path`/`PATH` key，不修改 `process.env`。
4. 在第一个 task 前，使用已预检解释器启动一个最小 Python 探针；该探针以与上游相同的 `subprocess` 方式执行 `python3`。runner 比较两次运行的 implementation、Python 主次修订版本、`sys.prefix` 和 `sys.base_prefix` 指纹；不一致或命令失败即终止运行。
5. 非 Windows 平台不创建别名，不改变现有原生 `python3` 解析和 task 环境。

不复制或修改固定上游 cache，也不为任意 executable 建立通用 shim 机制。`harness-toolchain` 是运行输出的一部分，不进入 candidate、产品 artifact 或版本控制。

#### 新目录架构评审

`<runRoot>/harness-toolchain/` 是运行时生成的单层临时目录，owner 为 HarnessBench runner；唯一职责是保存本次运行的上游命令别名，生命周期与 run evidence 一致。它不属于版本控制目录，不参与 TypeScript workspace、构建或打包，也不被产品 runtime 加载。目录只接收已校验的解释器绝对路径生成物，不接收 task、模型或用户输入。评审结论：PASS。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `Windows 上游 Python 命令使用已预检解释器` | 上游命令绑定已预检解释器；建立或验证失败时前置终止 | 路径含空格、主机已有冲突 `python3`、命令缺失 |
| 可测试性 | `Windows 上游 Python 命令使用已预检解释器` | 使用与上游相同的 Python `subprocess` 探针验证命令身份 | 黑盒执行 `python3` 后的 runtime 指纹一致 |
| 审计/可追溯性 | `Windows 上游 Python 命令使用已预检解释器` | 别名保存在 runRoot 且不修改固定上游或全局环境 | 运行目录边界和调用者环境保持不变 |

## 验证策略（Verification Strategy）

- unit/characterization：构造包含冲突 `PATH` 的环境，验证 runner 只在返回的 task 环境中前置运行级目录，且不修改输入环境。
- integration：在 Windows 临时运行目录创建别名，通过 Python `subprocess` 实际执行 `python3`，断言子解释器与选定解释器的 implementation、版本和 prefix 指纹一致。
- negative case：拒绝非绝对、含引号或换行的解释器路径；命令探针不一致时前置失败。
- regression：运行 HarnessBench 无凭据测试目录，确认清单、评分、重试、报告和 fixed upstream 边界不变。
- OpenSpec：严格校验本 change 与全量 OpenSpec。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：合并新增 Requirement，并补充唯一所属 Function 元数据。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：更新前置条件和处理过程。
- Feature：无。
- `openspec/overview.md`：无。
- architecture：无。
- modules：无；该实现属于测试 runner，不是产品 package。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：如现有 `FN-10.13` 验证入口未覆盖 runner 工具链测试，则补充该入口；否则无。

## 风险与取舍（Risks / Trade-offs）

- 部分虚拟环境或非 CPython Windows 分发版可能无法仅通过复制 launcher 与同目录 DLL 保持相同 runtime 指纹；前置真实调用探针会在 task 前拒绝这类环境，运维可改用原生可用的 `python3.exe` 环境后重试。
- 别名目录保留在 run evidence 中会增加一个极小文件，但可支持复核且不会进入报告正文或产品 artifact。
- 当前只解决已证实的 Windows 命令名偏差；不增加跨平台通用命令虚拟化，避免扩大安全与维护边界。

## 待确认问题（Open Questions）

无。
