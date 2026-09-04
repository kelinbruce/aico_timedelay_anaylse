import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { MessageInput } from '../src/features/composer/components/MessageInput';
import { renderWithAppProviders } from './renderWithAppProviders.tsx';

afterEach(cleanup);

describe('MessageInput Edit Mode', () => {
  it('shows normal send button by default', () => {
    renderWithAppProviders(<MessageInput onSend={async () => {}} mode="normal" />);
    expect(screen.getByTestId('btn-send')).toBeTruthy();
    expect(screen.queryByTestId('btn-cancel-edit')).toBeNull();
  });

  it('shows cancel and confirm buttons in edit mode', () => {
    renderWithAppProviders(<MessageInput onSend={async () => {}} mode="edit" initialInput="Edited text" onCancelEdit={() => {}} />);
    expect(screen.getByTestId('btn-cancel-edit')).toBeTruthy();
    expect(screen.getByTestId('btn-confirm-edit')).toBeTruthy();
    expect(screen.getByDisplayValue('Edited text')).toBeTruthy();
  });

  it('calls onCancelEdit when cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithAppProviders(<MessageInput onSend={async () => {}} mode="edit" initialInput="Test" onCancelEdit={onCancel} />);
    fireEvent.click(screen.getByTestId('btn-cancel-edit'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('applies edit styling when in edit mode', () => {
    const { container } = renderWithAppProviders(<MessageInput onSend={async () => {}} mode="edit" initialInput="Test" onCancelEdit={() => {}} />);
    const input = container.querySelector('textarea');
    expect(input).toBeTruthy();
    expect(input?.closest('[data-mode="edit"]')).toBeTruthy();
  });
});
