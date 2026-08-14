import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const runId = "019ffa1d-1429-7a22-873b-6bcd9dea9c5a";
const dataset = process.argv[2] ?? "data2";
const datasets = {
  data1: {
    label: "data1",
    outputName: "AICO_Agent调用时延报告.xlsx",
    directory: "deepseek0731",
    aico: "deepseek0731/dsv4_212_1_aico.jsonl",
    recipeDs: "deepseek0731/dsv4_212_1_recipe_ds.jsonl",
    qwen: "deepseek0731/qwen_1.jsonl",
  },
  data2: {
    label: "data2",
    outputName: "AICO_Agent调用时延报告_data2.xlsx",
    directory: "deepseek_old",
    aico: "deepseek_old/dsv4_2_aico.jsonl",
    recipeDs: "deepseek_old/dsv4_2_recipe_ds.jsonl",
    qwen: "deepseek_old/qwen3_2.jsonl",
  },
  data3: {
    label: "dsv_modify_0814",
    outputName: "AICO_Agent调用时延报告_dsv_modify_0814.xlsx",
    directory: "dsv_modify_0814",
    aico: "dsv_modify_0814/dsv4_3_aico.jsonl",
    recipeDs: "dsv_modify_0814/dsv4_3_recipe_ds.jsonl",
    qwen: "dsv_modify_0814/qwen_3.jsonl",
  },
};
const datasetConfig = datasets[dataset];
if (!datasetConfig) throw new Error(`未知数据集：${dataset}`);
const outputDir = path.join(projectDir, datasetConfig.directory);
const inputWorkbookPath = path.join(projectDir, "deepseek0731", "福州深圳数据_60道工参题目.xlsx");
const outputWorkbookPath = path.join(outputDir, datasetConfig.outputName);

const logFiles = {
  aico: path.join(projectDir, datasetConfig.aico),
  recipeDs: path.join(projectDir, datasetConfig.recipeDs),
  qwen: path.join(projectDir, datasetConfig.qwen),
};

const recommendationMarker = "你是对话后续问题推荐助手。你的唯一任务是根据用户消息提";

