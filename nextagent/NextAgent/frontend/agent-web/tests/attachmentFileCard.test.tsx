// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentFileCard } from '../src/features/shared/components/AttachmentFileCard.tsx';
import { truncateFileNameMiddle } from '../src/features/shared/components/AttachmentFileCard.tsx';
import { formatFileSize } from '../src/features/shared/components/AttachmentFileCard.tsx';

afterEach(cleanup);

describe('truncateFileNameMiddle', () => {
  it('keeps short names unchanged', () => {
    expect(truncateFileNameMiddle('report.pdf', 104, 14)).toBe('report.pdf');
  });

  it('truncates the base name while keeping the extension', () => {
    const result = truncateFileNameMiddle('a-very-long-quarterly-network-report.pdf', 104, 14);
    expect(result.endsWith('...pdf')).toBe(true);
    expect(result.length).toBeLessThan('a-very-long-quarterly-network-report.pdf'.length);
  });

  it('truncates names without an extension with an ellipsis tail', () => {
    const result = truncateFileNameMiddle('README-LONG-LONG-LONG-NAME', 60, 14);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('formatFileSize', () => {
  it('formats megabytes with one decimal', () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats kilobytes and bytes', () => {
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(512)).toBe('512 B');
  });
});

describe('AttachmentFileCard', () => {
  it('renders file name, size and a pdf type icon', () => {
    render(<AttachmentFileCard fileName="report.pdf" sizeBytes={1024 * 1024} isDark={false} surface="composer" />);
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('1.0 MB')).toBeTruthy();
    expect(screen.getByTestId('file-type-icon-pdf')).toBeTruthy();
  });

  it('exposes the full file name on hover via title', () => {
    render(<AttachmentFileCard fileName="a-very-long-quarterly-network-report.xlsx" sizeBytes={100} isDark={false} surface="composer" />);
    const name = screen.getByTitle('a-very-long-quarterly-network-report.xlsx');
    expect(name.textContent?.endsWith('...xlsx')).toBe(true);
    expect(screen.getByTestId('file-type-icon-excel')).toBeTruthy();
  });

  it('falls back to a generic icon for uncommon types', () => {
    render(<AttachmentFileCard fileName="capture.pcap" sizeBytes={100} isDark={false} surface="composer" />);
    expect(screen.getByTestId('file-type-icon-generic')).toBeTruthy();
  });

  it('uses the light composer background and reveals remove on hover', () => {
    const onRemove = vi.fn();
    render(
      <AttachmentFileCard
        fileName="report.pdf"
        sizeBytes={100}
        isDark={false}
        surface="composer"
        testId="card"
        onRemove={onRemove}
        removeTestId="remove"
      />,
    );
    const card = screen.getByTestId('card');
    expect(card.style.background).toBe('rgba(25, 25, 25, 0.05)');
    const remove = screen.getByTestId('remove');
    expect(remove.style.opacity).toBe('0');
    fireEvent.mouseEnter(card);
    expect(remove.style.opacity).toBe('1');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('uses a white background for the conversation surface in light mode only', () => {
    const { rerender } = render(<AttachmentFileCard fileName="report.pdf" sizeBytes={100} isDark={false} surface="conversation" testId="card" />);
    expect(screen.getByTestId('card').style.background).toBe('rgb(255, 255, 255)');
    rerender(<AttachmentFileCard fileName="report.pdf" sizeBytes={100} isDark surface="conversation" testId="card" />);
    expect(screen.getByTestId('card').style.background).toBe('rgba(243, 243, 243, 0.2)');
  });

  it('applies dark theme text colors', () => {
    render(<AttachmentFileCard fileName="report.pdf" sizeBytes={100} isDark surface="composer" />);
    expect(screen.getByText('report.pdf').style.color).toBe('rgb(255, 255, 255)');
    expect(screen.getByText('100 B').style.color).toBe('rgb(201, 201, 201)');
  });
});
