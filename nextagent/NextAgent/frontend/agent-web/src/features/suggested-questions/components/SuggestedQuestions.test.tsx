import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { SuggestedQuestions } from './SuggestedQuestions.tsx';

// Mock apiClient so the component's fetch calls are controllable in jsdom.
const mockPost = vi.fn();
vi.mock('../../../services/apiClient.ts', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const SESSION_ID = 'session-1';
const REQUEST_ID = 'request-1';

beforeEach(() => {
  mockPost.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SuggestedQuestions', () => {
  it('renders 3 question items when API returns 3 questions', async () => {
    mockPost.mockResolvedValueOnce({ questions: ['问题1', '问题2', '问题3'] });
    render(<SuggestedQuestions sessionId={SESSION_ID} requestId={REQUEST_ID} onQuestionClick={vi.fn()} />);

    await waitFor(() => {
      const items = screen.getAllByTestId('suggested-question-item');
      expect(items).toHaveLength(3);
    });

    expect(screen.getByText('问题1')).toBeTruthy();
    expect(screen.getByText('问题2')).toBeTruthy();
    expect(screen.getByText('问题3')).toBeTruthy();
  });

  it('shows loading state and does not render question items during request', async () => {
    let resolvePost: (value: { questions: string[] }) => void = () => {};
    mockPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    render(<SuggestedQuestions sessionId={SESSION_ID} requestId={REQUEST_ID} onQuestionClick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('suggested-questions-loading')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('suggested-question-item')).toHaveLength(0);

    // Resolve to avoid unhandled promise warning.
    resolvePost({ questions: [] });
  });

  it('calls onQuestionClick with question text when a question is clicked', async () => {
    const onQuestionClick = vi.fn();
    mockPost.mockResolvedValueOnce({ questions: ['点击我'] });

    render(<SuggestedQuestions sessionId={SESSION_ID} requestId={REQUEST_ID} onQuestionClick={onQuestionClick} />);

    await waitFor(() => {
      expect(screen.getByTestId('suggested-question-item')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('点击我'));
    expect(onQuestionClick).toHaveBeenCalledTimes(1);
    expect(onQuestionClick).toHaveBeenCalledWith('点击我');
  });

  it('renders nothing when API returns empty questions array', async () => {
    mockPost.mockResolvedValueOnce({ questions: [] });

    render(<SuggestedQuestions sessionId={SESSION_ID} requestId={REQUEST_ID} onQuestionClick={vi.fn()} />);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    // Wait a tick for state to settle after promise resolves.
    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
  });

  it('renders nothing and does not throw when API call fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('network error'));

    render(<SuggestedQuestions sessionId={SESSION_ID} requestId={REQUEST_ID} onQuestionClick={vi.fn()} />);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('suggested-questions')).toBeNull();
      expect(screen.queryByTestId('suggested-questions-loading')).toBeNull();
    });
  });

  it('calls the correct API endpoint with sessionId and requestId', async () => {
    mockPost.mockResolvedValueOnce({ questions: ['q1'] });

    render(<SuggestedQuestions sessionId={SESSION_ID} requestId={REQUEST_ID} onQuestionClick={vi.fn()} />);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockPost.mock.calls[0]!;
    expect(callArgs[0]).toBe(`/api/v1/sessions/${SESSION_ID}/requests/${REQUEST_ID}/suggested-questions`);
  });
});
