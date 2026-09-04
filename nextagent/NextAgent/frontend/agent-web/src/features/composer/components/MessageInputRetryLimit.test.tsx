import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MessageInput } from './MessageInput.tsx';

const mockGet = vi.fn();
vi.mock('../../../services/apiClient.ts', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
  },
}));

vi.mock('../../../services/skillCatalogService.ts', () => ({
  querySkills: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  useAppHostContext: () => ({ site: { locale: 'zh-CN' } }),
}));

vi.mock('../../auth/useUserOps.ts', () => ({
  useUserOps: () => null,
}));

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../auth/AuthWrapper.tsx', () => ({
  AuthWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../state/skillSelectionStore.ts', () => ({
  useSkillSelectionStore: () => null,
}));

vi.mock('../../../state/categorySelectionStore.ts', () => ({
  useCategorySelectionStore: () => null,
}));

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('MessageInput retry latest limit', () => {
  it('keeps the retry button enabled and triggers onRetryLatest when the limit is not reached', () => {
    const onRetryLatest = vi.fn();
    render(<MessageInput onSend={vi.fn()} showRetryLatestButton onRetryLatest={onRetryLatest} />);

    const button = screen.getByTestId('btn-retry-latest') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(onRetryLatest).toHaveBeenCalledTimes(1);
  });

  it('disables the retry button with the limit tooltip and blocks retry when the limit is reached', async () => {
    const onRetryLatest = vi.fn();
    render(<MessageInput onSend={vi.fn()} showRetryLatestButton onRetryLatest={onRetryLatest} retryLatestDisabled />);

    const button = screen.getByTestId('btn-retry-latest') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onRetryLatest).not.toHaveBeenCalled();

    fireEvent.mouseOver(button.parentElement!);
    await waitFor(() => {
      expect(screen.getByText('当前系统仅支持最多5次的重试')).toBeTruthy();
    });
  });
});
