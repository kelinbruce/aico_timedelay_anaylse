# Model authoring v2 migration

该目录提供面向 Agent 开发者源码的离线升级工具。它不读取或修改 NextAgent 的 `packages/` 源码，也不会让运行时兼容旧格式。

## 环境

- Python 3.11 或更高版本
- 仅使用 Python 标准库，无需安装依赖

## 默认目录

以开发者项目根目录为 `--root` 时，工具默认检查：

```text
<root>/
  application.yaml
  agents/**/agent.yaml
  agents/**/prompts/**/*.yaml|yml
  agents/**/skills/**/SKILL.md
  skills/**/SKILL.md
```

工具不会读取 system config 中的路径字段来扩大扫描范围，并排除 `node_modules`、`.nextagent-migration`、build、dist、coverage 和 cache 目录。扫描范围内遇到非排除目录 symlink 或目标资产 symlink 时会安全失败，不会跟随或静默漏迁移。

## 使用方式

### 获取工具

迁移工具随 NextAgent 源码提供，不进入 `pack:release`、`pack:backend` 或 `pack:front` 运行包。请从准备升级到的 NextAgent 版本源码中复制以下单文件到本地临时工具目录：

```text
migration/model-authoring-v2/migrate.py
```

只需复制 `migrate.py`，不需要复制测试文件，也不需要把它放入待迁移的 Agent 项目。脚本没有相对文件依赖，可以从任意工作目录执行；`--root` 始终指向开发者自己的 Agent 项目根目录。工具应与目标 NextAgent runtime 使用相同 release/tag 的版本，迁移和验证完成后可删除本地副本。

Linux/macOS 示例：

```bash
mkdir -p ~/nextagent-tools
cp /path/to/NextAgent/migration/model-authoring-v2/migrate.py ~/nextagent-tools/migrate.py
```

Windows PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force C:\tools\nextagent | Out-Null
Copy-Item C:\path\to\NextAgent\migration\model-authoring-v2\migrate.py C:\tools\nextagent\migrate.py
```

### 执行迁移

假设脚本已复制为 `/path/to/nextagent-tools/migrate.py`，先执行 dry-run。默认只生成计划，不写文件：

```bash
python /path/to/nextagent-tools/migrate.py --root /path/to/agent-project
```

确认计划后显式写入：

```bash
python /path/to/nextagent-tools/migrate.py --root /path/to/agent-project --write
```

Windows 示例：

```powershell
py -3.11 C:\tools\nextagent\migrate.py --root D:\projects\my-agent
py -3.11 C:\tools\nextagent\migrate.py --root D:\projects\my-agent --write
```

某类路径不采用默认布局时，可显式覆盖；重复参数表示多个 root。同一分类一旦提供 override，就不再扫描该分类的默认位置：

```bash
python /path/to/nextagent-tools/migrate.py \
  --root /path/to/agent-project \
  --system-config config/application.yaml \
  --agent-root src/agents \
  --prompt-root src/prompts \
  --skill-root src/skills
```

所有路径都必须位于 `--root` 内。需要迁移根目录之外的资产时，应把 `--root` 调整为这些资产的共同可信根目录。

## 转换内容

- system config：flat `profileId/providerKind/modelName/modelOptions` 转为 parent `providerId` + child `models[].modelId`，并展开 canonical inference fields。
- Agent definition：`modelProfileIds` 转为 `modelIds`；`runtimeSettings.defaultModelProfileId` 转为 top-level `defaultModelId`。
- Prompt Template：`match.model.{providerKind,modelName}` 转为 scalar `match.model: modelId`。
- Skill：保留受支持的 `model` / `metadata.nextagent.model` authoring 入口，把其值统一为 canonical `modelId`，并把扩展 options 收敛到 `providerOptions`。

同一个 system config 映射用于全部 Agent、Prompt 和 Skill。工具不会猜测重复 model identity、冲突 provider access、disabled/unknown reference 或无法无损表达的 Model Gateway access；这些情况会在写入前失败并给出稳定 reason code。

旧 `modelName` 若是 `env:` 引用，目标 system config 可以继续保留该动态值，但 Agent/Prompt/Skill authoring 不解析环境引用。仅当系统恰好只有这一个已启用模型时，工具会把 Agent 的同一显式引用改成省略 `modelIds/defaultModelId`，等价地继承唯一系统模型；Prompt、Skill 或多模型 Agent 对动态模型的引用无法无损转换，会以 `DYNAMIC_MODEL_REFERENCE_REQUIRES_MANUAL_MIGRATION` 阻塞并要求人工固定 canonical `modelId`。

## YAML 支持边界

JSON 内容即使使用 `.yaml` 扩展名，也由标准库 `json` 读取。YAML 支持开发者 authoring 所需的受限子集：

- 空格缩进的 mapping 和 sequence
- plain、single-quoted、double-quoted scalar
- JSON-compatible flow mapping/sequence
- Prompt/Skill 使用的 literal block（`|` / `|-`）

以下输入会安全失败，需要先手工简化：tab 缩进、任何 YAML 注释、folded block（`>`）、keep chomping（`|+` / `>+`）、duplicate key、anchor/alias、merge key、tag、multi-document 和无法唯一解析的 flow syntax。该限制避免无依赖工具静默改变 YAML 语义。

## 写入、备份与恢复

`--write` 会先完成全项目 plan，再在以下位置创建原文件备份和 journal：

```text
<root>/.nextagent-migration/model-authoring-v2/<run-id>/
```

每个文件在替换前再次校验 SHA-256，并通过同目录临时文件和 `os.replace` 更新。单次运行中任一替换失败时，工具会立即恢复已经替换的文件；若某个目标同时被开发者修改，自动回滚会保留该新内容并把 run 标记为 `rollback_failed`，不会用备份覆盖。若进程被外部强制终止或自动回滚未完成并留下 `prepared`、`applying` 或 `rollback_failed` journal，可显式恢复：

```bash
python /path/to/nextagent-tools/migrate.py \
  --root /path/to/agent-project \
  --recover <run-id>
```

恢复时必须使用同一 NextAgent release/tag 对应的脚本版本。完成目标 runtime 启动验证前，应保留脚本副本和 `.nextagent-migration/` 备份。

成功迁移后再次运行应输出 `NO_CHANGES`。报告只包含相对文件标识、change reason 和 model identity 映射，不包含 endpoint、credential 或 provider option value。

恢复会先校验完整 journal、全部备份哈希和当前目标哈希，再开始写入；目标文件若已被开发者继续修改，会以 `RECOVERY_TARGET_CHANGED` 阻塞，不覆盖新内容。此时应先人工保存/合并该修改，再决定后续恢复方式。

`.nextagent-migration/` 保存原始开发者源码备份，只应用于本地恢复，不是交付资产。请把该目录加入开发者项目的 `.gitignore`，不要提交、上传或放入发布包；确认目标 runtime 启动和资产检查通过后，再按项目的数据保留策略安全清理已不需要的 run。

## 测试

以下命令面向维护迁移工具的 NextAgent 源码贡献者；普通 Agent 开发者无需复制或运行测试文件：

```bash
python migration/model-authoring-v2/test_migrate.py
```

测试使用 `unittest` 和标准库临时目录，无额外依赖。
