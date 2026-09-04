import { brand } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  projectTimelineEventToStreamEnvelope,
  type CapabilityResultPresentationLevel,
  type CapabilityResultPresentationPolicy,
  type ProcessMessageAssociation,
} from '@nextagent/agent-channel-common';
import { describe, expect, it } from 'vitest';

describe('capability result presentation policy', () => {
  it.each([
    ['TEXT', 'Product diagnosis text.'],
    ['PIU', { piuName: 'ranDiagnosis', piuVersion: '1.0.0' }],
    ['DSL', { dsl: 'renderRanDiagnosis()' }],
  ] as const)('does not apply Capability Result levels to Workflow %s product process', (toolMessageType, content) => {
    const productEvent = event('TOOL_STRUCTURED_DELTA', {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'ANSWER',
      toolMessageType,
      content,
      accumulated: true,
    });

    const payloads = (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map((level) => projectEnvelope(productEvent, level).payload);

    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(payloads[0]).toMatchObject({
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      workflowEventType: 'NODE_COMPLETED',
      toolEventType: 'ANSWER',
      toolMessageType,
      content,
    });
    expect(payloads[0]).not.toHaveProperty('resultPresentationLevel');
  });

  it('governs the Workflow-as-Tool outer result without changing its inner product projection', () => {
    const innerProduct = event('TOOL_STRUCTURED_DELTA', {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'SUB_CONCLUSION',
      toolMessageType: 'DSL',
      content: { dsl: 'renderRanDiagnosis()' },
      accumulated: true,
    });
    const outerResult = resultEvent('Workflow', {
      recipeName: 'alarm-analysis',
      status: 'succeeded',
      answerPreviews: ['Safe workflow answer.'],
    });
    const levels = ['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const;
    const innerPayloads = levels.map((level) => projectEnvelope(innerProduct, level).payload);
    const outerPayloads = levels.map((level) => projectEnvelope(outerResult, level).payload);

    expect(innerPayloads[1]).toEqual(innerPayloads[0]);
    expect(innerPayloads[2]).toEqual(innerPayloads[0]);
    expect(innerPayloads[0]).toMatchObject({
      toolEventType: 'SUB_CONCLUSION',
      toolMessageType: 'DSL',
      content: { dsl: 'renderRanDiagnosis()' },
    });
    expect(innerPayloads[0]).not.toHaveProperty('resultPresentationLevel');
    expect(outerPayloads.map((payload) => payload.resultPresentationLevel)).toEqual(levels);
    expect(outerPayloads[0]).not.toHaveProperty('safeSummary');
    expect(outerPayloads[0]).not.toHaveProperty('safeResult');
    expect(outerPayloads[1]).toHaveProperty('safeSummary');
    expect(outerPayloads[1]).not.toHaveProperty('safeResult');
    expect(outerPayloads[2]).toHaveProperty('safeSummary');
    expect(outerPayloads[2]).toHaveProperty('safeResult');
  });

  it('does not apply Capability Result levels to the terminal turn answer', () => {
    const terminalMessageId = brand<string, 'MessageId'>('terminal-message-1');
    const terminalEvent = event('REQUEST_COMPLETED', { terminalMessageId, status: 'COMPLETED', hookResults: [] });
    const processMessageAssociation = {
      message: {
        messageId: terminalMessageId,
        sessionId: brand<string, 'SessionId'>('session-1'),
        requestId: brand<string, 'MessageId'>('request-1'),
        runId: brand<string, 'RequestRunId'>('run-1'),
        role: 'ASSISTANT' as const,
        content: 'Canonical terminal answer.',
        contentType: 'PLAIN_TEXT' as const,
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        sequence: 1,
        visible: true,
        createdAt: brand<number, 'EpochMillis'>(1),
      },
    };
    const payloads = (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map(
      (level) => projectEnvelope(terminalEvent, level, processMessageAssociation).payload,
    );

    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(payloads[0]).toMatchObject({ content: 'Canonical terminal answer.', text: 'Canonical terminal answer.' });
    expect(payloads[0]).not.toHaveProperty('resultPresentationLevel');
  });

  it('keeps removed presentation levels out of the product projector', () => {
    const projectionTypeSource = readFileSync(
      join(process.cwd(), 'packages/agent-channel-common/src/projections/capability-result-presentation.ts'),
      'utf8',
    );
    const projectorSource = readFileSync(join(process.cwd(), 'packages/agent-channel-common/src/projections/stream-envelope.ts'), 'utf8');

    expect(projectionTypeSource).not.toContain('"HIDDEN"');
    expect(projectorSource).not.toContain('kind: "HIDDEN"');
    expect(projectorSource).not.toContain('effectiveLevel === "HIDDEN"');
  });

  it.each(['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const)('applies %s without retaining fields from higher levels', (level) => {
    const outcome = projectTimelineEventToStreamEnvelope(
      resultEvent('Read', {
        file_path: '/private/network/alarm.json',
        content: 'alarm evidence',
        truncated: false,
      }),
      { capabilityResultPresentationPolicy: policy(level) },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind !== 'ENVELOPE') {
      throw new Error('Expected a visible capability result envelope.');
    }
    expect(outcome.envelope.payload).toMatchObject({
      capabilityId: 'Read',
      toolCallId: 'call-1',
      resultPresentationLevel: level,
    });
    expect(outcome.envelope.payload).not.toHaveProperty('result');
    if (level === 'STATUS_ONLY') {
      expect(outcome.envelope.payload).not.toHaveProperty('safeSummary');
      expect(outcome.envelope.payload).not.toHaveProperty('safeSummaryCode');
      expect(outcome.envelope.payload).not.toHaveProperty('safeResult');
      expect(outcome.envelope.payload.content).toBe('');
    }
    if (level === 'SUMMARY') {
      expect(outcome.envelope.payload.safeSummary).toContain('alarm.json');
      expect(outcome.envelope.payload).toMatchObject({
        safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
        safeSummaryArgs: { filePath: '…/private/network/alarm.json' },
      });
      expect(outcome.envelope.payload).not.toHaveProperty('safeResult');
      expect(outcome.envelope.payload.content).toBe('');
    }
    if (level === 'DETAIL') {
      expect(outcome.envelope.payload).toMatchObject({
        safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
        safeSummaryArgs: { filePath: '…/private/network/alarm.json' },
      });
      expect(outcome.envelope.payload.safeResult).toMatchObject({ kind: 'fileRead' });
      expect(outcome.envelope.payload.content).toContain('alarm evidence');
      expect((outcome.envelope.payload.safeResult as { filePath: string }).filePath).toBe('…/private/network/alarm.json');
    }
  });

  it('keeps RAG source and content out of SUMMARY', () => {
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [
          {
            source: '/private/knowledge/alarm.md',
            content: 'bounded retrieval evidence',
            privateScore: 'must not leak',
          },
        ],
      }),
      'SUMMARY',
    );

    expect(outcome.payload).toMatchObject({
      capabilityId: 'Rag',
      resultPresentationLevel: 'SUMMARY',
      safeSummaryCode: 'CAPABILITY_RESULT_RAG_RETRIEVAL',
      safeSummaryArgs: { totalCount: 1 },
    });
    expect(outcome.payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify(outcome.payload)).not.toContain('/private/knowledge');
    expect(JSON.stringify(outcome.payload)).not.toContain('bounded retrieval evidence');
    expect(JSON.stringify(outcome.payload)).not.toContain('privateScore');
  });

  it('keeps the RAG source and full content in DETAIL', () => {
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [
          {
            source: '/private/knowledge/alarm.md',
            content: 'bounded retrieval evidence',
            privateScore: 'must not leak',
          },
        ],
      }),
      'DETAIL',
    );

    expect(outcome.payload).toMatchObject({
      capabilityId: 'Rag',
      resultPresentationLevel: 'DETAIL',
      safeSummaryCode: 'CAPABILITY_RESULT_RAG_RETRIEVAL',
      safeSummaryArgs: { totalCount: 1 },
      safeResult: {
        kind: 'ragRetrieval',
        totalCount: 1,
        items: [{ source: '/private/knowledge/alarm.md', content: 'bounded retrieval evidence' }],
      },
    });
    expect(Object.keys(outcome.payload.safeResult as Record<string, unknown>).sort()).toEqual(['items', 'kind', 'totalCount']);
    expect(JSON.stringify(outcome.payload)).not.toContain('privateScore');
  });

  it('splits RAG source by pipe and returns the first part in DETAIL', () => {
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [
          {
            source: 'knowledge-base|extra|metadata',
            content: 'pipe-split evidence',
          },
        ],
      }),
      'DETAIL',
    );

    expect(outcome.payload.safeResult).toMatchObject({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'knowledge-base', content: 'pipe-split evidence' }],
    });
  });

  it('falls back to title when RAG source is empty in DETAIL', () => {
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [
          {
            source: '',
            title: 'fallback-title',
            content: 'title-fallback evidence',
          },
        ],
      }),
      'DETAIL',
    );

    expect(outcome.payload.safeResult).toMatchObject({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'fallback-title', content: 'title-fallback evidence' }],
    });
  });

  it('falls back to the first 256 characters of content plus an ellipsis when RAG source and title are empty in DETAIL', () => {
    const longContent = `${'x'.repeat(300)}tail-must-not-enter-source`;
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [
          {
            source: '',
            content: longContent,
          },
        ],
      }),
      'DETAIL',
    );

    expect(outcome.payload.safeResult).toMatchObject({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: `${longContent.slice(0, 256)}...`, content: longContent }],
    });
  });

  it('falls back to the full content without an ellipsis when it fits within 256 characters in DETAIL', () => {
    const shortContent = 'compact retrieval evidence';
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [
          {
            source: '',
            content: shortContent,
          },
        ],
      }),
      'DETAIL',
    );

    expect(outcome.payload.safeResult).toMatchObject({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: shortContent, content: shortContent }],
    });
  });

  it('falls back to an empty source when RAG source, title, and content are all missing in DETAIL', () => {
    const outcome = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: [{ score: 0.5 }],
      }),
      'DETAIL',
    );

    expect(outcome.payload.safeResult).toMatchObject({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: '', content: '' }],
    });
  });

  it.each(supportedProjectionCases)(
    'projects $capabilityId through all three levels within its platform ceiling',
    ({ event: result, hasSafeProjection, hasSummarySafeResult }) => {
      const statusOnly = projectEnvelope(result(), 'STATUS_ONLY');
      const summary = projectEnvelope(result(), 'SUMMARY');
      const detail = projectEnvelope(result(), 'DETAIL');

      expect(statusOnly.payload).not.toHaveProperty('safeSummary');
      expect(statusOnly.payload).not.toHaveProperty('safeResult');
      expect(statusOnly.payload.content).toBe('');
      if (hasSafeProjection) {
        expect(summary.payload.safeSummary).toEqual(expect.any(String));
        expect(summary.payload.safeSummaryCode).toEqual(expect.any(String));
        expect(summary.payload.safeSummaryArgs).toEqual(expect.any(Object));
        if (hasSummarySafeResult) {
          expect(summary.payload.safeResult).toMatchObject({
            kind: 'ragRetrieval',
            totalCount: 1,
            items: [{ source: '/private/rag/alarm.md', content: 'bounded retrieval evidence' }],
          });
        } else {
          expect(summary.payload).not.toHaveProperty('safeResult');
        }
        expect(detail.payload.safeSummary).toEqual(expect.any(String));
        expect(detail.payload.safeSummaryCode).toBe(summary.payload.safeSummaryCode);
        expect(detail.payload.safeSummaryArgs).toEqual(summary.payload.safeSummaryArgs);
        expect(detail.payload.safeResult).toEqual(expect.any(Object));
      } else {
        expect(summary.payload).not.toHaveProperty('safeSummary');
        expect(summary.payload).not.toHaveProperty('safeResult');
        expect(detail.payload).not.toHaveProperty('safeSummary');
        expect(detail.payload).not.toHaveProperty('safeResult');
      }
      expect(JSON.stringify([statusOnly, summary, detail])).not.toContain('must not leak');
    },
  );

  it.each(supportedProjectionCases)('keeps $capabilityId failures safe and invalid results status-only', ({ capabilityId }) => {
    const failure = projectEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId,
        toolCallId: 'call-failure',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_INPUT_INVALID',
        safeErrorCategory: 'VALIDATION',
        result: { privateValue: 'must not leak' },
      }),
      'DETAIL',
    );
    const invalid = projectEnvelope(
      resultEvent(capabilityId, {
        privateValue: 'must not leak',
      }),
      'DETAIL',
    );

    expect(failure.payload.safeSummary).toBe('Tool input is invalid, so the capability was not executed.');
    expect(failure.payload.safeSummaryArgs).toEqual({});
    expect(failure.payload).not.toHaveProperty('safeResult');
    expect(invalid.payload).not.toHaveProperty('safeSummary');
    expect(invalid.payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify([failure, invalid])).not.toContain('must not leak');
  });

  it.each(
    sensitiveStatusOnlyCases.flatMap((projectionCase) =>
      (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map((requestedLevel) => ({ ...projectionCase, requestedLevel })),
    ),
  )(
    'keeps $capabilityId success status-only when the configured level is $requestedLevel',
    ({ capabilityId, result, leakSentinels, requestedLevel }) => {
      const outcome = projectTimelineEventToStreamEnvelope(resultEvent(capabilityId, result), {
        capabilityResultPresentationPolicy: policy('SUMMARY', [[capabilityId, requestedLevel]]),
      });

      expect(outcome.kind).toBe('ENVELOPE');
      if (outcome.kind !== 'ENVELOPE') {
        throw new Error('Expected a visible capability result envelope.');
      }
      expect(outcome.envelope.payload).toMatchObject({
        capabilityId,
        resultPresentationLevel: 'STATUS_ONLY',
        content: '',
      });
      expect(outcome.envelope.payload.text ?? '').toBe('');
      expect(outcome.envelope.payload).not.toHaveProperty('safeSummary');
      expect(outcome.envelope.payload).not.toHaveProperty('safeSummaryCode');
      expect(outcome.envelope.payload).not.toHaveProperty('safeSummaryArgs');
      expect(outcome.envelope.payload).not.toHaveProperty('safeResult');
      expect(outcome.envelope.payload).not.toHaveProperty('result');
      for (const sentinel of leakSentinels) {
        expect(JSON.stringify(outcome.envelope.payload)).not.toContain(sentinel);
      }
    },
  );

  it.each(
    sensitiveStatusOnlyCases.flatMap(({ capabilityId }) =>
      (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map((requestedLevel) => ({ capabilityId, requestedLevel })),
    ),
  )('keeps $capabilityId safe failure facts visible when the configured level is $requestedLevel', ({ capabilityId, requestedLevel }) => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId,
        toolCallId: 'call-sensitive-failure',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_INPUT_INVALID',
        safeErrorCategory: 'VALIDATION',
        result: { privateValue: 'sensitive-failure-result-must-not-leak' },
      }),
      { capabilityResultPresentationPolicy: policy('SUMMARY', [[capabilityId, requestedLevel]]) },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind !== 'ENVELOPE') {
      throw new Error('Expected a visible capability failure envelope.');
    }
    expect(outcome.envelope.payload).toMatchObject({
      capabilityId,
      resultPresentationLevel: 'STATUS_ONLY',
      safeErrorCode: 'CAPABILITY_INPUT_INVALID',
      safeErrorCategory: 'VALIDATION',
      safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT',
      safeSummaryArgs: {},
    });
    expect(outcome.envelope.payload.safeSummary).toEqual(expect.any(String));
    expect(outcome.envelope.payload).not.toHaveProperty('safeResult');
    expect(outcome.envelope.payload).not.toHaveProperty('result');
    expect(JSON.stringify(outcome.envelope.payload)).not.toContain('sensitive-failure-result-must-not-leak');
  });

  it('bounds text and list result categories before DETAIL projection', () => {
    const overBudgetText = 'x'.repeat(5_000);
    const read = projectEnvelope(
      resultEvent('Read', {
        file_path: 'workspace/alarm.log',
        content: overBudgetText,
        truncated: false,
      }),
      'DETAIL',
    );
    const command = projectEnvelope(
      resultEvent('Bash', {
        exitCode: 0,
        stdout: overBudgetText,
        stderr: '',
      }),
      'DETAIL',
    );
    const files = projectEnvelope(
      resultEvent('Glob', {
        filenames: Array.from({ length: 60 }, (_, index) => `workspace/file-${index}.log`),
        truncated: false,
      }),
      'DETAIL',
    );
    const tools = projectEnvelope(
      resultEvent('ToolSearch', {
        tools: Array.from({ length: 60 }, (_, index) => ({
          capability_id: `tool-${index}`,
          name: `Tool ${index}`,
          kind: 'TOOL',
          description: index === 0 ? overBudgetText : 'Safe description',
        })),
        truncated: false,
      }),
      'DETAIL',
    );
    const rag = projectEnvelope(
      resultEvent('Rag', {
        status: 'OK',
        results: Array.from({ length: 60 }, (_, index) => ({
          source: `/private/rag/source-${index}.md`,
          content: index === 0 ? overBudgetText : `Evidence ${index}`,
          privateScore: 'must not leak',
        })),
      }),
      'DETAIL',
    );
    const todos = projectEnvelope(
      resultEvent('TodoWrite', {
        newTodos: Array.from({ length: 100 }, (_, index) => ({
          content: index === 0 ? overBudgetText : `Todo ${index}`,
          activeForm: `Working on todo ${index}`,
          status: 'pending',
        })),
      }),
      'DETAIL',
    );
    const workflow = projectEnvelope(
      resultEvent('Workflow', {
        recipeName: 'alarm-analysis',
        status: 'succeeded',
        answerPreviews: [overBudgetText, ...Array.from({ length: 14 }, (_, index) => `Answer ${index}`)],
      }),
      'DETAIL',
    );
    const cron = projectEnvelope(
      resultEvent('Cron', {
        action: 'list',
        jobs: Array.from({ length: 60 }, (_, index) => ({
          id: `cron-${index}`,
          cron: '17 3 * * *',
          humanSchedule: 'Every day at 03:17',
        })),
      }),
      'DETAIL',
    );
    const clip = projectEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'dynamic-clip-network-inspector',
        toolCallId: 'call-clip-bounded',
        status: 'SUCCEEDED',
        resultProjectionKind: 'CLIP_STREAM_V1',
        result: { event: 'DETAIL', data_raw: overBudgetText },
      }),
      'DETAIL',
    );

    expect(read.payload.safeResult).toMatchObject({ truncated: true });
    expect(command.payload.safeResult).toMatchObject({ stdoutTruncated: true });
    expect(files.payload.safeResult).toMatchObject({ totalCount: 60, truncated: true });
    expect(tools.payload.safeResult).toMatchObject({ totalCount: 60, truncated: true });
    expect(rag.payload.safeResult).toMatchObject({ totalCount: 60, items: expect.any(Array) });
    expect((rag.payload.safeResult as { items: readonly unknown[] }).items).toHaveLength(50);
    expect(todos.payload.safeResult).toMatchObject({ todos: expect.any(Array) });
    expect((todos.payload.safeResult as { todos: readonly unknown[] }).todos).toHaveLength(50);
    const workflowAnswerPreviews = (workflow.payload.safeResult as { answerPreviews: readonly unknown[] }).answerPreviews;
    expect(workflowAnswerPreviews.length).toBeGreaterThan(0);
    expect(workflowAnswerPreviews.length).toBeLessThanOrEqual(10);
    expect(workflowAnswerPreviews.join('').length).toBeLessThanOrEqual(4_000);
    expect((read.payload.safeResult as { contentPreview: string }).contentPreview.length).toBeLessThanOrEqual(4_000);
    expect((command.payload.safeResult as { stdoutPreview: string }).stdoutPreview.length).toBeLessThanOrEqual(4_000);
    expect(cron.payload.safeResult).toMatchObject({ totalCount: 60, truncated: true });
    expect(clip.payload.safeResult).toMatchObject({ dataRawTruncated: true });
    expect(JSON.stringify([read, command, tools, todos, workflow, clip])).not.toContain(overBudgetText);
    expect(JSON.stringify(rag)).not.toContain('privateScore');
  });

  it('projects Grep summaries from canonical totals without exposing result entries', () => {
    const files = projectEnvelope(
      resultEvent('Grep', {
        output_mode: 'files_with_matches',
        filenames: ['workspace/alarm.log'],
        matches: [],
        total_files_with_matches: 12,
        total_matches: 19,
        truncated: true,
      }),
      'SUMMARY',
    );
    const content = projectEnvelope(
      resultEvent('Grep', {
        output_mode: 'content',
        filenames: [],
        matches: [{ file_path: 'workspace/alarm.log', line_number: 7, line: 'SECRET_MATCHED_LINE' }],
        total_files_with_matches: 3,
        total_matches: 8,
        truncated: false,
      }),
      'SUMMARY',
    );

    expect(files.payload).toMatchObject({
      resultPresentationLevel: 'SUMMARY',
      safeSummaryCode: 'CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES',
      safeSummaryArgs: { totalFilesWithMatches: 12, truncated: true },
    });
    expect(Object.keys(files.payload.safeSummaryArgs as Record<string, unknown>).sort()).toEqual(['totalFilesWithMatches', 'truncated']);
    expect(content.payload).toMatchObject({
      resultPresentationLevel: 'SUMMARY',
      safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
      safeSummaryArgs: { totalMatches: 8, totalFilesWithMatches: 3, truncated: false },
    });
    expect(Object.keys(content.payload.safeSummaryArgs as Record<string, unknown>).sort()).toEqual([
      'totalFilesWithMatches',
      'totalMatches',
      'truncated',
    ]);
    expect(files.payload).not.toHaveProperty('safeResult');
    expect(content.payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify([files.payload, content.payload])).not.toContain('SECRET_MATCHED_LINE');
  });

  it('projects bounded Grep details without matched lines', () => {
    const content = projectEnvelope(
      resultEvent('Grep', {
        output_mode: 'content',
        filenames: [],
        matches: Array.from({ length: 75 }, (_, index) => ({
          file_path: `workspace/alarm-${index}.log`,
          line_number: index + 1,
          line: `SECRET_MATCHED_LINE_${index}`,
        })),
        total_files_with_matches: 75,
        total_matches: 75,
        truncated: false,
      }),
      'DETAIL',
    );
    const files = projectEnvelope(
      resultEvent('Grep', {
        output_mode: 'files_with_matches',
        filenames: ['workspace/a.log', 'workspace/b.log'],
        matches: [],
        total_files_with_matches: 2,
        total_matches: 4,
        truncated: false,
      }),
      'DETAIL',
    );

    expect(content.payload.safeResult).toMatchObject({
      kind: 'grepResult',
      outputMode: 'content',
      totalFilesWithMatches: 75,
      totalMatches: 75,
      truncated: true,
      locations: expect.any(Array),
    });
    expect((content.payload.safeResult as { locations: readonly unknown[] }).locations).toHaveLength(50);
    expect((content.payload.safeResult as { locations: readonly unknown[] }).locations[0]).toEqual({
      filePath: 'workspace/alarm-0.log',
      lineNumber: 1,
    });
    expect(files.payload.safeResult).toEqual({
      kind: 'grepResult',
      outputMode: 'files_with_matches',
      totalFilesWithMatches: 2,
      totalMatches: 4,
      truncated: false,
      filenames: ['workspace/a.log', 'workspace/b.log'],
    });
    expect(JSON.stringify([content.payload, files.payload])).not.toContain('SECRET_MATCHED_LINE');
  });

  it('keeps zero-match Grep summaries in their canonical content mode', () => {
    const outcome = projectEnvelope(
      resultEvent('Grep', {
        output_mode: 'content',
        filenames: [],
        matches: [],
        total_files_with_matches: 0,
        total_matches: 0,
        truncated: false,
      }),
      'DETAIL',
    );

    expect(outcome.payload).toMatchObject({
      resultPresentationLevel: 'DETAIL',
      safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
      safeSummaryArgs: { totalMatches: 0, totalFilesWithMatches: 0, truncated: false },
      safeResult: { kind: 'grepResult', outputMode: 'content', locations: [] },
    });
  });

  it.each([
    {
      caseName: 'missing output mode',
      result: { filenames: [], matches: [], total_files_with_matches: 0, total_matches: 0, truncated: false },
    },
    {
      caseName: 'mode-array mismatch',
      result: {
        output_mode: 'files_with_matches',
        filenames: [],
        matches: [{ file_path: 'workspace/alarm.log', line_number: 1, line: 'SECRET_MATCHED_LINE' }],
        total_files_with_matches: 1,
        total_matches: 1,
        truncated: false,
      },
    },
    {
      caseName: 'unsafe physical path',
      result: {
        output_mode: 'content',
        filenames: [],
        matches: [{ file_path: '/private/network/alarm.log', line_number: 1, line: 'SECRET_MATCHED_LINE' }],
        total_files_with_matches: 1,
        total_matches: 1,
        truncated: false,
      },
    },
    {
      caseName: 'invalid total',
      result: {
        output_mode: 'content',
        filenames: [],
        matches: [],
        total_files_with_matches: 0,
        total_matches: -1,
        truncated: false,
      },
    },
    {
      caseName: 'file count smaller than returned filenames',
      result: {
        output_mode: 'files_with_matches',
        filenames: ['workspace/alarm.log'],
        matches: [],
        total_files_with_matches: 0,
        total_matches: 1,
        truncated: false,
      },
    },
    {
      caseName: 'match count smaller than returned matches',
      result: {
        output_mode: 'content',
        filenames: [],
        matches: [{ file_path: 'workspace/alarm.log', line_number: 1, line: 'SECRET_MATCHED_LINE' }],
        total_files_with_matches: 1,
        total_matches: 0,
        truncated: false,
      },
    },
    {
      caseName: 'control character path',
      result: {
        output_mode: 'content',
        filenames: [],
        matches: [{ file_path: 'workspace/alarm\nsecret.log', line_number: 1, line: 'SECRET_MATCHED_LINE' }],
        total_files_with_matches: 1,
        total_matches: 1,
        truncated: false,
      },
    },
    {
      caseName: 'over-budget matched line',
      result: {
        output_mode: 'content',
        filenames: [],
        matches: [{ file_path: 'workspace/alarm.log', line_number: 1, line: 'S'.repeat(4097) }],
        total_files_with_matches: 1,
        total_matches: 1,
        truncated: false,
      },
    },
  ])('degrades Grep with $caseName to status only', ({ result }) => {
    const outcome = projectEnvelope(resultEvent('Grep', result), 'DETAIL');

    expect(outcome.payload).toMatchObject({ resultPresentationLevel: 'STATUS_ONLY', content: '' });
    expect(outcome.payload).not.toHaveProperty('safeSummary');
    expect(outcome.payload).not.toHaveProperty('safeSummaryCode');
    expect(outcome.payload).not.toHaveProperty('safeSummaryArgs');
    expect(outcome.payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify(outcome.payload)).not.toContain('SECRET_MATCHED_LINE');
    expect(JSON.stringify(outcome.payload)).not.toContain('/private/network');
  });

  it.each([
    {
      caseName: 'an over-budget recipe name',
      result: {
        recipeName: `must-not-leak-${'x'.repeat(300)}`,
        status: 'succeeded',
      },
    },
    {
      caseName: 'an unknown status',
      result: {
        recipeName: 'alarm-analysis',
        status: 'must-not-leak',
      },
    },
    {
      caseName: 'an over-budget status',
      result: {
        recipeName: 'alarm-analysis',
        status: `must-not-leak-${'x'.repeat(300)}`,
      },
    },
  ])('degrades Workflow results with $caseName to status only', ({ result }) => {
    const outcome = projectEnvelope(resultEvent('Workflow', result), 'DETAIL');

    expect(outcome.payload).toMatchObject({
      capabilityId: 'Workflow',
      resultPresentationLevel: 'STATUS_ONLY',
      content: '',
    });
    expect(outcome.payload).not.toHaveProperty('safeSummary');
    expect(outcome.payload).not.toHaveProperty('safeSummaryCode');
    expect(outcome.payload).not.toHaveProperty('safeSummaryArgs');
    expect(outcome.payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify(outcome.payload)).not.toContain('must-not-leak');
  });

  it('lets an exact Bash rule narrow a detail-safe command to status only', () => {
    const outcome = projectTimelineEventToStreamEnvelope(resultEvent('Bash', { exitCode: 0, stdout: 'private output', stderr: '' }), {
      capabilityResultPresentationPolicy: policy('DETAIL', [['Bash', 'STATUS_ONLY']]),
    });

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: { payload: { capabilityId: 'Bash', content: '' } },
    });
    expect(JSON.stringify(outcome)).not.toContain('private output');
  });

  it('produces the same Read projection for direct and Skill-activated invocation', () => {
    const canonicalPayload = {
      capabilityId: 'Read',
      toolCallId: 'call-read',
      status: 'SUCCEEDED',
      result: {
        file_path: 'workspace/alarm.json',
        content: 'bounded alarm evidence',
        truncated: false,
      },
    };
    const direct = projectEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        ...canonicalPayload,
        invocationSource: 'DIRECT',
      }),
      'DETAIL',
    );
    const skillActivated = projectEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        ...canonicalPayload,
        invocationSource: 'SKILL',
        skillId: 'network-diagnosis',
        skillSourcePath: '/private/internal/SKILL.md',
        skillContent: 'must not leak',
      }),
      'DETAIL',
    );

    expect(skillActivated.payload).toEqual(direct.payload);
    expect(JSON.stringify(skillActivated.payload)).not.toContain('network-diagnosis');
    expect(JSON.stringify(skillActivated.payload)).not.toContain('SKILL.md');
    expect(JSON.stringify(skillActivated.payload)).not.toContain('must not leak');
  });

  it('applies the Skill identity ceiling before file-shaped result recognition', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      resultEvent('Skill', {
        file_path: '/private/internal/SKILL.md',
        content: 'internal skill instructions',
        truncated: false,
        name: 'internal-skill',
        status: 'LOADED',
      }),
      { capabilityResultPresentationPolicy: policy('DETAIL') },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: { payload: { capabilityId: 'Skill', content: '' } },
    });
    expect(JSON.stringify(outcome)).not.toContain('internal skill instructions');
    expect(JSON.stringify(outcome)).not.toContain('SKILL.md');
    expect(JSON.stringify(outcome)).not.toContain('safeResult');
  });

  it('fails an unknown custom capability closed even when its shape resembles Read', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      resultEvent('CustomReader', {
        file_path: 'workspace/private.txt',
        content: 'must not leak',
        truncated: false,
      }),
      { capabilityResultPresentationPolicy: policy('DETAIL') },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: { payload: { capabilityId: 'CustomReader', content: '' } },
    });
    expect(JSON.stringify(outcome)).not.toContain('must not leak');
    expect(JSON.stringify(outcome)).not.toContain('safeResult');
  });

  it('rebuilds recognized upstream projections from a field whitelist', () => {
    const workflowOutcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Workflow',
        toolCallId: 'call-workflow-1',
        status: 'SUCCEEDED',
        result: { workflowDelta: { channel: 'CONTENT', content: 'private canonical content' } },
        safeSummary: 'untrusted summary',
        safeDetailText: 'bounded workflow output',
        safeResult: {
          kind: 'workflowDelta',
          channel: 'CONTENT',
          truncated: false,
          privateTrace: 'must not leak',
        },
      }),
      { capabilityResultPresentationPolicy: policy('DETAIL') },
    );
    const clipOutcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'dynamic-clip-network-inspector',
        toolCallId: 'call-clip-1',
        status: 'SUCCEEDED',
        resultProjectionKind: 'CLIP_STREAM_V1',
        result: {
          event: 'DETAIL',
          data_raw: 'bounded CLIP output',
          data: { credential: 'must not leak' },
        },
        safeSummary: 'untrusted summary',
        safeResult: {
          kind: 'clipStreamEvent',
          eventType: 'SPOOFED',
          dataRawPreview: 'spoofed output',
          privateTrace: 'must not leak',
        },
      }),
      { capabilityResultPresentationPolicy: policy('DETAIL') },
    );
    const spoofedClipOutcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'custom-network-probe',
        toolCallId: 'call-clip-spoofed',
        status: 'SUCCEEDED',
        safeDetailText: 'spoofed output',
        safeResult: { kind: 'clipStreamEvent', dataRawPreview: 'spoofed output' },
      }),
      { capabilityResultPresentationPolicy: policy('DETAIL') },
    );

    expect(workflowOutcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          safeSummary: 'Workflow is generating output.',
          safeResult: { kind: 'workflowDelta', channel: 'CONTENT', truncated: false },
        },
      },
    });
    expect(clipOutcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          safeSummary: 'CLIP stream event received.',
          safeResult: {
            kind: 'clipStreamEvent',
            eventType: 'DETAIL',
            dataRawPreview: 'bounded CLIP output',
            dataRawTruncated: false,
          },
        },
      },
    });
    expect(spoofedClipOutcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          capabilityId: 'custom-network-probe',
          resultPresentationLevel: 'STATUS_ONLY',
          content: '',
        },
      },
    });
    expect(JSON.stringify(spoofedClipOutcome)).not.toContain('safeResult');
    expect(JSON.stringify(spoofedClipOutcome)).not.toContain('spoofed output');
    expect(JSON.stringify([workflowOutcome, clipOutcome])).not.toContain('must not leak');
    expect(JSON.stringify([workflowOutcome, clipOutcome])).not.toContain('untrusted summary');
  });

  it('fails recognized upstream kinds closed when their safe schema is invalid', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Workflow',
        toolCallId: 'call-workflow-invalid',
        status: 'SUCCEEDED',
        safeDetailText: 'must not leak',
        safeResult: { kind: 'workflowDelta', channel: { unexpected: true }, truncated: false },
      }),
      { capabilityResultPresentationPolicy: policy('DETAIL') },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: { payload: { capabilityId: 'Workflow', content: '' } },
    });
    expect(JSON.stringify(outcome)).not.toContain('safeResult');
    expect(JSON.stringify(outcome)).not.toContain('must not leak');
  });

  it('projects an accepted AskUser answer as the same bounded public fact at every result level', () => {
    const answerEvent = resultEvent('AskUserQuestion', {
      kind: 'QUESTION',
      status: 'RECEIVED',
      pendingInputId: 'pending-public-answer',
      answers: [['Core network']],
      privateValue: 'must not leak',
    });
    const projections = (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map((level) => projectEnvelope(answerEvent, level).payload);
    const publicFact = (payload: Record<string, unknown>) => ({
      capabilityId: payload.capabilityId,
      toolCallId: payload.toolCallId,
      pendingInputId: payload.pendingInputId,
      kind: payload.kind,
      status: payload.status,
      safeSummary: payload.safeSummary,
      safeResult: payload.safeResult,
    });

    expect(projections.map(publicFact)).toEqual([
      expect.objectContaining({
        capabilityId: 'AskUserQuestion',
        pendingInputId: 'pending-public-answer',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeResult: { kind: 'pendingInputAnswer', answers: [['Core network']], truncated: false },
      }),
      expect.any(Object),
      expect.any(Object),
    ]);
    expect(publicFact(projections[1] as Record<string, unknown>)).toEqual(publicFact(projections[0] as Record<string, unknown>));
    expect(publicFact(projections[2] as Record<string, unknown>)).toEqual(publicFact(projections[0] as Record<string, unknown>));
    expect(JSON.stringify(projections)).not.toContain('must not leak');
  });

  it('keeps safe failure facts visible under STATUS_ONLY without exposing result details', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Bash',
        toolCallId: 'call-1',
        status: 'FAILED',
        safeErrorCode: 'COMMAND_NOT_ALLOWED',
        safeErrorCategory: 'POLICY_DENIED',
        result: { stdout: 'must not leak', stderr: 'must not leak', exitCode: 1 },
      }),
      { capabilityResultPresentationPolicy: policy('STATUS_ONLY') },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          safeErrorCode: 'COMMAND_NOT_ALLOWED',
          safeErrorCategory: 'POLICY_DENIED',
          safeSummary: expect.stringContaining('blocked'),
          safeSummaryArgs: {},
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('must not leak');
    expect(JSON.stringify(outcome)).not.toContain('safeResult');
  });

  it.each([
    ['COMMAND_NOT_ALLOWED', 'AUTHORIZATION', 'CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED'],
    ['COMMAND_NOT_ALLOWED', 'POLICY_DENIED', 'CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED'],
    ['COMMAND_NOT_ALLOWED', undefined, 'CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED'],
    ['CAPABILITY_INPUT_INVALID', 'VALIDATION', 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT'],
    ['INVALID_INPUT', undefined, 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT'],
    ['CAPABILITY_PATH_REJECTED', 'AUTHORIZATION', 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED'],
    ['CAPABILITY_PATH_REJECTED', 'POLICY_DENIED', 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED'],
    ['CAPABILITY_RESULT_LIMIT_EXCEEDED', 'VALIDATION', 'CAPABILITY_RESULT_FAILURE_TOO_LARGE'],
    ['RESOURCE_TOO_LARGE', undefined, 'CAPABILITY_RESULT_FAILURE_TOO_LARGE'],
    ['WRITE_REQUIRES_FULL_READ', 'CONFLICT', 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED'],
    ['EDIT_REQUIRES_FULL_READ', undefined, 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED'],
    ['WRITE_TARGET_CHANGED', 'CONFLICT', 'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED'],
    ['EDIT_TARGET_CHANGED', undefined, 'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED'],
    ['PLATFORM_UNSUPPORTED', 'UNAVAILABLE', 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED'],
    ['PLATFORM_UNSUPPORTED', undefined, 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED'],
    ['INTERPRETER_UNAVAILABLE', 'UNAVAILABLE', 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE'],
    ['SANDBOX_UNAVAILABLE', undefined, 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE'],
  ] as const)('maps audited failure pair %s + %s to %s', (safeErrorCode, safeErrorCategory, expectedSummaryCode) => {
    const payload = projectEnvelope(
      failureEvent({
        safeErrorCode,
        ...(safeErrorCategory === undefined ? {} : { safeErrorCategory }),
      }),
      'DETAIL',
    ).payload;

    expect(payload).toMatchObject({
      safeErrorCode,
      safeSummaryCode: expectedSummaryCode,
      safeSummaryArgs: {},
    });
    if (safeErrorCategory === undefined) {
      expect(payload).not.toHaveProperty('safeErrorCategory');
    } else {
      expect(payload.safeErrorCategory).toBe(safeErrorCategory);
    }
    expect(payload).not.toHaveProperty('safeResult');
  });

  it.each([
    ['AUTHORIZATION', 'CAPABILITY_RESULT_FAILURE_POLICY_DENIED'],
    ['POLICY_DENIED', 'CAPABILITY_RESULT_FAILURE_POLICY_DENIED'],
    ['VALIDATION', 'CAPABILITY_RESULT_FAILURE_VALIDATION'],
    ['NOT_FOUND', 'CAPABILITY_RESULT_FAILURE_NOT_FOUND'],
    ['CONFLICT', 'CAPABILITY_RESULT_FAILURE_CONFLICT'],
    ['UNAVAILABLE', 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE'],
    ['TIMEOUT', 'CAPABILITY_RESULT_FAILURE_TIMEOUT'],
    ['CANCELED', 'CAPABILITY_RESULT_FAILURE_CANCELED'],
    ['INTERNAL', 'CAPABILITY_RESULT_FAILURE_INTERNAL'],
  ] as const)('uses the complete %s category fallback', (safeErrorCategory, expectedSummaryCode) => {
    const payload = projectEnvelope(
      failureEvent({
        safeErrorCode: 'UNKNOWN_VENDOR_FAILURE',
        safeErrorCategory,
      }),
      'SUMMARY',
    ).payload;

    expect(payload).toMatchObject({
      safeErrorCode: 'UNKNOWN_VENDOR_FAILURE',
      safeErrorCategory,
      safeSummaryCode: expectedSummaryCode,
      safeSummaryArgs: {},
    });
  });

  it.each([
    ['EXECUTION_FAILED', 'VALIDATION', 'CAPABILITY_RESULT_FAILURE_VALIDATION'],
    ['EXECUTION_FAILED', 'UNAVAILABLE', 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE'],
    ['EXECUTION_FAILED', 'CANCELED', 'CAPABILITY_RESULT_FAILURE_CANCELED'],
    ['EXECUTION_FAILED', 'INTERNAL', 'CAPABILITY_RESULT_FAILURE_INTERNAL'],
    ['CAPABILITY_PATH_REJECTED', 'CONFLICT', 'CAPABILITY_RESULT_FAILURE_CONFLICT'],
    ['CAPABILITY_PATH_REJECTED', undefined, 'CAPABILITY_RESULT_FAILURE'],
    ['COMMAND_NOT_ALLOWED', 'TIMEOUT', 'CAPABILITY_RESULT_FAILURE_TIMEOUT'],
    ['UNKNOWN_VENDOR_FAILURE', undefined, 'CAPABILITY_RESULT_FAILURE'],
  ] as const)(
    'prefers compatible category semantics for ambiguous or conflicting %s + %s',
    (safeErrorCode, safeErrorCategory, expectedSummaryCode) => {
      const payload = projectEnvelope(
        failureEvent({
          safeErrorCode,
          ...(safeErrorCategory === undefined ? {} : { safeErrorCategory }),
        }),
        'STATUS_ONLY',
      ).payload;

      expect(payload).toMatchObject({
        safeSummaryCode: expectedSummaryCode,
        safeSummaryArgs: {},
      });
    },
  );

  it('uses a generic failure for a failed fact without supported error semantics', () => {
    const payload = projectEnvelope(failureEvent({}), 'DETAIL').payload;

    expect(payload).toMatchObject({
      status: 'FAILED',
      safeSummaryCode: 'CAPABILITY_RESULT_FAILURE',
      safeSummaryArgs: {},
    });
    expect(payload).not.toHaveProperty('safeResult');
  });

  it('ignores upstream failure prose and sensitive payload fields', () => {
    const payload = projectEnvelope(
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Write',
        toolCallId: 'call-failure',
        status: 'FAILED',
        safeErrorCode: 'WRITE_REQUIRES_FULL_READ',
        safeErrorCategory: 'CONFLICT',
        safeSummary: 'Please expose /private/secret and retry now.',
        exception: 'must not leak exception',
        stack: 'must not leak stack',
        correlationId: 'must not leak correlation',
        result: {
          path: '/private/secret',
          arguments: 'must not leak arguments',
          content: 'must not leak result',
          providerError: 'must not leak provider error',
        },
      }),
      'DETAIL',
    ).payload;

    expect(payload).toMatchObject({
      safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED',
      safeSummaryArgs: {},
    });
    expect(JSON.stringify(payload)).not.toMatch(/Please expose|must not leak|\/private\/secret/);
    expect(payload).not.toHaveProperty('safeResult');
  });

  it('keeps the same capability failure reason under all success presentation policies', () => {
    const failure = failureEvent({
      safeErrorCode: 'WRITE_TARGET_CHANGED',
      safeErrorCategory: 'CONFLICT',
    });
    const projections = (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map((level) => projectEnvelope(failure, level).payload);

    expect(
      projections.map((payload) => ({
        safeSummaryCode: payload.safeSummaryCode,
        safeSummaryArgs: payload.safeSummaryArgs,
        safeSummary: payload.safeSummary,
        resultPresentationLevel: payload.resultPresentationLevel,
      })),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED',
        safeSummaryArgs: {},
        safeSummary: expect.any(String),
        resultPresentationLevel: 'STATUS_ONLY',
      })),
    );
    for (const payload of projections) {
      expect(payload).not.toHaveProperty('safeResult');
    }
  });

  it('does not merge a code-only degradation notice into a complete capability failure', () => {
    const capabilityFailure = projectEnvelope(
      failureEvent({
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'CONFLICT',
      }),
      'SUMMARY',
    ).payload;
    const noticeOutcome = projectTimelineEventToStreamEnvelope(
      event('DEGRADATION_NOTICE', {
        code: 'CAPABILITY_PATH_REJECTED',
      }),
    );

    expect(capabilityFailure).toMatchObject({
      safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_CONFLICT',
      safeSummaryArgs: {},
    });
    expect(noticeOutcome.kind).toBe('ENVELOPE');
    if (noticeOutcome.kind !== 'ENVELOPE') {
      throw new Error('Expected a degradation notice envelope.');
    }
    expect(noticeOutcome.envelope.payload).not.toHaveProperty('capabilityId');
    expect(noticeOutcome.envelope.payload).not.toHaveProperty('toolCallId');
    expect(noticeOutcome.envelope.payload).not.toHaveProperty('safeErrorCategory');
  });

  it.each(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED'] as const)('does not use %s as lifecycle body text', (type) => {
    const payload = projectEnvelope(
      event(type, {
        capabilityId: 'Read',
        toolCallId: 'call-lifecycle',
      }),
      'SUMMARY',
    ).payload;

    expect(payload).not.toHaveProperty('text');
    expect(payload).not.toHaveProperty('content');
  });
});

interface SupportedProjectionCase {
  readonly capabilityId: string;
  readonly hasSafeProjection: boolean;
  readonly hasSummarySafeResult: boolean;
  readonly event: () => RunTimelineEvent;
}

const supportedProjectionCases: readonly SupportedProjectionCase[] = [
  capabilityCase('Read', { file_path: '/private/network/alarm.json', content: 'safe read evidence', truncated: false }),
  capabilityCase('Write', { file_path: 'workspace/report.md', type: 'create' }),
  capabilityCase('Edit', { file_path: 'workspace/report.md', type: 'update' }),
  capabilityCase('Glob', { filenames: ['workspace/a.log', 'workspace/b.log'], truncated: false }),
  capabilityCase('Grep', {
    output_mode: 'files_with_matches',
    filenames: ['workspace/alarm.log'],
    matches: [],
    total_files_with_matches: 1,
    total_matches: 1,
    truncated: false,
  }),
  capabilityCase('Bash', { exitCode: 0, stdout: 'command evidence', stderr: '' }),
  capabilityCase('Python', { exitCode: 0, stdout: 'analysis evidence', stderr: '' }),
  capabilityCase('ToolSearch', {
    tools: [{ capability_id: 'Read', name: 'Read', kind: 'TOOL', description: 'Read a governed file.' }],
    truncated: false,
  }),
  capabilityCase('Workflow', { recipeName: 'alarm-analysis', status: 'succeeded', answerPreviews: ['safe answer'] }),
  capabilityCase('TodoWrite', {
    newTodos: [{ content: 'Inspect alarms', activeForm: 'Inspecting alarms', status: 'in_progress' }],
  }),
  capabilityCase('Cron', {
    action: 'create',
    id: 'cron-1',
    humanSchedule: 'Every day at 03:17',
    recurring: true,
  }),
  capabilityCase(
    'Rag',
    {
      status: 'OK',
      results: [{ source: '/private/rag/alarm.md', content: 'bounded retrieval evidence', privateScore: 'must not leak' }],
    },
    true,
  ),
  capabilityCase(
    'Skill',
    {
      file_path: '/private/internal/SKILL.md',
      content: 'must not leak',
      truncated: false,
    },
    false,
  ),
  capabilityCase('Agent', { content: 'must not leak' }, false),
  capabilityCase(
    'ApiCall',
    {
      status: 200,
      headers: { authorization: 'must not leak' },
      body: 'must not leak',
    },
    false,
  ),
  {
    capabilityId: 'dynamic-clip-network-inspector',
    hasSafeProjection: true,
    hasSummarySafeResult: false,
    event: () =>
      event('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'dynamic-clip-network-inspector',
        toolCallId: 'call-clip',
        status: 'SUCCEEDED',
        resultProjectionKind: 'CLIP_STREAM_V1',
        result: { event: 'DETAIL', data_raw: 'bounded CLIP output', privateValue: 'must not leak' },
      }),
  },
  capabilityCase(
    'CustomReader',
    {
      file_path: 'workspace/private.txt',
      content: 'must not leak',
      truncated: false,
    },
    false,
  ),
];

interface SensitiveStatusOnlyCase {
  readonly capabilityId: string;
  readonly result: Record<string, unknown>;
  readonly leakSentinels: readonly string[];
}

const sensitiveStatusOnlyCases: readonly SensitiveStatusOnlyCase[] = [
  {
    capabilityId: 'search_memory',
    result: {
      memories: [
        {
          longTermMemoryId: 'memory-search-secret-id',
          category: 'FACTUAL',
          content: 'memory-search-secret-content',
          score: 0.99,
        },
      ],
    },
    leakSentinels: ['memory-search-secret-id', 'memory-search-secret-content'],
  },
  {
    capabilityId: 'get_memory_detail',
    result: {
      longTermMemoryId: 'memory-detail-secret-id',
      content: 'memory-detail-secret-content',
      source: 'memory-detail-secret-source',
    },
    leakSentinels: ['memory-detail-secret-id', 'memory-detail-secret-content', 'memory-detail-secret-source'],
  },
  {
    capabilityId: 'add_memory',
    result: {
      longTermMemoryId: 'memory-add-secret-id',
      outcome: 'CREATED',
      nextAction: 'memory-add-secret-next-action',
    },
    leakSentinels: ['memory-add-secret-id', 'memory-add-secret-next-action'],
  },
  {
    capabilityId: 'acquire_skill',
    result: {
      outcomeCode: 'ACQUIRED',
      providerKind: 'skillhub-secret-kind',
      providerId: 'skillhub-secret-provider',
      skillId: 'skillhub-secret-skill-id',
      message: 'skillhub-secret-message',
    },
    leakSentinels: ['skillhub-secret-kind', 'skillhub-secret-provider', 'skillhub-secret-skill-id', 'skillhub-secret-message'],
  },
];

function capabilityCase(
  capabilityId: string,
  result: Record<string, unknown>,
  hasSafeProjection = true,
  hasSummarySafeResult = false,
): SupportedProjectionCase {
  return { capabilityId, hasSafeProjection, hasSummarySafeResult, event: () => resultEvent(capabilityId, result) };
}

function projectEnvelope(
  timelineEvent: RunTimelineEvent,
  level: CapabilityResultPresentationLevel,
  processMessageAssociation?: ProcessMessageAssociation,
) {
  const outcome = projectTimelineEventToStreamEnvelope(timelineEvent, {
    capabilityResultPresentationPolicy: policy(level),
    ...(processMessageAssociation === undefined ? {} : { processMessageAssociation }),
  });
  expect(outcome.kind).toBe('ENVELOPE');
  if (outcome.kind !== 'ENVELOPE') {
    throw new Error('Expected a visible capability result envelope.');
  }
  return outcome.envelope;
}

function policy(
  defaultLevel: CapabilityResultPresentationLevel,
  entries: ReadonlyArray<readonly [string, CapabilityResultPresentationLevel]> = [],
): CapabilityResultPresentationPolicy {
  return Object.freeze({
    defaultLevel,
    levelByCapabilityId: new Map(entries),
  });
}

function resultEvent(capabilityId: string, result: Record<string, unknown>): RunTimelineEvent {
  return event('CAPABILITY_RESULT_DELTA', {
    capabilityId,
    toolCallId: 'call-1',
    status: 'SUCCEEDED',
    result,
  });
}

function failureEvent({
  safeErrorCode,
  safeErrorCategory,
}: {
  readonly safeErrorCode?: string;
  readonly safeErrorCategory?: string;
}): RunTimelineEvent {
  return event('CAPABILITY_RESULT_DELTA', {
    capabilityId: 'Write',
    toolCallId: 'call-failure',
    status: 'FAILED',
    ...(safeErrorCode === undefined ? {} : { safeErrorCode }),
    ...(safeErrorCategory === undefined ? {} : { safeErrorCategory }),
    result: {
      content: 'must not leak result',
    },
  });
}

function event(type: RunTimelineEvent['type'], inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return {
    type,
    inlinePayload,
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1),
  } as RunTimelineEvent;
}
