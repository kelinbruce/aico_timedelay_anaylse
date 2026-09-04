import { DSLRenderer } from '@cloudsop/dsl-engine-web/genui-components';

interface StreamDslAnswerCardProps {
  readonly dataModel: unknown;
  readonly dsl: string;
  readonly isDone: boolean;
}

export function StreamDslAnswerCard({ dataModel, dsl, isDone }: StreamDslAnswerCardProps) {
  return (
    <div data-testid="stream-dsl-answer-card">
      <DSLRenderer dataModel={dataModel} response={dsl} isStreaming={!isDone} />
    </div>
  );
}
