import React, { Fragment, type ReactNode, useMemo } from 'react';
import { normalizeBrokenMarkdownTables } from '../features/chat/utils/markdownFormatting.ts';

interface MarkdownWithTablesProps {
  readonly content: string;
  readonly renderMarkdown: (content: string) => ReactNode;
  readonly renderInlineMarkdown?: ((content: string) => ReactNode) | undefined;
  readonly renderMermaid?: (content: string, stableKey: string) => ReactNode;
}

interface TableSegment {
  readonly key: string;
  readonly kind: 'table';
  readonly header: readonly string[];
  readonly alignments: readonly TableAlignment[];
  readonly rows: ReadonlyArray<readonly string[]>;
}

type TableAlignment = 'left' | 'center' | 'right' | null;

interface MarkdownSegment {
  readonly key: string;
  readonly kind: 'markdown';
  readonly content: string;
}

interface MermaidSegment {
  readonly key: string;
  readonly kind: 'mermaid';
  readonly content: string;
}

type MarkdownRenderableSegment = MarkdownSegment | TableSegment | MermaidSegment;

const MARKDOWN_TABLE_MIN_WIDTH_PX = 560;

function isTableLine(line: string): boolean {
  return splitTableCells(line).length >= 2;
}

function isDividerLine(line: string): boolean {
  const cells = splitTableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function parseDividerAlignment(cell: string): TableAlignment {
  const normalized = cell.trim();
  const startsWithColon = normalized.startsWith(':');
  const endsWithColon = normalized.endsWith(':');
  if (startsWithColon && endsWithColon) {
    return 'center';
  }
  if (endsWithColon) {
    return 'right';
  }
  if (startsWithColon) {
    return 'left';
  }
  return null;
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function stripOptionalEdgePipes(line: string): string {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|') && !isEscapedAt(trimmed, trimmed.length - 1)) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function unescapeTableCellPipes(cell: string): string {
  return cell.replace(/\\\|/g, '|');
}

function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let activeCodeFence: string | null = null;
  const normalized = stripOptionalEdgePipes(line);

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? '';

    if (character === '`' && !isEscapedAt(normalized, index)) {
      let tickEnd = index + 1;
      while (tickEnd < normalized.length && normalized[tickEnd] === '`') {
        tickEnd += 1;
      }
      const ticks = normalized.slice(index, tickEnd);
      if (activeCodeFence === ticks) {
        activeCodeFence = null;
      } else if (!activeCodeFence) {
        activeCodeFence = ticks;
      }
      current += ticks;
      index = tickEnd - 1;
      continue;
    }

    if (character === '|' && !activeCodeFence && !isEscapedAt(normalized, index)) {
      cells.push(unescapeTableCellPipes(current.trim()));
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(unescapeTableCellPipes(current.trim()));
  return cells;
}

function rebuildTableLine(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function splitMergedTableRows(cells: readonly string[], expectedColumnCount: number): ReadonlyArray<readonly string[]> | null {
  if (cells.length === expectedColumnCount) {
    return [cells];
  }

  if (cells.length < expectedColumnCount) {
    return null;
  }

  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.trim() !== '') {
      continue;
    }

    const left = cells.slice(0, index);
    const right = cells.slice(index + 1);
    if (left.length !== expectedColumnCount) {
      continue;
    }

    const remainingRows = splitMergedTableRows(right, expectedColumnCount);
    if (!remainingRows) {
      continue;
    }

    return [left, ...remainingRows];
  }

  return null;
}

function isMermaidFenceStart(line: string): boolean {
  return /^```mermaid\s*$/i.test(line.trim());
}

function readFenceMarker(line: string): '`' | '~' | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) {
    return '`';
  }
  if (trimmed.startsWith('~~~')) {
    return '~';
  }
  return null;
}

