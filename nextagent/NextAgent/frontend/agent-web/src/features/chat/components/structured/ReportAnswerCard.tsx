import { DSLEngine } from '@cloudsop/dsl-engine-web';

interface ReportAnswerCardProps {
  readonly content: unknown;
}

export function ReportAnswerCard({ content }: ReportAnswerCardProps) {
  return (
    <div data-testid="report-answer-card">
      <DSLEngine data={[content]} />
    </div>
  );
}