const STAGE = {
  AICO_SKILL: "AICO Tool Call - Skill",
  AICO_WORKFLOW: "AICO Tool Call - Workflow",
  RECIPE_DS: "Recipe - DeepSeek",
  RECIPE_QWEN_EXEC: "Recipe - Qwen执行",
  RECIPE_QWEN_SUMMARY: "Recipe - Qwen总结",
  AICO_SUMMARY: "AICO总结",
  RECOMMENDATION: "问题推荐",
  AICO_OTHER: "AICO其他工具",
  AICO_FAILED: "AICO错误/失败",
  UNMATCHED: "未匹配/探活调用",
};

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s`*_#>]/g, "")
    .replace(/[。！？!?，,；;：:]/g, "")
    .toLowerCase();
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => ({ ...JSON.parse(line), __line: index + 1 }));
}

function parseArguments(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function extractRequestToolCalls(record, toolName) {
  const calls = [];
  for (const message of record.request_body?.messages ?? []) {
    for (const toolCall of message?.tool_calls ?? []) {
      if (!toolName || toolCall?.function?.name === toolName) calls.push(toolCall);
    }
  }
  return calls;
}

function extractProcessedQuery(records) {
  const candidates = [];
  for (const record of records) {
    for (const call of extractRequestToolCalls(record, "Workflow")) {
      const args = parseArguments(call.function?.arguments);
      candidates.push(args.inputText, args.args?.query, args.query);
    }
  }
  for (const record of records) {
    for (const call of extractRequestToolCalls(record, "Skill")) {
      const args = parseArguments(call.function?.arguments);
      candidates.push(args.args?.query, args.query, args.inputText);
    }
  }
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

function responseToolNames(record) {
  const response = typeof record.response_body === "string"
    ? record.response_body
    : JSON.stringify(record.response_body ?? "");
  return [...response.matchAll(/"name":"([^"]+)"/g)].map((match) => match[1]);
}

function classifyAico(record) {
  if (Number(record.status_code) !== 200) {
    return { stage: STAGE.AICO_FAILED, detail: `HTTP ${record.status_code ?? "未知"}` };
  }
  const names = responseToolNames(record);
  if (names.includes("Skill")) return { stage: STAGE.AICO_SKILL, detail: "Skill" };
  if (names.includes("Workflow")) return { stage: STAGE.AICO_WORKFLOW, detail: "Workflow" };
  if (names.length) {
    const counts = new Map();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    const detail = [...counts.entries()]
      .map(([name, count]) => count > 1 ? `${name}×${count}` : name)
      .join(" + ");
    return { stage: STAGE.AICO_OTHER, detail };
  }
  return { stage: STAGE.AICO_SUMMARY, detail: "无tool_calls" };
}

function matchCandidate(text, questions, field) {
  const direct = [...questions]
    .filter((q) => q[field])
    .sort((a, b) => b[field].length - a[field].length)
    .find((q) => text.includes(q[field]));
  if (direct) return { question: direct, method: `${field}精确文本` };

  const normalizedText = normalizeText(text);
  const normalized = [...questions]
    .filter((q) => q[field])
    .map((q) => ({ q, value: normalizeText(q[field]) }))
    .filter((item) => item.value.length >= 6)
    .sort((a, b) => b.value.length - a.value.length)
    .find((item) => normalizedText.includes(item.value));
  return normalized ? { question: normalized.q, method: `${field}标准化文本` } : null;
}

function closestWorkflowQuestion(record, questions) {
  const timestamp = Date.parse(record.received_at);
  const eligible = questions
    .filter((q) => Number.isFinite(q.workflowTimestamp) && q.workflowTimestamp <= timestamp)
    .sort((a, b) => b.workflowTimestamp - a.workflowTimestamp);
  return eligible[0] ? { question: eligible[0], method: "时间顺序回退" } : null;
}

function cellStatus(question) {
  const required = [
    STAGE.AICO_SKILL,
    STAGE.AICO_WORKFLOW,
    STAGE.RECIPE_DS,
    STAGE.RECIPE_QWEN_SUMMARY,
    STAGE.AICO_SUMMARY,
    STAGE.RECOMMENDATION,
  ];
  const missing = required.filter((stage) => !(question.calls.get(stage)?.length));
  return missing.length ? `缺少：${missing.join("、")}` : "完整";
}

function excelColumn(index) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

await fs.mkdir(outputDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputWorkbookPath));
const sourceSheet = workbook.worksheets.getItemAt(0);

const sourceStyle = await workbook.inspect({
  kind: "computedStyle",
  sheetId: sourceSheet.name,
  range: "A1:E5",
  maxChars: 5000,
});
console.log(sourceStyle.ndjson);

const sourcePreview = await workbook.render({
  sheetName: sourceSheet.name,
  range: "A1:E10",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  path.join(outputDir, `${datasetConfig.label}_source_workbook.png`),
  new Uint8Array(await sourcePreview.arrayBuffer()),
);

const questionValues = sourceSheet.getRange("C2:C61").values;
const questions = questionValues.map((row, index) => ({
  id: index + 1,
  excelRow: index + 2,
  original: String(row[0] ?? "").trim(),
  processed: "",
  workflowTimestamp: Number.NaN,
  calls: new Map(),
}));

const [aicoRecords, recipeDsRecords, qwenRecords] = await Promise.all([
  readJsonl(logFiles.aico),
  readJsonl(logFiles.recipeDs),
  readJsonl(logFiles.qwen),
]);

const unmatched = [];
const detailRows = [];

function addCall(question, record, stage, detail, sourceFile, matchMethod) {
  const call = {
    questionId: question?.id ?? null,
    original: question?.original ?? "",
    processed: question?.processed ?? "",
    stage,
    detail,
    timestamp: record.received_at ?? "",
    durationMs: Number(record.total_duration_ms),
    sourceFile,
    proxyRequestId: record.proxy_request_id ?? "",
    sourceLine: record.__line,
    matchMethod,
  };
  detailRows.push(call);
  if (question) {
    if (!question.calls.has(stage)) question.calls.set(stage, []);
    question.calls.get(stage).push(call);
  } else {
    unmatched.push(call);
  }
}

const aicoGroups = new Map(questions.map((q) => [q.id, []]));
for (const record of aicoRecords) {
  const requestText = JSON.stringify(record.request_body ?? {});
  const match = matchCandidate(requestText, questions, "original");
  if (match) aicoGroups.get(match.question.id).push({ record, method: match.method });
  else addCall(null, record, STAGE.UNMATCHED, "AICO未匹配调用", datasetConfig.aico, "未匹配");
}

for (const question of questions) {
  const group = aicoGroups.get(question.id);
  question.processed = extractProcessedQuery(group.map((item) => item.record));
  const workflowRecord = group.find((item) => classifyAico(item.record).stage === STAGE.AICO_WORKFLOW)?.record;
  question.workflowTimestamp = workflowRecord ? Date.parse(workflowRecord.received_at) : Number.NaN;
}

for (const question of questions) {
  for (const item of aicoGroups.get(question.id)) {
    const classification = classifyAico(item.record);
    addCall(question, item.record, classification.stage, classification.detail, datasetConfig.aico, item.method);
  }
}

for (const record of recipeDsRecords) {
  const requestText = JSON.stringify(record.request_body ?? {});
  const isRecommendation = requestText.includes(recommendationMarker);
  let match = isRecommendation
    ? matchCandidate(requestText, questions, "original")
    : matchCandidate(requestText, questions, "processed");
  if (!match) match = closestWorkflowQuestion(record, questions);
  const stage = match
    ? (isRecommendation ? STAGE.RECOMMENDATION : STAGE.RECIPE_DS)
    : STAGE.UNMATCHED;
  const detail = match
    ? (isRecommendation ? "后续问题推荐" : "DeepSeek recipe调用")
    : "DeepSeek未匹配/探活调用";
  addCall(
    match?.question,
    record,
    stage,
    detail,
    datasetConfig.recipeDs,
    match?.method ?? "未匹配",
  );
}

const qwenByQuestion = new Map(questions.map((q) => [q.id, []]));
for (const record of qwenRecords) {
  const requestText = JSON.stringify(record.request_body ?? {});
  let match = matchCandidate(requestText, questions, "processed");
  if (!match) match = closestWorkflowQuestion(record, questions);
  if (match) qwenByQuestion.get(match.question.id).push({ record, method: match.method });
  else addCall(null, record, STAGE.UNMATCHED, "Qwen未匹配/探活调用", datasetConfig.qwen, "未匹配");
}

for (const question of questions) {
  const records = qwenByQuestion.get(question.id).sort((a, b) => Date.parse(a.record.received_at) - Date.parse(b.record.received_at));
  records.forEach((item, index) => {
    const isLast = index === records.length - 1;
    addCall(
      question,
      item.record,
      isLast ? STAGE.RECIPE_QWEN_SUMMARY : STAGE.RECIPE_QWEN_EXEC,
      isLast ? "同一问题最后一次Qwen调用" : `同一问题第${index + 1}次Qwen调用`,
      datasetConfig.qwen,
      item.method,
    );
  });
}

detailRows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
const occurrenceByQuestionStage = new Map();
for (const row of detailRows) {
  const key = `${row.questionId ?? "UNMATCHED"}|${row.stage}`;
  const occurrence = (occurrenceByQuestionStage.get(key) ?? 0) + 1;
  occurrenceByQuestionStage.set(key, occurrence);
  row.occurrence = occurrence;
  if (row.questionId) {
    const question = questions[row.questionId - 1];
    row.processed = question.processed;
  }
}

const stageDefinitions = [
  { stage: STAGE.AICO_SKILL, label: "AICO Skill" },
  { stage: STAGE.AICO_WORKFLOW, label: "AICO Workflow" },
  { stage: STAGE.RECIPE_DS, label: "Recipe DeepSeek" },
  { stage: STAGE.RECIPE_QWEN_EXEC, label: "Recipe Qwen执行" },
  { stage: STAGE.RECIPE_QWEN_SUMMARY, label: "Recipe Qwen总结" },
  { stage: STAGE.AICO_SUMMARY, label: "AICO总结" },
  { stage: STAGE.RECOMMENDATION, label: "问题推荐" },
  { stage: STAGE.AICO_OTHER, label: "AICO其他工具" },
  { stage: STAGE.AICO_FAILED, label: "AICO错误/失败" },
];

const stageWidths = stageDefinitions.map((definition) => {
  const maxCalls = Math.max(
    1,
    ...questions.map((question) => question.calls.get(definition.stage)?.length ?? 0),
  );
  return { ...definition, maxCalls };
});

const addedHeaders = ["问题编号", "转换后问题（Workflow inputText/query）"];
for (const definition of stageWidths) {
  for (let occurrence = 1; occurrence <= definition.maxCalls; occurrence += 1) {
    addedHeaders.push(`${definition.label} 第${occurrence}次(ms)`);
  }
}
addedHeaders.push("模型调用总时延(ms)", "模型调用次数", "流程完整性");

const addedValues = questions.map((question) => {
  const row = [question.id, question.processed || "未提取"];
  for (const definition of stageWidths) {
    const calls = [...(question.calls.get(definition.stage) ?? [])]
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    for (let occurrence = 0; occurrence < definition.maxCalls; occurrence += 1) {
      row.push(calls[occurrence]?.durationMs ?? null);
    }
  }
  row.push(null, null, cellStatus(question));
  return row;
});

const addedStartColIndex = 5;
const totalDurationColIndex = addedStartColIndex + addedHeaders.length - 3;
const callCountColIndex = addedStartColIndex + addedHeaders.length - 2;
const statusColIndex = addedStartColIndex + addedHeaders.length - 1;
const addedEndColIndex = statusColIndex;
const addedStartCol = excelColumn(addedStartColIndex);
const addedEndCol = excelColumn(addedEndColIndex);
const totalDurationCol = excelColumn(totalDurationColIndex);
const callCountCol = excelColumn(callCountColIndex);
const statusCol = excelColumn(statusColIndex);

// Create referenced worksheets before writing any cross-sheet formulas.
const detailSheet = workbook.worksheets.add("调用明细");

sourceSheet.getRange(`${addedStartCol}1:${addedEndCol}1`).values = [addedHeaders];
sourceSheet.getRange(`${addedStartCol}2:${addedEndCol}61`).values = addedValues;

const detailEndRow = detailRows.length + 1;
for (let row = 2; row <= 61; row += 1) {
  sourceSheet.getRange(`${totalDurationCol}${row}`).formulas = [[`=SUMIF('调用明细'!$A$2:$A$${detailEndRow},F${row},'调用明细'!$H$2:$H$${detailEndRow})`]];
  sourceSheet.getRange(`${callCountCol}${row}`).formulas = [[`=COUNTIF('调用明细'!$A$2:$A$${detailEndRow},F${row})`]];
}

sourceSheet.freezePanes.freezeRows(1);
sourceSheet.freezePanes.freezeColumns(3);
sourceSheet.showGridLines = false;
sourceSheet.getRange(`A1:${addedEndCol}1`).format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  verticalAlignment: "center",
  horizontalAlignment: "center",
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: "#17365D" },
};
sourceSheet.getRange("A1:R1").format.rowHeight = 42;
sourceSheet.getRange(`A2:${addedEndCol}61`).format.verticalAlignment = "top";
sourceSheet.getRange(`A2:${addedEndCol}61`).format.borders = {
  bottom: { style: "thin", color: "#D9E2F3" },
};
sourceSheet.getRange(`A2:${addedEndCol}61`).format.rowHeight = 42;
sourceSheet.getRange("A2:C61").format.wrapText = true;
sourceSheet.getRange("D2:E61").format.wrapText = false;
sourceSheet.getRange(`${addedStartCol}2:${addedEndCol}61`).format.wrapText = true;
sourceSheet.getRange(`${excelColumn(addedStartColIndex + 2)}2:${callCountCol}61`).format.numberFormat = "#,##0.0";
sourceSheet.getRange("F2:F61").format.numberFormat = "0";
sourceSheet.getRange("A:A").format.columnWidth = 10;
sourceSheet.getRange("B:B").format.columnWidth = 20;
sourceSheet.getRange("C:C").format.columnWidth = 48;
sourceSheet.getRange("D:E").format.columnWidth = 24;
sourceSheet.getRange("F:F").format.columnWidth = 10;
sourceSheet.getRange("G:G").format.columnWidth = 46;
sourceSheet.getRange(`${excelColumn(addedStartColIndex + 2)}:${excelColumn(totalDurationColIndex - 1)}`).format.columnWidth = 18;
sourceSheet.getRange(`${totalDurationCol}:${callCountCol}`).format.columnWidth = 16;
sourceSheet.getRange(`${statusCol}:${statusCol}`).format.columnWidth = 34;

const incompleteRange = sourceSheet.getRange(`${statusCol}2:${statusCol}61`);
incompleteRange.conditionalFormats.add("containsText", {
  text: "缺少",
  format: { fill: "#FCE4D6", font: { color: "#9C0006", bold: true } },
});
incompleteRange.conditionalFormats.add("containsText", {
  text: "完整",
  format: { fill: "#E2F0D9", font: { color: "#375623" } },
});

detailSheet.showGridLines = false;
detailSheet.freezePanes.freezeRows(1);
detailSheet.getRange("A1:L1").values = [[
  "问题编号",
  "原问题",
  "转换后问题",
  "阶段",
  "调用说明/工具名",
  "阶段内序号",
  "接收时间",
  "total_duration_ms",
  "时延(s)",
  "来源文件",
  "源文件行号",
  "匹配方式",
]];
detailSheet.getRange(`A2:L${detailEndRow}`).values = detailRows.map((row) => [
  row.questionId ?? "UNMATCHED",
  row.original,
  row.processed,
  row.stage,
  row.detail,
  row.occurrence,
  row.timestamp,
  row.durationMs,
  null,
  row.sourceFile,
  row.sourceLine,
  row.matchMethod,
]);
for (let row = 2; row <= detailEndRow; row += 1) {
  detailSheet.getRange(`I${row}`).formulas = [[`=H${row}/1000`]];
}
detailSheet.getRange("A1:L1").format = {
  fill: "#5B9BD5",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
detailSheet.getRange("A1:L1").format.rowHeight = 34;
detailSheet.getRange(`A2:L${detailEndRow}`).format.verticalAlignment = "top";
detailSheet.getRange(`A2:L${detailEndRow}`).format.borders = {
  bottom: { style: "thin", color: "#D9E2F3" },
};
detailSheet.getRange(`B2:E${detailEndRow}`).format.wrapText = true;
detailSheet.getRange(`H2:I${detailEndRow}`).format.numberFormat = "#,##0.0";
detailSheet.getRange(`A2:A${detailEndRow}`).format.numberFormat = "0";
const detailWidths = [10, 46, 46, 28, 28, 12, 24, 20, 14, 30, 12, 20];
detailWidths.forEach((width, index) => {
  detailSheet.getRange(`${excelColumn(index)}:${excelColumn(index)}`).format.columnWidth = width;
});

const summarySheet = workbook.worksheets.add("汇总");
summarySheet.showGridLines = false;
summarySheet.getRange("A1:F1").merge();
summarySheet.getRange("A1").values = [[`AICO Agent 模型调用时延汇总（${datasetConfig.label}）`]];
summarySheet.getRange("A1:F1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "left",
  verticalAlignment: "center",
};
summarySheet.getRange("A1:F1").format.rowHeight = 34;
summarySheet.getRange("A3:F3").values = [[
  "阶段",
  "调用次数",
  "总时延(ms)",
  "平均单次时延(ms)",
  "平均单次时延(s)",
  "平均每题累计时延(ms)",
]];
const summaryStages = [
  STAGE.AICO_SKILL,
  STAGE.AICO_WORKFLOW,
  STAGE.RECIPE_DS,
  STAGE.RECIPE_QWEN_EXEC,
  STAGE.RECIPE_QWEN_SUMMARY,
  STAGE.AICO_SUMMARY,
  STAGE.RECOMMENDATION,
  STAGE.AICO_OTHER,
  STAGE.AICO_FAILED,
  STAGE.UNMATCHED,
  "Recipe合计",
  "全部模型调用",
];
const summaryStartRow = 4;
const summaryEndRow = summaryStartRow + summaryStages.length - 1;
summarySheet.getRange(`A${summaryStartRow}:A${summaryEndRow}`).values = summaryStages.map((stage) => [stage]);
for (let row = summaryStartRow; row <= summaryStartRow + 9; row += 1) {
  summarySheet.getRange(`B${row}`).formulas = [[`=COUNTIF('调用明细'!$D$2:$D$${detailEndRow},A${row})`]];
  summarySheet.getRange(`C${row}`).formulas = [[`=SUMIF('调用明细'!$D$2:$D$${detailEndRow},A${row},'调用明细'!$H$2:$H$${detailEndRow})`]];
  summarySheet.getRange(`D${row}`).formulas = [[`=IFERROR(C${row}/B${row},0)`]];
  summarySheet.getRange(`E${row}`).formulas = [[`=D${row}/1000`]];
  summarySheet.getRange(`F${row}`).formulas = [[`=C${row}/60`]];
}
const recipeTotalRow = summaryEndRow - 1;
const allCallsRow = summaryEndRow;
summarySheet.getRange(`B${recipeTotalRow}`).formulas = [["=SUM(B6:B8)"]];
summarySheet.getRange(`C${recipeTotalRow}`).formulas = [["=SUM(C6:C8)"]];
summarySheet.getRange(`D${recipeTotalRow}`).formulas = [[`=IFERROR(C${recipeTotalRow}/B${recipeTotalRow},0)`]];
summarySheet.getRange(`E${recipeTotalRow}`).formulas = [[`=D${recipeTotalRow}/1000`]];
summarySheet.getRange(`F${recipeTotalRow}`).formulas = [[`=C${recipeTotalRow}/60`]];
summarySheet.getRange(`B${allCallsRow}`).formulas = [[`=COUNT('调用明细'!$H$2:$H$${detailEndRow})`]];
summarySheet.getRange(`C${allCallsRow}`).formulas = [[`=SUM('调用明细'!$H$2:$H$${detailEndRow})`]];
summarySheet.getRange(`D${allCallsRow}`).formulas = [[`=IFERROR(C${allCallsRow}/B${allCallsRow},0)`]];
summarySheet.getRange(`E${allCallsRow}`).formulas = [[`=D${allCallsRow}/1000`]];
summarySheet.getRange(`F${allCallsRow}`).formulas = [[`=C${allCallsRow}/60`]];

const qualityHeaderRow = summaryEndRow + 2;
const qualityStartRow = qualityHeaderRow + 1;
const qualityEndRow = qualityStartRow + 7;
summarySheet.getRange(`A${qualityHeaderRow}:C${qualityHeaderRow}`).values = [["数据质量检查", "数量", "说明"]];
summarySheet.getRange(`A${qualityStartRow}:C${qualityEndRow}`).values = [
  ["Excel问题数", 60, "原表C列问题"],
  ["已提取转换问题", questions.filter((q) => q.processed).length, "来自AICO Workflow/Skill参数"],
  ["AICO日志行数", aicoRecords.length, datasetConfig.aico],
  ["Recipe DS日志行数", recipeDsRecords.length, "含DeepSeek与问题推荐"],
  ["Qwen日志行数", qwenRecords.length, "最后一次标记为Qwen总结"],
  ["未匹配/探活调用数", unmatched.length, "未计入60题标准阶段，详见调用明细"],
  ["流程完整问题数", questions.filter((q) => cellStatus(q) === "完整").length, "具备6个标准阶段"],
  ["发现的其他AICO工具", new Set(detailRows.filter((r) => r.stage === STAGE.AICO_OTHER).flatMap((r) => r.detail.split(/\s*\+\s*/).map((v) => v.replace(/×\d+$/, "")))).size, "详见调用明细"],
];

summarySheet.getRange("A3:F3").format = {
  fill: "#5B9BD5",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  wrapText: true,
};
summarySheet.getRange(`A${qualityHeaderRow}:C${qualityHeaderRow}`).format = {
  fill: "#70AD47",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
summarySheet.getRange(`A${summaryStartRow}:F${summaryEndRow}`).format.borders = {
  bottom: { style: "thin", color: "#D9E2F3" },
};
summarySheet.getRange(`A${qualityStartRow}:C${qualityEndRow}`).format.borders = {
  bottom: { style: "thin", color: "#E2F0D9" },
};
summarySheet.getRange(`B${summaryStartRow}:F${summaryEndRow}`).format.numberFormat = "#,##0.0";
summarySheet.getRange(`B${qualityStartRow}:B${qualityEndRow}`).format.numberFormat = "#,##0";
summarySheet.getRange("A:A").format.columnWidth = 30;
summarySheet.getRange("B:B").format.columnWidth = 14;
summarySheet.getRange("C:C").format.columnWidth = 34;
summarySheet.getRange("D:F").format.columnWidth = 22;
summarySheet.getRange(`C${qualityStartRow}:C${qualityEndRow}`).format.wrapText = true;
summarySheet.getRange(`A${qualityStartRow}:C${qualityEndRow}`).format.autofitRows();
summarySheet.freezePanes.freezeRows(3);

const inspection = await workbook.inspect({
  kind: "table",
  range: `汇总!A1:F${qualityEndRow}`,
  include: "values,formulas",
  tableMaxRows: 30,
  tableMaxCols: 8,
  maxChars: 12000,
});
console.log(inspection.ndjson);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errorScan.ndjson);

const previews = [
  { sheetName: sourceSheet.name, range: `A1:${addedEndCol}10`, file: `${datasetConfig.label}_report_questions_preview.png`, scale: 1 },
  { sheetName: "调用明细", range: "A1:L16", file: `${datasetConfig.label}_report_details_preview.png`, scale: 1 },
  { sheetName: "汇总", range: `A1:F${qualityEndRow}`, file: `${datasetConfig.label}_report_summary_preview.png`, scale: 1.5 },
];
for (const previewConfig of previews) {
  const preview = await workbook.render({
    sheetName: previewConfig.sheetName,
    range: previewConfig.range,
    scale: previewConfig.scale,
    format: "png",
  });
  await fs.writeFile(path.join(outputDir, previewConfig.file), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputWorkbookPath);

const exportedWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputWorkbookPath));
const exportedCheck = await exportedWorkbook.inspect({
  kind: "table",
  range: `Sheet1!F1:${addedEndCol}5`,
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 14,
  maxChars: 10000,
});
console.log(exportedCheck.ndjson);
const exportedNumericRange = exportedWorkbook.worksheets.getItem("Sheet1")
  .getRange(`${excelColumn(addedStartColIndex + 2)}2:${totalDurationCol}61`).values;
const nonNumericLatencyCells = [];
for (let rowIndex = 0; rowIndex < exportedNumericRange.length; rowIndex += 1) {
  for (let colIndex = 0; colIndex < exportedNumericRange[rowIndex].length; colIndex += 1) {
    const value = exportedNumericRange[rowIndex][colIndex];
    if (value !== null && value !== "" && typeof value !== "number") {
      nonNumericLatencyCells.push({
        cell: `${excelColumn(addedStartColIndex + 2 + colIndex)}${rowIndex + 2}`,
        value,
        type: typeof value,
      });
    }
  }
}
console.log(JSON.stringify({ dataset, nonNumericLatencyCells }, null, 2));
if (nonNumericLatencyCells.length) {
  throw new Error(`发现非数值时延单元格：${nonNumericLatencyCells.length}`);
}
const exportedErrorScan = await exportedWorkbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "exported workbook formula error scan",
});
console.log(exportedErrorScan.ndjson);

const otherTools = [...new Set(detailRows
  .filter((row) => row.stage === STAGE.AICO_OTHER)
  .flatMap((row) => row.detail.split(/\s*\+\s*/).map((value) => value.replace(/×\d+$/, ""))))].sort();
const diagnostics = {
  outputWorkbookPath,
  questions: questions.length,
  processedQueries: questions.filter((q) => q.processed).length,
  sourceRows: { aico: aicoRecords.length, recipeDs: recipeDsRecords.length, qwen: qwenRecords.length },
  stageCounts: Object.fromEntries([...new Set(detailRows.map((row) => row.stage))].map((stage) => [stage, detailRows.filter((row) => row.stage === stage).length])),
  completeQuestions: questions.filter((q) => cellStatus(q) === "完整").length,
  incompleteQuestions: questions.filter((q) => cellStatus(q) !== "完整").map((q) => ({ id: q.id, status: cellStatus(q), question: q.original })),
  unmatchedCount: unmatched.length,
  otherTools,
};
console.log(JSON.stringify(diagnostics, null, 2));
