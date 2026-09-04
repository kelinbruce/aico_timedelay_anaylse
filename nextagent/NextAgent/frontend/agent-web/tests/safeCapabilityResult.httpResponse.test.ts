import { describe, expect, it } from 'vitest';

import { readSafeCapabilityResult } from '../src/features/chat/utils/safeCapabilityResult.ts';

const structuredPiuJson = JSON.stringify({
  eventType: 'ANSWER',
  messageType: 'PIU',
  content: '{"piuName":"mae_icn_sidebar_alarm"}',
});

describe('SafeCapabilityResult httpResponse kind', () => {
  describe('readSafeCapabilityResult', () => {
    it('reads todoList kind', () => {
      const result = readSafeCapabilityResult({
        kind: 'todoList',
        todos: [
          {
            content: 'Summarize affected cells',
            activeForm: 'Summarizing affected cells',
            status: 'pending',
          },
        ],
      });
      expect(result).toEqual({
        kind: 'todoList',
        todos: [
          {
            content: 'Summarize affected cells',
            activeForm: 'Summarizing affected cells',
            status: 'pending',
          },
        ],
      });
    });

    it('reads httpResponse kind', () => {
      const result = readSafeCapabilityResult({
        kind: 'httpResponse',
        httpStatus: 200,
        responseMode: 'STREAMING',
        streamCompleted: false,
        bodyPreview: 'delta content',
        bodyPreviewTruncated: true,
      });
      expect(result).toEqual({
        kind: 'httpResponse',
        httpStatus: 200,
        responseMode: 'STREAMING',
        streamCompleted: false,
        bodyPreview: 'delta content',
        bodyPreviewTruncated: true,
      });
    });

    it('returns null for invalid responseMode', () => {
      const result = readSafeCapabilityResult({
        kind: 'httpResponse',
        httpStatus: 200,
        responseMode: 'WEBSOCKET',
        streamCompleted: false,
      });
      expect(result).toBeNull();
    });

    it('returns null when httpStatus is missing', () => {
      const result = readSafeCapabilityResult({
        kind: 'httpResponse',
        responseMode: 'BUFFERED',
        streamCompleted: true,
      });
      expect(result).toBeNull();
    });
  });

  describe('readSafeCapabilityResult workflowResult kind', () => {
    it('reads workflowResult with answerPreviews', () => {
      const result = readSafeCapabilityResult({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'succeeded',
        answerPreviews: ['Root cause: high CPU', 'Action: restart AMF'],
      });
      expect(result).toEqual({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'succeeded',
        answerPreviews: ['Root cause: high CPU', 'Action: restart AMF'],
      });
    });

    it('reads workflowResult without answerPreviews', () => {
      const result = readSafeCapabilityResult({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'failed',
      });
      expect(result).toEqual({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'failed',
      });
    });

    it('filters out non-string and empty answerPreviews', () => {
      const result = readSafeCapabilityResult({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'succeeded',
        answerPreviews: ['valid content', '', 123, null, '   ', 'another valid'],
      });
      expect(result).toEqual({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'succeeded',
        answerPreviews: ['valid content', 'another valid'],
      });
    });

    it('limits answerPreviews to 10 items', () => {
      const previews = Array.from({ length: 15 }, (_, i) => `Answer ${i}`);
      const result = readSafeCapabilityResult({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
        status: 'succeeded',
        answerPreviews: previews,
      });
      if (result?.kind !== 'workflowResult') {
        throw new Error('Expected workflowResult safe capability result.');
      }
      expect(result.answerPreviews).toHaveLength(10);
    });

    it('returns null when recipeName is missing', () => {
      const result = readSafeCapabilityResult({
        kind: 'workflowResult',
        status: 'succeeded',
      });
      expect(result).toBeNull();
    });

    it('returns null when status is missing', () => {
      const result = readSafeCapabilityResult({
        kind: 'workflowResult',
        recipeName: 'alarm-localization',
      });
      expect(result).toBeNull();
    });
  });
});
