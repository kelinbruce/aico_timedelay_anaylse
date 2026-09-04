import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipBar } from './ChipBar.tsx';

describe('ChipBar tooltip scrollbar', () => {
  it('uses the shared transparent-track scrollbar style for long descriptions', async () => {
    render(
      <ChipBar
        items={[{ key: 'k1', label: 'Chip', tooltip: 'A\n'.repeat(100) }]}
        selectedKey={null}
        testIdPrefix="skill"
        allLabel="All"
        onSelect={vi.fn()}
        onOpenAll={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('skill-chip-k1').querySelector('button');
    expect(chip).not.toBeNull();
    await userEvent.hover(chip!);

    const tooltipContent = await screen.findByText(/A\s*A/);
    const scrollContainer = tooltipContent.closest('.skill-chip-description-scroll');
    expect(scrollContainer).not.toBeNull();
  });
});
