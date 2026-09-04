import type { AnswerSegment } from '../features/chat/presentation/answerContent.ts';

export function extractAnswerText(segments: readonly AnswerSegment[]): string {
  return segments
    .filter((seg) => seg.kind === 'text' || (seg.kind === 'structured' && seg.toolMessageType === 'TEXT'))
    .map((seg) => {
      if (seg.kind === 'text') {
        return seg.content;
      }
      const content = (seg as { content: unknown }).content;
      return typeof content === 'string' ? content : '';
    })
    .join('')
    .trim();
}
