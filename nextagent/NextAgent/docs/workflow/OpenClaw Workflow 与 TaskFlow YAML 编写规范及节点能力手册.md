# OpenClaw Workflow 与 TaskFlow YAML 编写规范及节点能力手册

我无法直接生成可下载的文件链接，你可以复制下方完整的 Markdown 源码，在本地新建文本文件，粘贴后将后缀改为 `.md` 即可得到可本地查看、编辑的规范文档。

```Markdown
# OpenClaw Workflow 与 TaskFlow YAML 编写规范及节点能力手册
**文档版本**：v1.0  
**适用范围**：OpenClaw 声明式工作流编排体系，覆盖基础 Workflow 与进阶 TaskFlow 两大引擎  
**更新日期**：2026-07-01

---

## 一、文档概述
本文档完整定义 OpenClaw 两大编排引擎的 YAML 语法规则、节点能力、配置约束与最佳实践，用于指导自动化任务、工具链串联、多 Agent 协作、长周期业务流等场景的工作流开发与维护。

两大编排体系定位差异：
- **基础 Workflow**：轻量线性流水线引擎，主打简单多步骤串行+显式并行，无状态持久化，学习成本低，适合短周期、一次性、定时类自动化任务。
- **进阶 TaskFlow**：持久化状态编排引擎，基于状态机+DAG调度模型，支持断点续跑、人工审批、循环跳转、后台运行，适合长周期、多分支、需人工介入的复杂业务流。

---

## 二、通用 YAML 编写规范
本规范为 Workflow 与 TaskFlow 共同遵守的基础编写准则。

### 2.1 命名规范
| 命名对象 | 规则 | 示例 |
|----------|------|------|
| 工作流名称/文件名 | 仅允许小写字母、数字、连字符（`kebab-case`），禁止中文、空格、下划线、特殊符号 | `daily-report.yaml` |
| 步骤 ID/名称 | 语义化命名，见名知意，使用 `kebab-case` | `fetch-user-data` |
| 输出变量 | 使用业务含义明确的名称，避免模糊命名 | `audit_result` 而非 `tmp` |
| 环境变量 | 全大写下划线分隔（`UPPER_SNAKE_CASE`） | `API_SECRET_KEY` |

### 2.2 格式与缩进规范
1. 统一使用 **2 空格缩进**，严格禁止 Tab 符；同级列表项对齐，嵌套层级清晰。
2. 键值对冒号后必须跟一个空格，禁止无空格写法。
3. 多行文本（提示词、脚本、长描述）使用 `|` 块标量语法，保留换行格式；禁止单行堆砌长文本。
4. 单文件缩进层级不超过 5 层，过深逻辑建议拆分步骤或拆分工作流文件。
5. 注释使用 `#` 开头，与内容间隔一个空格，仅用于说明复杂业务逻辑与注意事项。

### 2.3 数据流转与安全规范
1. 跨步骤数据引用必须显式声明输出变量，禁止依赖隐式传递。
2. 结构化数据优先使用 JSON 格式传递，避免字符串解析误差。
3. **绝对禁止硬编码敏感信息**（API 密钥、密码、Token），统一通过环境变量 `${VAR_NAME}` 传入。
4. 外部输入参数必须做合法性校验，高危命令类步骤增加白名单限制。

---

## 三、基础 Workflow YAML 规范
### 3.1 基础规则
#### 文件与触发
- **存放目录**
  - 全局生效：`~/.config/openclaw/workflows/`
  - 项目级：`workspace/workflows/`
- **支持格式**：`.yaml` / `.yml` / `.json`
- **触发命令**：`claw workflow run <工作流名称> [--args key=value]`
- **执行模型**：步骤默认按书写顺序串行执行，遇到并行组则并发调度，执行完成后释放全部资源，无状态持久化。

