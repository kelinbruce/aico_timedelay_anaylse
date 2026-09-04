const INLINE_MARKDOWN_BLOCK_BOUNDARY_RE =
  /((?:[\u3002\uFF01\uFF1F\uFF1B\uFF1A!?;:]|\.(?!\d+\.[A-Za-z0-9_-])))([ \t]*)(?=(?:#{1,6}\s|>\s|(?:[-*+](?:\s|(?=[\u4E00-\u9FFFA-Za-z])))|\d+\.(?:\s|(?=\*\*|__|`|[\u4E00-\u9FFFA-Za-z]))|```|~~~|\|))/g;
const HEADING_WITHOUT_SPACE_RE = /(^|\n)(#{1,6})(?=[^\s#])/g;
const ORDERED_LIST_START_RE = /^(\s*)(\d+)[.)、]\s*/;
// Preceding char must be non-whitespace AND not an ASCII word char so that
// identifiers like SMF_001、AMF_002 are not mistaken for inline list markers.
const INLINE_ORDERED_LIST_ITEM_RE = /([^\sA-Za-z0-9_])(\d+)[.)、]\s*(?=(?:\*\*|__|`|[\u4E00-\u9FFFA-Za-z]))/g;
const TRAILING_THEMATIC_BREAK_RE = /([^\s-])---$/;
const GLUED_THEMATIC_HEADING_RE = /(^|\|)---(?=#{1,6})/g;
const INLINE_GLUED_THEMATIC_HEADING_RE = /([^\s|])---(?=#{1,6})/g;
const CJK_GLUED_BULLET_RE = /([\u4E00-\u9FFF])([-*+])(?=[\u4E00-\u9FFFA-Za-z])/g;
const BOLD_INTERIOR_WHITESPACE_RE = /\*\*[ \t]*((?:[^*\n][\s\S]*?[^*\n]|[*\n]))[ \t]*\*\*/g;
const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FENCE_LANGUAGES = [
  'typescript',
  'javascript',
  'powershell',
  'mermaid',
  'python',
  'shell',
  'yaml',
  'bash',
  'json',
  'text',
  'diff',
  'java',
  'tsx',
  'jsx',
  'xml',
  'sql',
  'sh',
  'ts',
  'js',
  'py',
] as const;

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

function splitPipeTableCells(line: string): string[] {
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
      activeCodeFence = activeCodeFence === ticks ? null : activeCodeFence ? activeCodeFence : ticks;
      current += ticks;
      index = tickEnd - 1;
      continue;
    }

    if (character === '|' && !activeCodeFence && !isEscapedAt(normalized, index)) {
      cells.push(current.trim().replace(/\\\|/g, '|'));
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current.trim().replace(/\\\|/g, '|'));
  return cells;
}

function rebuildPipeTableLine(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function isDividerCell(cell: string): boolean {
  return /^:?-{2,}:?$/.test(cell.trim());
}

function expandFlattenedPipeTableLine(line: string): string[] | null {
  const cells = splitPipeTableCells(line);
  const rows: string[][] = [];
  let currentRow: string[] = [];

  for (const cell of cells) {
    if (cell.trim().length === 0) {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      continue;
    }
    currentRow.push(cell);
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  const [header, divider, ...bodyRows] = rows;
  if (!header || !divider || bodyRows.length === 0) {
    return null;
  }

  const columnCount = header.length;
  if (columnCount < 2 || divider.length !== columnCount || !divider.every(isDividerCell) || bodyRows.some((row) => row.length !== columnCount)) {
    return null;
  }

  return [header, divider, ...bodyRows].map(rebuildPipeTableLine);
}

function parseCompactToolRow(segment: string): readonly [string, string] | null {
  const normalized = segment.trim().replace(/^\|+/, '').replace(/\|+$/, '');
  const separatorIndex = normalized.indexOf('|');
  if (separatorIndex <= 0) {
    return null;
  }

  const tool = normalized.slice(0, separatorIndex).trim();
  const description = normalized.slice(separatorIndex + 1).trim();
  if (!/^`[^`]+`$/.test(tool) || description.length === 0) {
    return null;
  }
  return [tool, description];
}

function expandCompactToolListLine(line: string): string[] | null {
  const firstRowSeparator = line.indexOf('||');
  if (firstRowSeparator < 0) {
    return null;
  }

  const prefix = line.slice(0, firstRowSeparator).trimEnd();
  const rest = line.slice(firstRowSeparator + 2);
  const thematicMatch = /\|?---(?=#{1,6})/.exec(rest);
  const rowSource = thematicMatch?.index === undefined ? rest : rest.slice(0, thematicMatch.index);
  const tail = thematicMatch?.index === undefined ? '' : `---${rest.slice(thematicMatch.index + thematicMatch[0].length)}`;

  const rowSegments = rowSource
    .split('||')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (rowSegments.length === 0) {
    return null;
  }

  const rows = rowSegments.map(parseCompactToolRow);
  if (rows.some((row) => row === null)) {
    return null;
  }

  const expanded: string[] = [];
  if (prefix.trim().length > 0) {
    expanded.push(prefix, '');
  }
  expanded.push('| 工具 | 描述 |', '| --- | --- |');
  for (const row of rows) {
    if (!row) {
      continue;
    }
    const [tool, description] = row;
    expanded.push(`| ${tool} | ${description} |`);
  }
  if (tail.trim().length > 0) {
    expanded.push('', tail.trimStart());
  }
  return expanded;
}

function normalizeOutsideFenceLine(line: string): string {
  let normalized = line
    .replace(GLUED_THEMATIC_HEADING_RE, (_match, boundary: string) => (boundary === '|' ? '\n\n---\n\n' : '---\n\n'))
    .replace(INLINE_GLUED_THEMATIC_HEADING_RE, '$1\n\n---\n\n')
    .replace(HEADING_WITHOUT_SPACE_RE, '$1$2 ')
    .replace(CJK_GLUED_BULLET_RE, '$1\n\n$2 ');
  const startsAsOrderedList = ORDERED_LIST_START_RE.test(normalized);

  if (startsAsOrderedList) {
    normalized = normalized.replace(ORDERED_LIST_START_RE, '$1$2. ');
    normalized = normalized.replace(INLINE_ORDERED_LIST_ITEM_RE, '$1\n\n$2. ');
  }

  return (
    normalized
      .replace(TRAILING_THEMATIC_BREAK_RE, '$1\n\n---')
      .replace(INLINE_MARKDOWN_BLOCK_BOUNDARY_RE, '$1\n\n')
      // CommonMark requires no whitespace between `**` and the bolded text; strip
      // only the interior leading/trailing space so LLM output like `** xx**`
      // or `**中文 **` still renders as bold instead of being left as literal `**`.
      .replace(BOLD_INTERIOR_WHITESPACE_RE, '**$1**')
  );
}

function splitGluedFenceOpening(line: string): { readonly lines: string[]; readonly fence: string } | null {
  const match = FENCE_OPEN_RE.exec(line);
  if (!match) {
    return null;
  }

  const [, indent = '', fence = '', info = ''] = match;
  const trimmedInfo = info.trimEnd();

  if (trimmedInfo.length === 0 || /^\s/.test(trimmedInfo)) {
    return { lines: [line], fence };
  }

  const lowerInfo = trimmedInfo.toLowerCase();
  for (const language of FENCE_LANGUAGES) {
    if (!lowerInfo.startsWith(language)) {
      continue;
    }
    const gluedContent = trimmedInfo.slice(language.length);
    if (gluedContent.length === 0 || /^\s/.test(gluedContent)) {
      return { lines: [line], fence };
    }
    return { lines: [`${indent}${fence}${language}`, gluedContent], fence };
  }

  return { lines: [line], fence };
}

export function normalizeMarkdownBlockSpacing(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const normalizedLines: string[] = [];
  let inFence = false;
  let activeFence: string | null = null;

  for (const line of lines) {
    if (!inFence) {
      const fenceOpening = splitGluedFenceOpening(line);
      if (fenceOpening) {
        normalizedLines.push(...fenceOpening.lines);
        inFence = true;
        activeFence = fenceOpening.fence;
        continue;
      }

      const expandedLines = expandCompactToolListLine(line) ?? [line];
      for (const expandedLine of expandedLines) {
        const expandedTrimmed = expandedLine.trim();
        if (expandedTrimmed.startsWith('|')) {
          normalizedLines.push(expandedLine);
          continue;
        }

        normalizedLines.push(normalizeOutsideFenceLine(expandedLine));
      }
      continue;
    }

    const fence = activeFence ?? '';
    const fenceIndex = fence.length > 0 ? line.indexOf(fence) : -1;
    if (fenceIndex >= 0 && line.slice(fenceIndex).trim() === fence) {
      const codeBeforeFence = line.slice(0, fenceIndex).trimEnd();
      if (codeBeforeFence.length > 0) {
        normalizedLines.push(codeBeforeFence);
      }
      normalizedLines.push(fence);
      inFence = false;
      activeFence = null;
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join('\n');
}

export function normalizeBrokenMarkdownTables(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const normalizedLines: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] ?? '';
    const trimmed = currentLine.trim();

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      normalizedLines.push(currentLine);
      continue;
    }

    if (inFence) {
      normalizedLines.push(currentLine);
      continue;
    }

    if (trimmed.startsWith('|')) {
      const flattenedTableLines = expandFlattenedPipeTableLine(trimmed);
      if (flattenedTableLines) {
        normalizedLines.push(...flattenedTableLines);
        continue;
      }
    }

    const nextLine = lines[index + 1] ?? '';
    const nextTrimmed = nextLine.trim();

    if (trimmed.startsWith('|') && !trimmed.endsWith('|') && nextTrimmed === '|') {
      normalizedLines.push(`${trimmed} |`);
      index += 1;
      continue;
    }

    if (trimmed === '|' && nextTrimmed.includes('|')) {
      const mergedNextLine = nextTrimmed.startsWith('|') ? nextTrimmed : `| ${nextTrimmed}`;
      normalizedLines.push(mergedNextLine);
      index += 1;
      continue;
    }

    normalizedLines.push(currentLine);
  }

  return normalizedLines.join('\n');
}
