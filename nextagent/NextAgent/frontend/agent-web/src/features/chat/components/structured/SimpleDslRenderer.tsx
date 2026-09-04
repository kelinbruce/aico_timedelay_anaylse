import { DSLEngine } from '@cloudsop/dsl-engine-web';

interface SimpleDslRendererProps {
  readonly content: unknown;
}

export function SimpleDslRenderer({ content }: SimpleDslRendererProps) {
  return (
    <div data-testid="structured-dsl-renderer">
      <DSLEngine data={[content]} />
    </div>
  );
}