### 3.2 根级字段总览
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | string | 是 | - | 工作流唯一标识，建议与文件名保持一致 |
| `description` | string | 否 | 空 | 工作流功能描述，用于列表展示与检索 |
| `args` / `input` | object | 否 | {} | 输入参数定义，支持设置默认值，运行时可动态覆盖 |
| `steps` | array | 是 | - | 步骤定义数组，默认按顺序串行执行 |
| `trigger` | object | 否 | 无 | 自动触发器配置，支持定时、文件监听、Webhook 三类 |
| `timeout` | int | 否 | 3600 | 全局超时时间，单位秒，超时后强制终止并释放资源 |
| `env` | object | 否 | {} | 全局环境变量，所有步骤均可通过 `${变量名}` 引用 |

### 3.3 步骤节点与核心能力
每个步骤必须包含唯一标识与动作类型，输出变量可通过 `{{变量名}}` 在后续步骤插值引用；跨并行组引用需使用完整路径 `{{ steps.步骤名.output.字段名 }}`。

#### 3.3.1 通用步骤字段
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 步骤唯一标识，用于输出引用与日志定位 |
| `action` | string | 是 | 动作类型，决定步骤执行逻辑 |
| `output` | string | 否 | 步骤输出变量名，后续步骤可通过变量名引用执行结果 |
| `retry` | object | 否 | 失败重试配置，支持固定间隔与指数退避 |
| `continue_on_failure` | bool | 否 | false | 非关键步骤失败后不中断主流程，继续向下执行 |
| `on_failure` | array | 否 | 无 | 步骤失败后执行的补救动作数组，如告警、回滚、资源清理 |

#### 3.3.2 核心动作类型详解
##### 1. AI 推理节点：`action: run`
调用大模型执行自然语言任务，支持自主工具调用与多轮 ReAct 思考，可指定模型规格。
```yaml
- name: generate-summary
  action: run
  prompt: |
    基于以下提交记录生成项目日报：
    {{ commit_logs }}
  model: claude-sonnet-4      # 可选，指定模型
  max_turns: 5                # 可选，最大工具调用轮次
  temperature: 0.3            # 可选，模型采样温度
  output: daily_summary
```

**核心能力**：内容生成、代码编写、数据分析、逻辑推理、自主调用工具完成复杂任务。

##### 2\. 技能调用节点：`action: skill`

调用官方/自定义 Skill，复用封装好的第三方工具与业务逻辑。

```YAML
- name: send-notify
  action: skill
  skill: slack-notify
  params:
    channel: "#dev-alerts"
    message: "{{ daily_summary }}"
```

**核心能力**：对接第三方服务、复用标准化能力、封装复杂业务逻辑。

##### 3\. 命令执行节点：`action: command`

执行本地 Shell 命令，支持指定工作目录、环境变量与权限控制。

```YAML
- name: pull-code
  action: command
  command: "git pull origin main"
  workdir: "~/apps/my-service"   # 可选，指定执行工作目录
  timeout: 120                   # 可选，单步骤超时
  output: pull_result
```

**核心能力**：系统命令执行、脚本调用、文件操作、本地工具链执行。

##### 4\. 条件分支节点：`action: condition`

基于布尔表达式实现 if\-else 流程分流，支持结果校验与流程熔断。

```YAML
- name: check-test-result
  action: condition
  condition: "{{ test_result.exit_code }} == 0"
  on_true:
    - name: deploy-service
      action: command
      command: "docker compose up -d"
  on_false:
    - name: alert-failure
      action: skill
      skill: slack-notify
      params:
        message: "测试失败，部署已终止"
```

**核心能力**：布尔表达式判断、分支执行、结果校验、流程熔断。

##### 5\. 并行组节点：`parallel`

非 action 类型，包裹多个子步骤实现并发执行，全部子步骤完成后才进入后续流程。

```YAML
- name: multi-source-research
  parallel:
    max_concurrent: 3      # 可选，最大并发数，用于限流节能
    steps:
      - name: search-news
        action: skill
        skill: web-search
        params:
          query: "{{ input.topic }} 行业新闻"
      - name: search-papers
        action: skill
        skill: web-search
        params:
          query: "{{ input.topic }} 学术论文"
```

**核心能力**：无依赖任务并发执行、多数据源并行抓取、缩短整体执行时长。

