# 日志压缩包与问数表一键处理

入口：`process_session_batch.py`。需要 Python 3.10+ 和 `openpyxl`：

可单独复制入口脚本和 `analyze_65_kq_v3.py` 到其他电脑，无需 `split_step_durations.py`。
单独复制时请使用 `--analyzer` 指定分析脚本。`--questions` 和 `--output-dir` 为必填参数。

```bash
python -m pip install openpyxl
```

在仓库根目录运行（将输入路径换成实际文件）：

```bash
python e2e_delay/process_session_batch.py \
  --archive '/path/to/日志.zip' \
  --questions '/path/to/问数150.xlsx' \
  --output-dir '/path/to/本批次处理结果'
```

CSV 同样支持：将 `--questions` 指向 `查数150.csv`。题数不限定150。

Windows PowerShell 示例（问数文件名请换成实际名称，结果目录须尚不存在）：

```powershell
python .\process_session_batch.py --archive ".\logs0920_76_老recipe_新模型.zip" --analyzer ".\analyze_65_kq_v3.py" --scenario wireless --questions ".\问数150.xlsx" --output-dir ".\处理结果"
```

Excel首行为表头，默认第一张工作表，可加 `--sheet 'Sheet1'`。
默认自动识别 `额外答案-sessionId`、`sessionId`、`session_id`、`Session ID`、`SessionID`、`会话ID`。
若有多个候选列或不同列名，用 `--session-column '实际列名'` 指定。
可选题目信息列为 `编号`、`QA_ID`、`问题`、`单步/多步`，不存在则留空。
Excel输入应保存好公式的计算结果；旧版 `.xls` 请先另存为 `.xlsx`。

默认调用本仓库 `e2e_delay/1/analyze_65_kq_v3.py`，通过子进程执行：

```text
当前Python解释器 analyze脚本 all_operational_logs目录 wireless
```

指定其他兼容分析脚本或场景：

```bash
python e2e_delay/process_session_batch.py \
  --archive '/path/to/日志.tar.gz' \
  --questions '/path/to/问数150.xlsx' \
  --output-dir '/path/to/新输出目录' \
  --analyzer '/path/to/analyze_65_kq_v3.py' \
  --scenario wireless
```

`--scenario` 支持 `wireless`、`cloud`。分析脚本须接受上述位置参数，在日志目录的父目录生成
`all_operational_logs_knowledge-qa性能分析_无线.xlsx`（或`云核.xlsx`），其中包含`会话明细`工作表、`会话ID`与`步骤详情(每步操作)`列。
只输出JSON的历史临时版本不适用。入口脚本不更改分析算法；默认分析脚本的难度评测集路径仍沿用原脚本配置，缺少评测集时难度分级可能不可用，详见分析运行日志。

可同时传入 `--t-start '2026-09-20 00:00:00' --t-end '2026-09-21 00:00:00'`，时间为UTC，直接传给分析脚本。

处理流程：

1. 解开 ZIP/TAR，包括嵌套压缩包。原始压缩包不修改。
2. 收集名称以 `nextagent-operational` 开头的普通日志及 `.gz` 轮转日志，按整行内容跨文件去重，生成统一 `.jsonl` 目录。
3. 调用 `analyze` 生成全量分析报告，标准输出和错误保存到`解析运行记录.log`。
4. 根据问数表Session ID去除首尾空白后精确匹配，保留源记录顺序及重复Session。
5. 拆分步骤耗时，保留单步/多步标记，生成结果并重新读取核验导出内容。

输出目录必须尚不存在；重跑时指定新的目录，失败产生的中间文件保留用于定位问题。
默认解压累计上限10 GiB（包括嵌套层和规范化日志），可用 `--max-expanded-gb 20` 调整。
不解压符号链接、越界路径或覆盖同名文件。

主要产物：

- `最终SessionID筛选结果_N行_步骤耗时拆分_单步多步标记.xlsx`：最终筛选结果、匹配说明、未匹配SessionID。
- `all_operational_logs_knowledge-qa性能分析_无线.xlsx`：分析脚本全量报告。
- `匹配汇总.json`、`解压文件清单.json`、`解析运行记录.log`：统计和来源记录。
- `原始日志/`、`all_operational_logs/`：解压副本和去重后的分析输入。

空Session及未匹配记录的日志指标留空，不按题目文本补配。
“原始日志存在，未纳入分析报告”仅在原始JSON顶层含对应sessionId时标记，不代表已确定排除原因。
共享Session的多条题目引用相同会话指标；按会话汇总须先去重。
调用Skill/Workflow拆分列是发起调用的Model耗时；nego/exec为对应阶段耗时，单位秒。
默认结果行高适于浏览；长步骤文本完整保留，可在Excel内自动调整行高查看。

运行自动测试：

```bash
python -m unittest discover -s e2e_delay -p test_process_session_batch.py
```
