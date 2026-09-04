import { existsSync, readFileSync } from 'node:fs';

export function validatePiuClosedRuntimeAssetSet({ piuJs, piuCss }) {
  const failures = [];

  if (existsSync(piuJs)) {
    const piuJsSource = readFileSync(piuJs, 'utf8');
    const executableJsSource = stripJsStringsAndComments(piuJsSource);
    if (/(^|[^\w$.])import\s*\(/u.test(executableJsSource)) {
      failures.push('AIAgentPIU.js must not reference extra JavaScript chunks through dynamic import.');
    }
    if (referencesScriptInjectedAsset(piuJsSource)) {
      failures.push('AIAgentPIU.js must not inject additional script assets.');
    }
    if (/\bmanifest\.json\b/u.test(piuJsSource)) {
      failures.push('AIAgentPIU.js must not reference a runtime asset manifest.');
    }
  }

  if (existsSync(piuCss)) {
    const piuCssSource = readFileSync(piuCss, 'utf8');
    if (/@import\b/iu.test(piuCssSource)) {
      failures.push('AIAgentPIU.css must not import additional stylesheets.');
    }
  }

  return failures;
}

function referencesScriptInjectedAsset(source) {
  const scriptElementPattern = /\bcreateElement\s*\(\s*["']script["']\s*\)/gu;
  for (const match of source.matchAll(scriptElementPattern)) {
    const followingSource = source.slice(match.index, match.index + 600);
    if (/\.(?:src)\s*=|\.setAttribute\s*\(\s*["']src["']/u.test(followingSource)) {
      return true;
    }
  }
  return false;
}

export function assertPiuClosedRuntimeAssetSet(files) {
  const failures = validatePiuClosedRuntimeAssetSet(files);
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

function stripJsStringsAndComments(source) {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length) {
        if (source[index] === '\n') {
          output += '\n';
          index += 1;
          continue;
        }
        if (source[index] === '*' && source[index + 1] === '/') {
          output += '  ';
          index += 2;
          break;
        }
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      output += ' ';
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === '\\') {
          output += ' ';
          index += 1;
          if (index < source.length) {
            output += source[index] === '\n' ? '\n' : ' ';
            index += 1;
          }
          continue;
        }
        output += current === '\n' ? '\n' : ' ';
        index += 1;
        if (current === quote) {
          break;
        }
      }
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}