### 3\.4 高级特性配置

#### 3\.4\.1 失败重试机制

外部依赖类步骤建议配置重试策略，网络类场景推荐指数退避。

```YAML
- name: api-request
  action: command
  command: "curl -sf https://api.example.com/data"
  retry:
    max_attempts: 3
    delay: 10s
    backoff: exponential  # 可选值：fixed（固定间隔）/ exponential（指数退避）
```

#### 3\.4\.2 触发器配置

```YAML
# 定时触发
trigger:
  schedule:
    cron: "0 9 * * 1-5"
    timezone: "Asia/Shanghai"

# 文件变更触发
trigger:
  watch:
    paths: ["src/**/*.ts"]
    events: ["modify", "create"]

# Webhook 触发
trigger:
  webhook:
    path: "/hooks/pr-review"
    method: POST
```

### 3\.5 节能优化能力

|能力项|说明|配置方式|节能收益|
|---|---|---|---|
|模型按需加载|模型实例仅执行到对应步骤时加载，步骤完成后空闲超时自动释放显存与进程|引擎默认开启；可通过 `model_keepalive` 自定义保留时长|混合步骤场景降低 30%\+ 平均显存占用|
|并行组并发限流|限制并行组最大并发数，防止批量任务瞬间打满 CPU/显存/API 配额|`parallel.max_concurrent` 字段设置|平滑资源消耗，降低限流触发概率|
|结果缓存复用|相同输入下直接命中历史结果，跳过重复执行，适合配置读取、固定查询类步骤|`cache.enabled` \+ `cache.ttl` 配置|高频定时任务减少 60%\+ 重复执行开销|
|同模型实例复用|同一工作流内多个同模型 `run` 步骤自动复用实例，避免重复冷启动|引擎默认开启，无需额外配置|减少模型加载开销与内存占用|
|分支资源提前释放|条件分支判定后，未命中分支的预加载资源自动回收|引擎默认开启，无需额外配置|避免无效资源占用|

**缓存配置示例**：

```YAML
- name: load-config
  action: command
  command: "cat ./config/prod.yaml"
  cache:
    enabled: true
    ttl: 3600  # 缓存有效期，单位秒
```

### 3\.6 完整可运行示例

```YAML
name: auto-deploy
description: 代码变更后自动执行测试并部署，失败发送告警
args:
  environment:
    default: "production"
timeout: 1800
env:
  NODE_ENV: production

steps:
  - name: pull-latest-code
    action: command
    command: "git pull origin main"
    workdir: "~/apps/my-service"

  - name: run-unit-tests
    action: command
    command: "npm run test:ci"
    workdir: "~/apps/my-service"
    output: test_result
    cache:
      enabled: true
      ttl: 300

  - name: judge-deploy
    action: condition
    condition: "{{ test_result.exit_code }} == 0"
    on_true:
      - name: build-image
        action: command
        command: "docker build -t my-service:latest ."
        workdir: "~/apps/my-service"
      - name: deploy-container
        action: command
        command: "docker compose up -d"
        workdir: "~/apps/my-service"
    on_false:
      - name: send-alert
        action: skill
        skill: slack-notify
        params:
          channel: "#ops-alerts"
          message: "部署失败：测试未通过\n输出：{{ test_result.stdout }}"

trigger:
  watch:
    paths: ["~/apps/my-service/src/**/*"]
    events: ["push"]
```

---

## 四、TaskFlow YAML 规范

### 4\.1 基础规则

#### 文件与触发

- **存放目录**：`~/.openclaw/workspace/taskflows/`

- **支持格式**：仅 `.yaml`

- **触发命令**：`openclaw taskflow run <工作流名称> [--params key=value]`

- **执行模型**：基于状态机\+DAG调度，每步状态自动落盘，支持断点续跑、后台运行、人工审批、循环跳转；数据引用格式为 `${步骤id.result.字段名}`。

### 4\.2 根级字段总览

