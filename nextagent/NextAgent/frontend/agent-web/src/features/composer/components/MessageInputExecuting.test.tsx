import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

describe('MessageInput executing state', () => {
  it('blocks Enter-key submission while isExecuting is true', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<MessageInput onSend={onSend} isExecuting onStop={onStop} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends on Enter when isExecuting is false', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('shows stop button instead of send button while isExecuting', () => {
    const onStop = vi.fn();
    render(<MessageInput onSend={vi.fn()} isExecuting onStop={onStop} />);

    expect(screen.getByTestId('btn-stop')).toBeTruthy();
    expect(screen.queryByTestId('btn-send')).toBeNull();
  });
});

describe('MessageInput capability directive preflight', () => {
  it('blocks submission of a bare $skill: directive with no question text', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '$skill:bom-test-skill' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('blocks submission of a bare $workflow: directive with no question text', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '$workflow:push-gate' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends when a directive carries an effective user question', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '$skill:bom-test-skill 帮我分析掉话' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('$skill:bom-test-skill 帮我分析掉话');
  });
});
