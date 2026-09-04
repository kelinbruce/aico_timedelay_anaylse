import type { AnswerSegment } from './answerContent.ts';

/**
 * Builds the `alog_card` payload for complaint submission:
 * `[Q]${question}\n[A]${textAnswers}` where textAnswers joins all Text-type
 * answer segments with `\n`. Non-Text segments are filtered out. When no Text
 * segment exists the `[A]` section is an empty string.
 */
export function buildComplaintAlogCard(question: string, segments: readonly AnswerSegment[], fallbackText?: string): string {
  const texts = segments
    .filter((seg) => seg.kind === 'text' || (seg.kind === 'structured' && seg.toolMessageType === 'TEXT'))
    .map((seg) => {
      if (seg.kind === 'text') {
        return seg.content;
      }
      return typeof seg.content === 'string' ? seg.content : '';
    })
    .filter((text) => text.length > 0);
  const answerText = texts.length > 0 ? texts.join('\n') : (fallbackText ?? '');
  return `[Q]${question}\n[A]${answerText}`;
}