|字段|类型|必填|默认值|说明|
|---|---|---|---|---|
|`name`|string|是|\-|工作流唯一标识|
|`description`|string|否|空|功能与业务场景描述|
|`version`|string|否|1\.0\.0|语义化版本号，用于状态兼容与迭代追踪|
|`timeout`|int|否|7200|全局超时时间，单位秒|
|`incremental`|bool|否|false|增量执行开关，输入无变更时复用历史结果|
|`default_resource_spec`|string|否|standard|全局默认算力规格，可选 `lite` / `standard` / `high`|
|`steps`|array|是|\-|步骤节点数组，通过 ID 实现跳转与依赖声明|

### 4\.3 步骤节点通用字段

TaskFlow 每个步骤为独立状态节点，通过跳转字段实现分支与循环。

|字段|类型|必填|说明|
|---|---|---|---|
|`id`|string|是|步骤唯一标识，用于跳转引用与依赖声明|
|`name`|string|否|步骤可读名称，用于日志与状态展示|
|`tool`|string|是（执行类节点）|调用的工具/技能名称，支持所有内置工具与已安装 Skill|
|`params`|object|否|工具入参，支持 `${步骤id.result.xxx}` 跨步骤引用|
|`on_success`|string|否|执行成功后跳转的步骤 ID|
|`on_failure`|string|否|执行失败后跳转的步骤 ID|
|`retry`|int / object|否|失败重试次数或完整重试配置|
|`approval`|string|否|设为 `required` 时执行到该步暂停，等待人工确认/驳回|
|`dependsOn`|array|否|声明前置依赖步骤 ID，所有依赖完成后才会执行|
|`resource_spec`|string|否|单步骤算力规格，覆盖全局默认值|
|`step_timeout`|int|否|单步骤超时时间，单位秒|

### 4\.4 核心节点能力

#### 4\.4\.1 工具执行节点

最基础的执行单元，调用任意 Skill/内置工具完成具体任务，支持所有 OpenClaw 生态工具。

```YAML
- id: search-news
  name: 搜索AI行业热点
  tool: tavily_search
  params:
    query: "AI大模型 最新动态 2026"
    max_results: 10
  retry: 2
  resource_spec: standard
  on_success: extract-summaries
  on_failure: alert-error
```

#### 4\.4\.2 人工审批节点

执行到该步骤时暂停流程，释放运行资源，等待人工确认或驳回后继续。

```YAML
- id: approve-deploy
  name: 生产发布审批
  approval: required
  idle_sleep: 300    # 等待300秒后自动休眠释放资源
  on_success: execute-deploy
  on_failure: cancel-deploy
```

#### 4\.4\.3 DAG 依赖式并行

通过 `dependsOn` 显式声明前置依赖，调度器自动拓扑排序，无依赖的节点自动并发执行，无需手动分组，适合复杂依赖链路。

```YAML
steps:
  - id: init
    tool: init-env
    params: {}

  # 两个节点无互相依赖，自动并行执行
  - id: fetch-api
    dependsOn: ["init"]
    tool: http-get
    params:
      url: "https://api.example.com/data"

  - id: fetch-db
    dependsOn: ["init"]
    tool: db-query
    params:
      sql: "SELECT * FROM daily_stats"

  - id: merge-report
    dependsOn: ["fetch-api", "fetch-db"]
    tool: llm-summarize
    params:
      api_data: "${fetch-api.result}"
      db_data: "${fetch-db.result}"
```

#### 4\.4\.4 条件循环实现

通过成功/失败跳转 \+ 质量校验节点，实现 while 条件循环，常用于迭代优化、重试类场景。

```YAML
steps:
  - id: optimize-content
    tool: llm-optimize
    params:
      draft: "${previous.result}"
    on_success: check-quality
    retry: 5

  - id: check-quality
    tool: quality-evaluate
    params:
      content: "${optimize-content.result}"
    on_success: finish
    on_failure: optimize-content  # 质量不达标则回到优化步骤重试
```

#### 4\.4\.5 批量展开节点（fan\_out）

