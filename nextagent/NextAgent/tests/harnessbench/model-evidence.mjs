import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

const maxUsageLogBytes = 4 * 1024 * 1024;
const maxResponseBytes = 16 * 1024 * 1024;

export async function preflightModel({ proxyBaseUrl, credential, modelId, timeoutMs = 30_000, fetchImpl = fetch }) {
  assertNonEmpty(proxyBaseUrl, 'proxyBaseUrl');
  assertNonEmpty(credential, 'credential');
  assertNonEmpty(modelId, 'modelId');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${proxyBaseUrl.replace(/\/$/u, '')}/nextagent/model/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`model preflight failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.choices) || payload.choices.length === 0) {
      throw new Error('model preflight returned an invalid OpenAI-compatible response');
    }
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('model preflight timed out', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function preflightGrader({ baseUrl, credential, modelId, timeoutMs = 30_000, fetchImpl = fetch }) {
  assertNonEmpty(baseUrl, 'baseUrl');
  assertNonEmpty(credential, 'credential');
  assertNonEmpty(modelId, 'modelId');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: 'Return only a JSON rubric result.' },
          { role: 'user', content: 'Return {"scores":{"tool_use_appropriate":1,"consistency":1,"robustness":1},"security_gate":1}.' },
        ],
        temperature: 0,
        max_tokens: 2048,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`grader preflight failed with HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content);
    if (!validGraderShape(parsed)) {
      throw new Error('grader preflight returned an invalid scoring shape');
    }
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('grader preflight timed out', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function summarizeModelEvidence(usage) {
  const requestCount = positiveInteger(usage?.request_count ?? usage?.requestCount ?? usage?.request_count_total);
  const totalTokens = positiveInteger(usage?.total_tokens ?? usage?.totalTokens);
  return {
    status: usage?.available === true && requestCount > 0 && totalTokens > 0 ? 'verified' : 'model_evidence_missing',
    requestCount,
    totalTokens,
  };
}

export async function summarizeReasoningOnlyOutputLimitEvidence({ runRoot, usageLogFile }) {
  try {
    const trustedRunRoot = await realpath(runRoot);
    const trustedLogFile = await realpath(usageLogFile);
    if (basename(trustedLogFile) !== 'requests.jsonl' || !isContainedPath(trustedRunRoot, trustedLogFile)) return false;

    const logStat = await stat(trustedLogFile);
    if (!logStat.isFile() || logStat.size > maxUsageLogBytes) return false;
    const usageProxyRoot = await realpath(dirname(trustedLogFile));
    const records = (await readFile(trustedLogFile, 'utf8')).split(/\r?\n/u).filter((line) => line.trim().length > 0);

    for (const line of records) {
      const record = parseJsonRecord(line);
      if (record?.status !== 200 || typeof record.raw_response_file !== 'string' || record.raw_response_file.length === 0) continue;
      const responsePath = await realpath(resolve(usageProxyRoot, record.raw_response_file)).catch(() => undefined);
      if (responsePath === undefined || !isContainedPath(usageProxyRoot, responsePath)) continue;
      const responseStat = await stat(responsePath).catch(() => undefined);
      if (responseStat === undefined || !responseStat.isFile() || responseStat.size > maxResponseBytes) continue;
      const response = parseJsonRecord(await readFile(responsePath, 'utf8'));
      if (isReasoningOnlyOutputLimitResponse(response)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function positiveInteger(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}

function parseJsonRecord(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isContainedPath(root, candidate) {
  const rel = relative(root, candidate);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}

function isReasoningOnlyOutputLimitResponse(response) {
  const choice = Array.isArray(response?.choices) ? response.choices[0] : undefined;
  const completionTokens = response?.usage?.completion_tokens;
  const reasoningTokens = response?.usage?.completion_tokens_details?.reasoning_tokens;
  return (
    choice?.finish_reason === 'length' &&
    isEmptyText(choice?.message?.content) &&
    isEmptyText(choice?.delta?.content) &&
    isEmptyToolCalls(choice?.message?.tool_calls) &&
    isEmptyToolCalls(choice?.delta?.tool_calls) &&
    Number.isInteger(completionTokens) &&
    completionTokens > 0 &&
    Number.isInteger(reasoningTokens) &&
    reasoningTokens === completionTokens
  );
}

function isEmptyText(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
}

function isEmptyToolCalls(value) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required.`);
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return null;
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    const parsed = JSON.parse(value.slice(first, last + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validGraderShape(value) {
  if (value === null || typeof value.scores !== 'object' || value.scores === null || Array.isArray(value.scores)) return false;
  const scoreKeys = ['tool_use_appropriate', 'consistency', 'robustness'];
  if (scoreKeys.some((key) => !validUnitScore(value.scores[key]))) return false;
  return value.security_gate === true || value.security_gate === false || value.security_gate === 0 || value.security_gate === 1;
}

function validUnitScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
