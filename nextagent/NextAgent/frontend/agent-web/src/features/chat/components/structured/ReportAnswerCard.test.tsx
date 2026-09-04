import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@cloudsop/dsl-engine-web', () => ({
  DSLEngine: (props: { data?: readonly unknown[] }) => <div data-testid="mock-dsl-engine">{JSON.stringify(props.data)}</div>,
}));

import { ReportAnswerCard } from './ReportAnswerCard.tsx';

function renderCard(content: unknown) {
  return render(<ReportAnswerCard content={content} />);
}

describe('ReportAnswerCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders DSLEngine directly with content as array', () => {
    const reportContent = { type: 'report' };
    const { getByTestId } = renderCard(reportContent);
    const engineEl = getByTestId('mock-dsl-engine');
    expect(engineEl.textContent).toBe(JSON.stringify([reportContent]));
  });
});