function isFenceEnd(line: string, marker: '`' | '~' = '`'): boolean {
  const pattern = marker === '`' ? /^```\s*$/ : /^~~~\s*$/;
  return pattern.test(line.trim());
}

function hashSegmentSignature(signature: string): string {
  let hash = 5381;
  for (let index = 0; index < signature.length; index += 1) {
    hash = ((hash << 5) + hash) ^ signature.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function createStableSegmentKey(kind: MarkdownRenderableSegment['kind'], signature: string, seenCounts: Map<string, number>): string {
  const hashed = `${kind}:${hashSegmentSignature(signature)}`;
  const seen = seenCounts.get(hashed) ?? 0;
  seenCounts.set(hashed, seen + 1);
  return `${hashed}:${seen}`;
}

function stripMermaidFence(content: string): string {
  const lines = content.split('\n');
  if (lines.length >= 2 && isMermaidFenceStart(lines[0] ?? '') && isFenceEnd(lines[lines.length - 1] ?? '')) {
    return lines.slice(1, -1).join('\n').trim();
  }
  return content.trim();
}

function downgradeUnclosedMermaidFence(lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  const [firstLine, ...rest] = lines;
  return [(firstLine ?? '').replace(/^```mermaid\b/i, '```text'), ...rest];
}

function createTableSegment(
  header: readonly string[],
  alignments: readonly TableAlignment[],
  rows: ReadonlyArray<readonly string[]>,
  stableKeyCounts: Map<string, number>,
): TableSegment {
  const signature = `${header.join('\u001f')}::${alignments.map((alignment) => alignment ?? 'start').join('\u001f')}::${rows
    .map((row) => row.join('\u001f'))
    .join('\u001e')}`;
  return {
    key: createStableSegmentKey('table', signature, stableKeyCounts),
    kind: 'table',
    header,
    alignments,
    rows,
  };
}

function parseMarkdownSegments(content: string): MarkdownRenderableSegment[] {
  const lines = normalizeBrokenMarkdownTables(content).split('\n');
  const segments: MarkdownRenderableSegment[] = [];
  let markdownBuffer: string[] = [];
  const stableKeyCounts = new Map<string, number>();

  const flushMarkdown = () => {
    const joined = markdownBuffer.join('\n').trim();
    if (joined.length > 0) {
      segments.push({
        key: createStableSegmentKey('markdown', joined, stableKeyCounts),
        kind: 'markdown',
        content: joined,
      });
    }
    markdownBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] ?? '';
    const nextLine = lines[index + 1] ?? '';

    if (isMermaidFenceStart(currentLine)) {
      flushMarkdown();

      const mermaidLines = [currentLine];
      let foundFenceEnd = false;
      index += 1;
      while (index < lines.length) {
        const line = lines[index] ?? '';
        mermaidLines.push(line);
        if (isFenceEnd(line)) {
          foundFenceEnd = true;
          break;
        }
        index += 1;
      }

      if (!foundFenceEnd) {
        markdownBuffer.push(...downgradeUnclosedMermaidFence(mermaidLines));
        continue;
      }

      const mermaidContent = mermaidLines.join('\n').trim();
      segments.push({
        key: createStableSegmentKey('mermaid', mermaidContent, stableKeyCounts),
        kind: 'mermaid',
        content: mermaidContent,
      });
      continue;
    }

    const fenceMarker = readFenceMarker(currentLine);
    if (fenceMarker) {
      const fenceLines = [currentLine];
      index += 1;
      while (index < lines.length) {
        const line = lines[index] ?? '';
        fenceLines.push(line);
        if (isFenceEnd(line, fenceMarker)) {
          break;
        }
        index += 1;
      }
      markdownBuffer.push(...fenceLines);
      continue;
    }

    if (isTableLine(currentLine) && isDividerLine(nextLine)) {
      flushMarkdown();

      const header = splitTableCells(currentLine);
      const alignments = splitTableCells(nextLine).map(parseDividerAlignment);
      const rows: string[][] = [];
      const expectedColumnCount = header.length;
      index += 2;

      while (index < lines.length && isTableLine(lines[index] ?? '')) {
        const rowLine = lines[index] ?? '';
        const rowCells = splitTableCells(rowLine);
        const repairedRows = rowCells.length === expectedColumnCount ? [rowCells] : splitMergedTableRows(rowCells, expectedColumnCount);

        if (repairedRows) {
          rows.push(...repairedRows.map((cells) => [...cells]));
        } else {
          rows.push(splitTableCells(rebuildTableLine(rowCells)));
        }
        index += 1;
      }

      segments.push(createTableSegment(header, alignments, rows, stableKeyCounts));
      index -= 1;
      continue;
    }

    const previousSegment = segments[segments.length - 1];
    if (isTableLine(currentLine) && previousSegment?.kind === 'table' && markdownBuffer.every(isBlankLine)) {
      const appendedRows: string[][] = [];
      const expectedColumnCount = previousSegment.header.length;

      while (index < lines.length && isTableLine(lines[index] ?? '')) {
        const rowLine = lines[index] ?? '';
        const rowCells = splitTableCells(rowLine);
        const repairedRows = rowCells.length === expectedColumnCount ? [rowCells] : splitMergedTableRows(rowCells, expectedColumnCount);

        if (!repairedRows) {
          break;
        }

        appendedRows.push(...repairedRows.map((cells) => [...cells]));
        index += 1;
      }

      if (appendedRows.length > 0) {
        markdownBuffer = [];
        segments[segments.length - 1] = createTableSegment(
          previousSegment.header,
          previousSegment.alignments,
          [...previousSegment.rows, ...appendedRows],
          stableKeyCounts,
        );
        index -= 1;
        continue;
      }
    }

    markdownBuffer.push(currentLine);
  }

  flushMarkdown();
  return segments;
}