基于数组输入动态生成并行子步骤，实现 for\-each 批量遍历，最终自动汇总所有子结果为数组。

```YAML
- id: batch-code-review
  fan_out:
    source: "${get-file-list.result.files}"
    item_key: "file_path"
    max_concurrent: 4
    batch_size: 10      # 每10条合并为一次调用，减少开销
    step:
      tool: code-audit
      params:
        file: "{{ file_path }}"
  output: all_reviews
```

### 4\.5 节能优化能力

|能力项|说明|配置方式|节能收益|
|---|---|---|---|
|断点续跑增量执行|任务中断后从断点恢复，已成功步骤无需重复执行；输入无变更时直接复用历史结果|根级 `incremental: true` 开启|异常中断场景节省 50%\+ 重复算力|
|审批空闲休眠|等待人工审批、外部回调时，达到阈值后自动释放内存、模型与连接资源，触发时唤醒|步骤 `idle_sleep` 字段设置等待时长|长等待任务释放 90%\+ 运行时资源|
|步骤级算力分级|每个步骤独立指定算力规格，简单任务用轻量规格，复杂推理用高性能规格|`resource_spec` 字段指定 `lite/standard/high`|混合复杂度任务降低 40%\+ 平均算力成本|
|批量任务合并|`fan_out` 批量任务自动合并小颗粒度请求，支持批量推理接口|`fan_out.batch_size` 字段设置|大批量小任务减少 70%\+ API 调用次数|
|后台任务降权|后台静默运行的任务自动降低 CPU、IO、网络优先级，不抢占前台资源|启动时加 `--background` 参数|保障前台交互流畅，提升整机并发量|
|超时自动回收|单步骤与全局超时机制，超时后强制终止所有子进程、释放模型与连接资源|`step_timeout` / 根级 `timeout` 配置|避免僵尸任务长期占用资源|

### 4\.6 完整可运行示例

```YAML
name: daily-ai-report
description: 每日自动搜集AI热点、生成摘要、人工审核后发布
version: "1.0.0"
timeout: 3600
default_resource_spec: standard
incremental: true

steps:
  - id: search-news
    name: 搜索AI热点
    tool: tavily_search
    params:
      query: "AI大模型 最新动态 2026"
      max_results: 10
    retry: 2
    on_success: extract-summaries
    on_failure: alert-error

  - id: extract-summaries
    name: 抓取文章摘要
    tool: tavily_extract
    params:
      urls: "${search-news.result.urls}"
      query: "技术要点、创新点、发布信息"
    resource_spec: lite
    on_success: format-article
    on_failure: alert-error

  - id: format-article
    name: 格式化日报
    tool: template_render
    params:
      template: "daily-news-template.md"
      data: "${extract-summaries.result}"
      output_path: "articles/draft-$(date +%Y%m%d).md"
    resource_spec: lite
    on_success: notify-review
    on_failure: alert-error

  - id: notify-review
    name: 通知审核
    tool: message.send
    params:
      channel: "telegram"
      message: "📋 今日AI资讯已生成，请审核后发布。"
    approval: required
    idle_sleep: 300
    on_success: publish
    on_failure: cancel

  - id: publish
    name: 发布文章
    tool: csdn-publish
    params:
      file_path: "${format-article.output_path}"
    on_success: complete

  - id: alert-error
    name: 异常告警
    tool: message.send
    params:
      channel: "telegram"
      message: "⚠️ 日报生成失败，请检查日志。"
```

---

## 五、能力对比与选型指南

|维度|基础 Workflow|进阶 TaskFlow|
|---|---|---|
|核心定位|轻量线性流水线|持久化状态编排引擎|
|状态持久化|无，执行完即销毁|有，全步骤状态落盘，支持断点续跑|
|编排模型|顺序执行 \+ 显式并行组|状态机跳转 \+ DAG 依赖调度|
|循环能力|仅失败重试，无原生条件循环|支持跳转实现 while 循环、fan\_out 批量遍历|
|人工审批|不支持|原生支持审批节点与空闲休眠|
|后台运行|前台阻塞执行|支持后台静默执行与资源降权|
|节能核心|按需加载、结果缓存、并发限流|断点续跑、算力分级、休眠唤醒、批量合并|
|学习成本|低，5 分钟上手|中，适合复杂业务场景|
|典型场景|定时任务、简单工具链、一次性流水线|长周期业务、多分支流程、需人工介入的审批流|

