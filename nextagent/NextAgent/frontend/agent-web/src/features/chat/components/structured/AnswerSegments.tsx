import type { AnswerSegment } from '../../presentation/answerContent.ts';
import { readPiuContentUuid } from '../../presentation/answerContent.ts';
import { MarkdownContent } from '../MarkdownContent.tsx';
import { FileCard } from './FileCard.tsx';
import { ActionCard } from './ActionCard.tsx';
import { OperatorButtons } from './OperatorButtons.tsx';
import { SimpleDslRenderer } from './SimpleDslRenderer.tsx';
import { StreamDslAnswerCard } from './StreamDslAnswerCard.tsx';
import { PiuMessage, parsePiuContent } from './PiuMessage.tsx';

interface AnswerSegmentsProps {
  readonly segments: readonly AnswerSegment[];
  readonly sessionId?: string;
}

export function AnswerSegments({ segments, sessionId }: AnswerSegmentsProps) {
  const lastPiuIndexByUuid = new Map<string, number>();
  const piuContentsByUuid = new Map<string, readonly unknown[]>();
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment || segment.kind !== 'structured' || segment.toolMessageType !== 'PIU') {
      continue;
    }
    const uuid = readPiuContentUuid(segment.content);
    if (uuid === null) {
      continue;
    }
    lastPiuIndexByUuid.set(uuid, i);
    const list = piuContentsByUuid.get(uuid);
    if (list === undefined) {
      piuContentsByUuid.set(uuid, [segment.content]);
    } else {
      piuContentsByUuid.set(uuid, [...list, segment.content]);
    }
  }

  return (
    <div data-testid="answer-segments">
      {segments.map((segment, index) => {
        const piuUuid = segment.kind === 'structured' && segment.toolMessageType === 'PIU' ? readPiuContentUuid(segment.content) : null;
        const key =
          segment.kind === 'text'
            ? `text-${segment.sequence}`
            : piuUuid !== null
              ? `structured-PIU-uuid-${piuUuid}`
              : `structured-${segment.toolMessageType}-${segment.sequence}`;
        if (segment.kind === 'text') {
          return <MarkdownContent key={key} content={segment.content} />;
        }
        switch (segment.toolMessageType) {
          case 'TEXT':
            return <MarkdownContent key={key} content={typeof segment.content === 'string' ? segment.content : JSON.stringify(segment.content)} />;
          case 'FILE':
            return (
              <FileCard
                key={key}
                content={typeof segment.content === 'string' ? segment.content : String(segment.content ?? '')}
                {...(sessionId === undefined ? {} : { sessionId })}
              />
            );
          case 'ACTION':
            return <ActionCard key={key} content={typeof segment.content === 'string' ? segment.content : JSON.stringify(segment.content)} />;
          case 'OPERATOR':
            return <OperatorButtons key={key} content={typeof segment.content === 'string' ? segment.content : JSON.stringify(segment.content)} />;
          case 'DSL':
            return <SimpleDslRenderer key={key} content={segment.content} />;
          case 'STREAM_DSL': {
            const streamDsl = segment.content as { readonly dataModel: unknown; readonly dsl: string; readonly isDone: boolean };
            return <StreamDslAnswerCard key={key} dataModel={streamDsl.dataModel} dsl={streamDsl.dsl} isDone={streamDsl.isDone} />;
          }
          case 'PIU': {
            if (piuUuid !== null) {
              if (lastPiuIndexByUuid.get(piuUuid) !== index) {
                return null;
              }
              const allContents = piuContentsByUuid.get(piuUuid) ?? [segment.content];
              return (
                <PiuMessage
                  key={key}
                  content={parsePiuContent(segment.content)}
                  pendingContents={allContents.map(parsePiuContent)}
                  isHistory={segment.isHistory === true}
                />
              );
            }
            return <PiuMessage key={key} content={parsePiuContent(segment.content)} isHistory={segment.isHistory === true} />;
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