function TableBlock({
  header,
  alignments,
  rows,
  renderInlineMarkdown,
}: {
  readonly header: readonly string[];
  readonly alignments: readonly TableAlignment[];
  readonly rows: ReadonlyArray<readonly string[]>;
  readonly renderInlineMarkdown?: ((content: string) => ReactNode) | undefined;
}) {
  const renderCellContent = (cell: string) => renderInlineMarkdown?.(cell) ?? cell;

  return (
    <div
      className="markdown-table-scroll nextagent-themed-scrollbar"
      style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, marginBottom: 16, boxSizing: 'border-box' }}
    >
      <table
        style={{
          width: 'max-content',
          minWidth: `max(100%, ${MARKDOWN_TABLE_MIN_WIDTH_PX}px)`,
          borderCollapse: 'collapse',
          lineHeight: 1.5,
          marginBottom: 0,
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            {header.map((cell, index) => (
              <th
                key={`header-${index}`}
                style={{
                  textAlign: alignments[index] ?? 'start',
                  padding: '8px 10px',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  whiteSpace: 'nowrap',
                  overflowWrap: 'normal',
                  wordBreak: 'normal',
                }}
              >
                {renderCellContent(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`cell-${rowIndex}-${cellIndex}`}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--color-border)',
                    textAlign: alignments[cellIndex] ?? 'start',
                    whiteSpace: alignments[cellIndex] === 'right' || alignments[cellIndex] === 'center' ? 'nowrap' : 'normal',
                    overflowWrap: 'normal',
                    wordBreak: 'normal',
                  }}
                >
                  {renderCellContent(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownWithTables({ content, renderMarkdown, renderInlineMarkdown, renderMermaid }: MarkdownWithTablesProps) {
  const segments = useMemo(() => parseMarkdownSegments(content), [content]);

  return segments.map((segment) => (
    <Fragment key={segment.key}>
      {segment.kind === 'markdown' ? (
        renderMarkdown(segment.content)
      ) : segment.kind === 'mermaid' ? (
        renderMermaid ? (
          renderMermaid(stripMermaidFence(segment.content), segment.key)
        ) : (
          renderMarkdown(segment.content)
        )
      ) : (
        <TableBlock header={segment.header} alignments={segment.alignments} rows={segment.rows} renderInlineMarkdown={renderInlineMarkdown} />
      )}
    </Fragment>
  ));
}