**选型原则**：

- 简单多步骤、短周期、一次性任务 → 优先使用基础 Workflow

- 需人工审批、断点续跑、循环迭代、长周期后台运行 → 使用 TaskFlow

---

## 六、最佳实践

### 6\.1 可靠性

1. 外部 API、网络调用类步骤必须配置重试策略，网络场景推荐指数退避。

2. 核心业务流程必须配置失败告警，及时通知负责人。

3. 非关键辅助步骤设置 `continue_on_failure: true`，避免阻塞主流程。

4. 全局与单步骤均设置合理超时，防止流程异常挂死占用资源。

### 6\.2 性能与节能

1. 并行任务添加 `max_concurrent` 限流，避免算力尖峰。

2. 简单格式化、分类任务使用 `lite` 算力规格，避免大材小用。

3. 高频定时任务开启结果缓存，减少重复计算。

4. 长等待场景使用审批节点 \+ 空闲休眠，释放运行时资源。

### 6\.3 可维护性

1. 每个工作流必须填写 `description`，说明用途、输入、输出。

2. 复杂业务逻辑添加行内注释，便于后续迭代维护。

3. 同类工作流按业务目录分类存放，如 `workflows/ops/`、`taskflows/report/`。

4. 输出文件命名携带时间戳，避免历史文件被覆盖。

---

## 七、常见问题排查

1. **变量引用不生效**

    - Workflow 检查变量名是否与 `output` 字段一致，跨并行组需使用 `{{ steps.步骤名.output.字段 }}` 完整路径。

    - TaskFlow 检查引用格式是否为 `${步骤id.result.字段名}`，步骤 ID 是否正确。

2. **并行任务执行顺序异常**

    - 并行组内步骤无执行顺序保证，存在依赖关系的步骤需移出并行组或通过 `dependsOn` 声明依赖。

3. **资源占用过高**

    - 为并行组添加 `max_concurrent` 限流，为简单步骤配置 `resource_spec: lite`。

    - 开启结果缓存，减少重复执行；长等待场景使用审批休眠。

4. **工作流执行超时**

    - 拆分长步骤为多个子步骤，配置单步骤超时。

    - 长等待场景切换为 TaskFlow，使用审批节点 \+ 空闲休眠机制。

5. **YAML 语法报错**

    - 检查缩进是否为 2 空格，禁止 Tab 符。

    - 检查冒号后是否有空格，列表项是否对齐。

    - 特殊字符、多行文本使用块标量语法包裹。

---

## 附录：常用字段速查表

|字段|Workflow|TaskFlow|作用|
|---|---|---|---|
|`name`|✅ 根级\+步骤级|✅ 步骤级（可选）|标识名称|
|`steps`|✅|✅|步骤数组|
|`action`|✅|❌|步骤动作类型|
|`tool`|❌|✅|调用工具名称|
|`parallel`|✅|❌（用dependsOn）|显式并行组|
|`dependsOn`|❌|✅|DAG依赖声明|
|`on_success`|❌|✅|成功跳转目标|
|`on_failure`|✅ 步骤级|✅ 步骤级|失败处理/跳转|
|`retry`|✅|✅|失败重试|
|`approval`|❌|✅|人工审批|
|`fan_out`|❌|✅|批量展开遍历|
|`cache`|✅|✅|结果缓存|
|`resource_spec`|❌|✅|算力规格分级|
|`timeout`|✅ 全局|✅ 全局\+单步骤|超时控制|

```Plaintext

你可以全选复制以上内容，在本地新建文件命名为 `OpenClaw工作流YAML规范手册.md`，保存后即可用任意 Markdown 编辑器或浏览器打开查看。
```

> （注：部分内容可能由 AI 生成）
