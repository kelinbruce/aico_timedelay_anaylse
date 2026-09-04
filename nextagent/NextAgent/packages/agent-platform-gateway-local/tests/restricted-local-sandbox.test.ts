import { createRestrictedLocalSandboxGateway } from '@nextagent/agent-platform-gateway-local';
import { brand } from '@nextagent/agent-common';
import type { SandboxFilesystemLayout } from '@nextagent/agent-contracts/gateway';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hostPython = resolveHostPython();
const pythonIt = hostPython === undefined ? it.skip : it;
const copiedNodeExecutableIt = process.platform === 'darwin' ? it.skip : it;
const builtinExecutableIt = process.platform === 'win32' || process.platform === 'linux' ? it : it.skip;
const windowsIt = process.platform === 'win32' ? it : it.skip;
const posixIt = process.platform === 'win32' ? it.skip : it;
const posixPythonIt = process.platform === 'win32' || hostPython === undefined ? it.skip : it;

describe('restricted local sandbox gateway', () => {
  it('allows only one final curl URL under a trusted API prefix', async () => {
    const gateway = createRestrictedLocalSandboxGateway({
      allowedApis: ['https://api.example.internal/v1/'],
      executableOverrides: { curl: process.execPath },
    });

    const accepted = await gateway.execute(
      request({ executable: 'bash', command: 'curl', args: ['--silent', 'https://api.example.internal/v1/items'] }),
    );
    expect(accepted.safeError).toBeUndefined();

    for (const args of [
      ['https://api.example.internal.evil.test/v1/items'],
      ['http://api.example.internal/v1/items'],
      ['https://api.example.internal:444/v1/items'],
      ['https://api.example.internal/v2/items'],
      ['https://api.example.internal/v1/{one,two}'],
      ['https://api.example.internal/v1/items', 'https://api.example.internal/v1/other'],
      ['not-a-url'],
    ]) {
      const rejected = await gateway.execute(request({ executable: 'bash', command: 'curl', args }));
      expect(rejected.safeError).toMatchObject({
        code: 'BASH_EXECUTION_REJECTED',
        safeDetails: { reason: 'network-target-not-allowed' },
      });
    }
  });

  it('rejects every curl option that can redirect or obscure the target', async () => {
    const gateway = createRestrictedLocalSandboxGateway({
      allowedApis: ['https://api.example.internal/v1/'],
      executableOverrides: { curl: process.execPath },
    });
    const forbiddenOptions = [
      '--url',
      '--config',
      '-K',
      '--proxy',
      '-x',
      '--preproxy',
      '--resolve',
      '--connect-to',
      '--request-target',
      '--path-as-is',
      '--location',
      '-L',
      '--location-trusted',
    ];

    for (const option of forbiddenOptions) {
      const args = option.startsWith('--')
        ? [`${option}=blocked`, 'https://api.example.internal/v1/items']
        : [option, 'blocked', 'https://api.example.internal/v1/items'];
      const result = await gateway.execute(request({ executable: 'bash', command: 'curl', args }));
      expect(result.safeError?.safeDetails).toEqual({ reason: 'network-target-not-allowed' });
    }
  });

  it('accepts only the fixed Unix socket together with an allowed curl URL', async () => {
    const gateway = createRestrictedLocalSandboxGateway({
      allowedApis: ['http://sidecar.internal/v1/'],
      executableOverrides: { curl: process.execPath },
    });

    for (const socketArgs of [['--unix-socket', '/opt/sidecar/ir/http.sock'], ['--unix-socket=/opt/sidecar/ir/http.sock']]) {
      const result = await gateway.execute(
        request({ executable: 'bash', command: 'curl', args: [...socketArgs, 'http://sidecar.internal/v1/query'] }),
      );
      expect(result.safeError).toBeUndefined();
    }

    for (const args of [
      ['--unix-socket', '/tmp/http.sock', 'http://sidecar.internal/v1/query'],
      ['--abstract-unix-socket', 'http.sock', 'http://sidecar.internal/v1/query'],
      ['--unix-socket=/opt/sidecar/ir/http.sock', '--unix-socket=/opt/sidecar/ir/http.sock', 'http://sidecar.internal/v1/query'],
      ['--unix-socket=/opt/sidecar/ir/http.sock', 'http://untrusted.internal/v1/query'],
    ]) {
      const result = await gateway.execute(request({ executable: 'bash', command: 'curl', args }));
      expect(result.safeError?.safeDetails).toEqual({ reason: 'network-target-not-allowed' });
    }
  });

  pythonIt('checks explicit Python URL literals but preserves non-network and dynamic paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-api-policy-'));
    const allowedScript = join(root, 'allowed.py');
    const deniedScript = join(root, 'denied.py');
    const dynamicScript = join(root, 'dynamic.py');
    writeFileSync(allowedScript, "print('https://api.example.internal/v1/items')\n");
    writeFileSync(deniedScript, "print('https://other.internal/v1/items')\n");
    writeFileSync(dynamicScript, "print('https:' + '//' + 'other.internal/v1/items')\n");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedApis: ['https://api.example.internal/v1/'],
      executableOverrides: { python: hostPython! },
    });
    const filesystem = {
      defaultCwd: root,
      roots: [{ kind: 'workspace' as const, logicalPath: 'workspace', physicalPath: root, access: 'readWrite' as const }],
    };

    await expect(gateway.execute(request({ args: ['allowed.py'], filesystem }))).resolves.toMatchObject({ exitCode: 0 });
    const rejected = await gateway.execute(request({ args: ['denied.py'], filesystem }));
    expect(rejected.safeError?.safeDetails).toEqual({ reason: 'network-target-not-allowed' });
    expect(rejected.safeError?.message).toContain('https://other.internal/v1/items');
    await expect(gateway.execute(request({ args: ['dynamic.py'], filesystem }))).resolves.toMatchObject({ exitCode: 0 });

    const argvRejected = await gateway.execute(request({ args: ['dynamic.py', 'https://other.internal/v1/items'], filesystem }));
    expect(argvRejected.safeError?.safeDetails).toEqual({ reason: 'network-target-not-allowed' });
    expect(argvRejected.safeError?.message).toContain('https://other.internal/v1/items');

    const backgroundRejected = await gateway.startBackground(request({ args: ['dynamic.py', 'https://other.internal/v1/items'], filesystem }));
    expect('safeDetails' in backgroundRejected ? backgroundRejected.safeDetails : undefined).toEqual({
      reason: 'network-target-not-allowed',
    });
    expect('message' in backgroundRejected ? backgroundRejected.message : undefined).toContain('https://other.internal/v1/items');
  });

  it('uses the same network rejection for streaming and background execution without leaking the target', async () => {
    const gateway = createRestrictedLocalSandboxGateway({ allowedApis: [], executableOverrides: { curl: process.execPath } });
    const target = 'https://user:secret@internal-secret.example/v1/data?token=hidden#fragment';
    const safeTarget = 'https://internal-secret.example/v1/data';
    const sandboxRequest = request({ executable: 'bash', command: 'curl', args: [target] });

    const streamed = await gateway.executeWithStdoutChunks?.(sandboxRequest, {});
    const background = await gateway.startBackground(sandboxRequest);

    expect(streamed?.safeError?.safeDetails).toEqual({ reason: 'network-target-not-allowed' });
    expect('safeDetails' in background ? background.safeDetails : undefined).toEqual({ reason: 'network-target-not-allowed' });
    expect(streamed?.safeError?.message).toContain(safeTarget);
    expect('message' in background ? background.message : undefined).toContain(safeTarget);
    expect(JSON.stringify([streamed?.safeError, background])).not.toContain('user:secret');
    expect(JSON.stringify([streamed?.safeError, background])).not.toContain('token=hidden');
    expect(JSON.stringify([streamed?.safeError, background])).not.toContain('fragment');
  });

  it('keeps an ambiguous curl rejection message generic', async () => {
    const gateway = createRestrictedLocalSandboxGateway({
      allowedApis: ['https://api.example.internal/v1/'],
      executableOverrides: { curl: process.execPath },
    });
    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'curl',
        args: ['--location', 'https://untrusted.example/v1/data'],
      }),
    );

    expect(result.safeError?.message).toBe('Bash execution request was rejected.');
    expect(result.safeError?.message).not.toContain('https://untrusted.example/v1/data');
  });

  pythonIt('executes Python module mode from one authorized Skill projection without accepting request PYTHONPATH', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-python-module-'));
    const workspace = join(scope, 'workspace');
    const skillRoot = join(scope, '.nextagent', 'skills', 'projection', 'telecom-diagnostics');
    const poisonRoot = join(scope, 'poison');
    mkdirSync(join(workspace), { recursive: true });
    mkdirSync(join(skillRoot, 'scripts', 'nl2api'), { recursive: true });
    mkdirSync(join(poisonRoot, 'scripts', 'nl2api'), { recursive: true });
    writeFileSync(join(skillRoot, 'scripts', 'nl2api', 'api_recall_main.py'), "import sys\nprint(f'trusted:{sys.argv[1]}')\n");
    writeFileSync(join(poisonRoot, 'scripts', 'nl2api', 'api_recall_main.py'), "print('poison')\n");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: hostPython! },
    });

    const result = await gateway.execute(
      request({
        args: ['-m', 'scripts.nl2api.api_recall_main', '查询问题'],
        environment: { PYTHONPATH: poisonRoot },
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/projection/telecom-diagnostics', physicalPath: skillRoot, access: 'read' },
          ],
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll('\r\n', '\n')).toBe('trusted:查询问题\n');
    expect(result.stderr).not.toContain(skillRoot);
  });

  pythonIt('executes Python scripts with authorized request PYTHONPATH', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-pythonpath-'));
    const workspace = join(scope, 'workspace');
    const skillRoot = join(scope, '.nextagent', 'skills', 'projection', 'spn-copilot');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(skillRoot, 'scripts', 'nl2sql'), { recursive: true });
    writeFileSync(join(skillRoot, 'scripts', 'helper_module.py'), "VALUE = 'trusted'\n");
    writeFileSync(
      join(skillRoot, 'scripts', 'nl2sql', 'sql_recall_main.py'),
      "import sys\nfrom helper_module import VALUE\nprint(f'{VALUE}:{sys.argv[1]}')\n",
    );
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: hostPython! },
    });

    const result = await gateway.execute(
      request({
        args: ['.nextagent/skills/projection/spn-copilot/scripts/nl2sql/sql_recall_main.py', 'query'],
        environment: { PYTHONPATH: '.nextagent/skills/projection/spn-copilot/scripts' },
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/projection/spn-copilot', physicalPath: skillRoot, access: 'read' },
          ],
        },
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll('\r\n', '\n')).toBe('trusted:query\n');
    expect(result.stderr).not.toContain(skillRoot);
  });

  it('rejects unauthorized request PYTHONPATH before process start', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-pythonpath-reject-'));
    const workspace = join(scope, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        environment: { PYTHONPATH: '../outside' },
        filesystem: {
          defaultCwd: scope,
          roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' }],
        },
      }),
    );

    expect(result.safeError).toMatchObject({
      code: 'PYTHON_EXECUTION_REJECTED',
      safeDetails: { reason: 'unauthorized-path' },
    });
  });

  it('rejects Python module mode without exactly one authorized Skill projection', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-python-module-root-'));
    const workspace = join(scope, 'workspace');
    const firstSkill = join(scope, '.nextagent', 'skills', 'one', 'first');
    const secondSkill = join(scope, '.nextagent', 'skills', 'two', 'second');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(firstSkill, { recursive: true });
    mkdirSync(secondSkill, { recursive: true });
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: scope, executableOverrides: { python: process.execPath } });
    const baseFilesystem: SandboxFilesystemLayout = {
      defaultCwd: scope,
      roots: [{ kind: 'workspace' as const, logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' as const }],
    };

    const withoutRoot = await gateway.execute(request({ args: ['-m', 'scripts.nl2api.api_recall_main'], filesystem: baseFilesystem }));
    const withMultipleRoots = await gateway.execute(
      request({
        args: ['-m', 'scripts.nl2api.api_recall_main'],
        filesystem: {
          ...baseFilesystem,
          roots: [
            ...baseFilesystem.roots,
            { kind: 'systemResources', logicalPath: '.nextagent/skills/one/first', physicalPath: firstSkill, access: 'read' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/two/second', physicalPath: secondSkill, access: 'read' },
          ],
        },
      }),
    );

    expect(withoutRoot.safeError).toMatchObject({ safeDetails: { reason: 'python-module-root-unavailable' } });
    expect(withMultipleRoots.safeError).toMatchObject({ safeDetails: { reason: 'python-module-root-ambiguous' } });
  });

  it('rejects unsupported Python invocation modes before process start', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-mode-'));
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: process.execPath } });

    for (const args of [['-c', "print('bad')"], ['-'], ['-m'], ['-m', 'not-a-module'], ['--version', 'extra']]) {
      const result = await gateway.execute(request({ args }));
      expect(result.safeError).toMatchObject({
        code: 'PYTHON_EXECUTION_REJECTED',
        safeDetails: { reason: 'unsupported-python-invocation' },
      });
    }
  });

  pythonIt('allows exact Python version inspection without enabling other Python options', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-version-'));
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: hostPython! } });

    const result = await gateway.execute(request({ args: ['--version'] }));

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Python');
  });

  it('executes structured args with shell disabled and bounds stdout independently', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    mkdirSync(join(root, 'diagnostics'));
    writeFileSync(join(root, 'diagnostics', 'output.py'), "process.stdout.write('abcdefghij');");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      executableOverrides: { python: process.execPath },
    });
    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['diagnostics/output.py'],
        stdoutLimitBytes: 5,
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'abcde',
      stdoutTruncated: true,
      stderrTruncated: false,
      timedOut: false,
    });
  });

  it('bounds stderr independently from stdout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    writeFileSync(join(root, 'output.py'), "process.stdout.write('ok'); process.stderr.write('abcdefghij');");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['output.py'],
        stdoutLimitBytes: 10,
        stderrLimitBytes: 4,
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'ok',
      stderr: 'abcd',
      stdoutTruncated: false,
      stderrTruncated: true,
    });
  });

  it('forwards stdout chunks through the local adapter internal callback while preserving final stdout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-stream-'));
    writeFileSync(join(root, 'stream.js'), "process.stdout.write('one\\n'); setTimeout(() => { process.stdout.write('two\\n'); }, 25);");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      executableOverrides: { python: process.execPath },
    });
    const chunks: string[] = [];

    const result = await gateway.executeWithStdoutChunks!(request({ command: 'python', args: ['stream.js'] }), {
      onStdoutChunk: async (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: 'one\ntwo\n', stdoutTruncated: false });
    expect(chunks.join('')).toBe('one\ntwo\n');
  });

  it('projects LOCAL physical sandbox output paths to logical paths and materializes cwd files under temp', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-local-path-projection-'));
    const workspace = join(scope, 'workspace');
    const tempRoot = join(scope, 'temp', 'run-paths');
    const skillRoot = join(scope, '.nextagent', 'skills', 'proj', 'diagnostics');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    mkdirSync(join(skillRoot, 'scripts'), { recursive: true });
    writeFileSync(
      join(skillRoot, 'scripts', 'emit-paths.js'),
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const cwdFile = path.join(process.cwd(), 'diagnosis_context.json');",
        'fs.writeFileSync(cwdFile, \'{"ok":true}\');',
        'process.stdout.write([',
        '  cwdFile,',
        "  path.join(process.cwd(), 'workspace', 'input.txt'),",
        "  path.join(process.cwd(), 'temp', 'run-paths', 'stage.txt'),",
        "  path.join(process.cwd(), '.nextagent', 'skills', 'proj', 'diagnostics', 'scripts', 'helper.py'),",
        '  process.env.NEXTAGENT_WORKSPACE_DIR,',
        '  process.env.NEXTAGENT_TEMP_DIR,',
        '  process.env.NEXTAGENT_SKILL_ROOT',
        "].join('\\n'));",
        'process.stderr.write(process.cwd());',
      ].join('\n'),
    );
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['.nextagent/skills/proj/diagnostics/scripts/emit-paths.js'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'temp', logicalPath: 'temp', physicalPath: tempRoot, access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/proj/diagnostics', physicalPath: skillRoot, access: 'read' },
          ],
        },
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll('\\', '/').split('\n')).toEqual([
      'temp/diagnosis_context.json',
      'workspace/input.txt',
      'temp/stage.txt',
      '.nextagent/skills/proj/diagnostics/scripts/helper.py',
      'workspace',
      'temp',
      '.nextagent/skills/proj/diagnostics',
    ]);
    expect(result.stderr).toBe('temp');
    expect(result.stdout).not.toContain(scope);
    expect(result.stderr).not.toContain(scope);
    expect(readFileSync(join(tempRoot, 'diagnosis_context.json'), 'utf8')).toBe('{"ok":true}');
  });

  pythonIt('truncates output only on valid UTF-8 boundaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    writeFileSync(join(root, 'utf8.py'), "import sys\nsys.stdout.buffer.write('中'.encode('utf-8'))\nsys.stdout.flush()\n");
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: hostPython! } });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['utf8.py'],
        stdoutLimitBytes: 2,
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '',
      stdoutTruncated: true,
      timedOut: false,
    });
  });

  it('can disable function validation for local trusted composition while keeping gateway execution controls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    mkdirSync(join(root, 'logs'));
    writeFileSync(join(root, 'logs', 'alarm.txt'), 'process.stdout.write(process.cwd());');
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      enabled: false,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['logs/alarm.txt'],
        environment: { SECRET: 'value' },
      }),
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'workspace' });
  });

  it('forwards only the system-provided attachment path environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-environment-'));
    writeFileSync(
      join(root, 'environment.js'),
      'process.stdout.write(JSON.stringify({ attachmentPaths: process.env.FILE_PATHS, secret: process.env.SECRET }));',
    );
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['environment.js'],
        environment: { FILE_PATHS: '["C:\\\\workspace\\\\attachment.md"]', SECRET: 'must-not-reach-child' },
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '{"attachmentPaths":"[\\"C:\\\\\\\\workspace\\\\\\\\attachment.md\\"]"}',
    });
  });

  it('reports execution ready even when request validation is disabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      enabled: false,
    });

    expect(gateway.isExecutionReady?.()).toBe(true);
  });

  builtinExecutableIt('runs bash requests through a trusted shell when validation is enabled and shell interpretation is required', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-shell-'));
    mkdirSync(join(root, 'logs'));
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root });
    const requestArgs = process.platform === 'win32' ? ['logs', '&&', 'cd'] : ['logs', '&&', 'pwd'];

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'cd',
        args: requestArgs,
        filesystem: { defaultCwd: root, roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: root, access: 'readWrite' }] },
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().replaceAll('\\', '/')).toBe('workspace/logs');
  });

  windowsIt('runs trusted bash requests through cmd shell when validation is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-shell-'));
    const logsDir = join(root, 'logs');
    mkdirSync(logsDir);
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      enabled: false,
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'cd',
        args: ['logs', '&&', 'cd'],
        filesystem: { defaultCwd: root, roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: root, access: 'readWrite' }] },
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    // Windows cmd can emit the non-ASCII user-home prefix in the active code page.
    expect(result.stdout.trim().replaceAll('\\', '/')).toBe('workspace/logs');
  });

  it('still fails closed for invalid commands when validation is enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      deniedExecutables: ['curl'],
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'curl',
        args: ['https://example.com'],
      }),
    );

    expect(result.safeError).toMatchObject({
      code: 'BASH_EXECUTION_REJECTED',
      safeDetails: { reason: 'denied-executable' },
    });
  });

  it('skips denied executable checks when validation is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-custom-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      enabled: false,
      deniedExecutables: ['curl'],
      executableOverrides: { curl: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'curl',
        args: ['-e', "process.stdout.write('skip-deny-ok')"],
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 0, stdout: 'skip-deny-ok' });
  });

  it('allows an executable included in the configured allowlist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-allowlist-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedExecutables: ['node'],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args: ['-e', "process.stdout.write('allowlist-ok')"],
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 0, stdout: 'allowlist-ok' });
  });

  it('rejects an executable omitted from the configured allowlist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-allowlist-reject-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedExecutables: ['curl'],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args: ['-e', "process.stdout.write('must-not-run')"],
      }),
    );

    expect(result.safeError).toMatchObject({
      code: 'BASH_EXECUTION_REJECTED',
      safeDetails: { reason: 'denied-executable' },
    });
  });

  it('rejects every executable when the configured allowlist is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-empty-allowlist-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedExecutables: [],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(request({ executable: 'bash', command: 'node', args: ['--version'] }));

    expect(result.safeError).toMatchObject({
      code: 'BASH_EXECUTION_REJECTED',
      safeDetails: { reason: 'denied-executable' },
    });
  });

  it('gives the denylist priority when an executable is in both lists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-policy-conflict-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedExecutables: ['node'],
      deniedExecutables: ['node'],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(request({ executable: 'bash', command: 'node', args: ['--version'] }));

    expect(result.safeError).toMatchObject({
      code: 'BASH_EXECUTION_REJECTED',
      safeDetails: { reason: 'denied-executable' },
    });
  });

  it('skips allowlist checks when validation is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-disabled-allowlist-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      enabled: false,
      allowedExecutables: [],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args: ['-e', "process.stdout.write('skip-allow-ok')"],
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 0, stdout: 'skip-allow-ok' });
  });

  it('enforces allowlist direct-only execution by rejecting shell composition before process start', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-allowlist-direct-only-'));
    const marker = join(root, 'must-not-run.txt');
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedExecutables: ['node'],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args: ['-e', "require('node:fs').writeFileSync('must-not-run.txt','ran')", '&&', 'node', '--version'],
      }),
    );

    expect(result.safeError).toMatchObject({
      code: 'BASH_EXECUTION_REJECTED',
      safeDetails: { reason: 'shell-composition-not-allowed' },
    });
    expect(existsSync(marker)).toBe(false);
  });

  it('keeps shell-like argv literal during allowlist direct-only execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-allowlist-direct-only-argv-'));
    const redirected = join(root, 'redirected.txt');
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      allowedExecutables: ['node'],
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'payload', '>', 'redirected.txt'],
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.stdout).toBe('["payload",">","redirected.txt"]');
    expect(existsSync(redirected)).toBe(false);
  });

  it('allows non-denied executables to run through the gateway', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-custom-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args: ['-e', "process.stdout.write('custom-ok')"],
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 0, stdout: 'custom-ok' });
  });

  it('supports timeout and AbortSignal cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-'));
    writeFileSync(join(root, 'wait.py'), 'setInterval(() => {}, 1000);');
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: process.execPath } });
    const timedOut = await gateway.execute(
      request({
        command: 'python',
        args: ['wait.py'],
        timeoutMs: 20,
      }),
    );
    expect(timedOut).toMatchObject({ timedOut: true });

    const controller = new AbortController();
    const pending = gateway.execute(request({ command: 'python', args: ['wait.py'] }), controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ safeError: { category: 'CANCELED' } });

    const alreadyCanceled = new AbortController();
    alreadyCanceled.abort();
    await expect(gateway.execute(request({ command: 'python', args: ['wait.py'] }), alreadyCanceled.signal)).resolves.toMatchObject({
      safeError: { category: 'CANCELED' },
    });
  });

  pythonIt('executes python scripts from workspace-relative paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-'));
    mkdirSync(join(root, '.nextagent-python-tool'));
    writeFileSync(join(root, '.nextagent-python-tool', 'snippet.py'), "print('snippet-ok', end='')");
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: hostPython! } });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['.nextagent-python-tool/snippet.py', 'arg1'],
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'snippet-ok',
      stderr: '',
      timedOut: false,
    });
  });

  pythonIt('supports standard-library imports from the submitted python script', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-'));
    mkdirSync(join(root, '.nextagent-python-tool'));
    writeFileSync(
      join(root, '.nextagent-python-tool', 'stdlib-import.py'),
      "import json\nprint(json.dumps({'ok': True}, separators=(',', ':')), end='')\n",
    );
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: hostPython! } });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['.nextagent-python-tool/stdlib-import.py'],
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: '',
      timedOut: false,
    });
  });

  pythonIt('passes host PYTHONPATH through to the sandboxed python process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-'));
    mkdirSync(join(root, '.nextagent-python-tool'));
    writeFileSync(join(root, '.nextagent-python-tool', 'pythonpath.py'), "import os\nprint(os.environ.get('PYTHONPATH', ''), end='')\n");
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: hostPython! } });
    const originalPythonPath = process.env['PYTHONPATH'];
    process.env['PYTHONPATH'] = join(root, 'python-lib');

    try {
      const result = await gateway.execute(
        request({
          command: 'python',
          args: ['.nextagent-python-tool/pythonpath.py'],
        }),
      );

      expect(result).toMatchObject({
        exitCode: 0,
        stdout: 'workspace/python-lib',
        stderr: '',
        timedOut: false,
      });
    } finally {
      if (originalPythonPath === undefined) {
        delete process.env['PYTHONPATH'];
      } else {
        process.env['PYTHONPATH'] = originalPythonPath;
      }
    }
  });

  pythonIt('does not implicitly expose workspace-root local modules to python imports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-python-'));
    mkdirSync(join(root, '.nextagent-python-tool'));
    writeFileSync(join(root, 'workspace_helper.py'), "VALUE = 'workspace-root'\n");
    writeFileSync(join(root, '.nextagent-python-tool', 'local-import.py'), "import workspace_helper\nprint(workspace_helper.VALUE, end='')\n");
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: hostPython! } });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['.nextagent-python-tool/local-import.py'],
        timeoutMs: 5000,
      }),
    );

    expect(result).toMatchObject({
      exitCode: 1,
      stdout: '',
      timedOut: false,
    });
    expect(result.stderr).toContain('ModuleNotFoundError');
    expect(result.stderr).toContain('workspace_helper');
  });

  copiedNodeExecutableIt('executes clipc from the trusted executable directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-clipc-'));
    const binDir = mkdtempSync(join(root, 'bin-'));
    const staged = join(binDir, process.platform === 'win32' ? 'clipc.exe' : 'clipc');
    copyFileSync(process.execPath, staged);
    if (process.platform !== 'win32') {
      chmodSync(staged, 0o755);
    }

    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-clipc-ws-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir,
      clipcExecutableDirectory: binDir,
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'clipc',
        args: ['-e', "process.stdout.write('clipc-ok')"],
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('clipc-ok');
  });

  copiedNodeExecutableIt('normalizes one outer quote pair around the trusted clipc directory', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-quoted-clipc-'));
    const staged = join(binDir, process.platform === 'win32' ? 'clipc.exe' : 'clipc');
    copyFileSync(process.execPath, staged);
    if (process.platform !== 'win32') {
      chmodSync(staged, 0o755);
    }
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-quoted-clipc-ws-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir,
      clipcExecutableDirectory: `"${binDir}"`,
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'clipc',
        args: ['-e', "process.stdout.write('quoted-clipc-ok')"],
      }),
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'quoted-clipc-ok' });
  });

  it('fails closed when the trusted clipc executable directory is missing', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-missing-'));
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir });

    const result = await gateway.execute(request({ executable: 'bash', command: 'clipc', args: [] }));

    expect(result.safeError).toMatchObject({ code: 'BASH_EXECUTION_UNAVAILABLE' });
  });

  it('fails closed when a non-shell direct executable cannot be resolved', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-unknown-'));
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir });

    const result = await gateway.execute(request({ executable: 'bash', command: 'nonexistent-tool-xyz', args: [] }));

    expect(result.safeError).toMatchObject({ code: 'BASH_EXECUTION_REJECTED' });
  });

  copiedNodeExecutableIt('does not allow executableOverrides to replace the trusted clipc locator', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-pathargs-'));
    writeFileSync(join(workspaceDir, 'in-workspace.txt'), 'marker');
    const binDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-pathargs-bin-'));
    const staged = join(binDir, process.platform === 'win32' ? 'clipc.exe' : 'clipc');
    copyFileSync(process.execPath, staged);
    if (process.platform !== 'win32') {
      chmodSync(staged, 0o755);
    }

    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir,
      clipcExecutableDirectory: binDir,
      executableOverrides: { clipc: join(workspaceDir, 'in-workspace.txt') },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'clipc',
        args: ['-e', "process.stdout.write('trusted-clipc')"],
      }),
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'trusted-clipc' });
  });

  copiedNodeExecutableIt('injects CLIP_HOME into clipc subprocess environment', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-clipc-home-'));
    const staged = join(binDir, process.platform === 'win32' ? 'clipc.exe' : 'clipc');
    copyFileSync(process.execPath, staged);
    if (process.platform !== 'win32') {
      chmodSync(staged, 0o755);
    }

    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-clipc-home-ws-'));
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir,
      clipcExecutableDirectory: binDir,
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'clipc',
        args: ['-e', "process.stdout.write(process.env.CLIP_HOME ?? 'undefined')"],
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(binDir);
  });

  copiedNodeExecutableIt('does not inject CLIP_HOME for non-clipc commands', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-no-clip-home-'));
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-no-clip-home-ws-'));
    const fakeNode = join(workspaceDir, process.platform === 'win32' ? 'fakenode.exe' : 'fakenode');
    copyFileSync(process.execPath, fakeNode);
    if (process.platform !== 'win32') {
      chmodSync(fakeNode, 0o755);
    }
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir,
      clipcExecutableDirectory: binDir,
      executableOverrides: { fakenode: fakeNode },
    });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'fakenode',
        args: ['-e', "process.stdout.write(process.env.CLIP_HOME ?? 'undefined')"],
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('undefined');
  });

  pythonIt(
    'accepts a path under a per-call trustRoot even when it lives outside the workspace',
    async () => {
      // The per-call trust contract: the bash tool forwards
      // Skill-bundled scripts are only reachable when the sandbox filesystem
      // layout includes the authorized `.nextagent` projection subtree.
      const workspace = mkdtempSync(join(tmpdir(), 'nextagent-bash-ws-'));
      const skillRoot = mkdtempSync(join(tmpdir(), 'nextagent-bash-skill-'));
      mkdirSync(join(skillRoot, 'scripts'));
      writeFileSync(join(skillRoot, 'scripts', 'rag_query.py'), "process.stdout.write('per-call-trust-ok')");
      const scriptPath = '.nextagent/skills/proj/rag-skill/scripts/rag_query.py';

      const gateway = createRestrictedLocalSandboxGateway({
        workspaceDir: workspace,
        executableOverrides: { python: process.execPath },
      });

      const withoutTrust = await gateway.execute(
        request({
          command: 'python',
          args: [scriptPath],
          filesystem: {
            defaultCwd: workspace,
            roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' }],
          },
        }),
      );
      expect(withoutTrust.exitCode).not.toBe(0);

      const withTrust = await gateway.execute(
        request({
          command: 'python',
          args: [scriptPath],
          filesystem: {
            defaultCwd: workspace,
            roots: [{ kind: 'systemResources', logicalPath: '.nextagent/skills/proj/rag-skill', physicalPath: skillRoot, access: 'read' }],
          },
        }),
      );
      expect(withTrust).toMatchObject({ exitCode: 0, stdout: 'per-call-trust-ok' });

      const missingScript = await gateway.execute(
        request({
          command: 'python',
          args: ['.nextagent/skills/proj/rag-skill/scripts/missing.py'],
          filesystem: {
            defaultCwd: workspace,
            roots: [{ kind: 'systemResources', logicalPath: '.nextagent/skills/proj/rag-skill', physicalPath: skillRoot, access: 'read' }],
          },
        }),
      );
      expect(missingScript.exitCode).not.toBe(0);
    },
    15_000,
  );

  it('derives NEXTAGENT_SKILL_ROOT from the explicit script path when multiple projections are available', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-explicit-skill-root-'));
    const workspace = join(scope, 'workspace');
    const firstSkillRoot = join(scope, '.nextagent', 'skills', 'first-projection', 'first-skill');
    const secondSkillRoot = join(scope, '.nextagent', 'skills', 'second-projection', 'second-skill');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(firstSkillRoot, 'scripts'), { recursive: true });
    mkdirSync(join(secondSkillRoot, 'scripts'), { recursive: true });
    writeFileSync(
      join(secondSkillRoot, 'scripts', 'print-root.py'),
      [
        "const path = require('node:path');",
        'const actual = process.env.NEXTAGENT_SKILL_ROOT;',
        "process.stdout.write(actual === path.resolve(__dirname, '..') ? 'matched' : 'mismatch');",
      ].join('\n'),
    );
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['.nextagent/skills/second-projection/second-skill/scripts/print-root.py'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/first-projection/first-skill', physicalPath: firstSkillRoot, access: 'read' },
            {
              kind: 'systemResources',
              logicalPath: '.nextagent/skills/second-projection/second-skill',
              physicalPath: secondSkillRoot,
              access: 'read',
            },
          ],
        },
      }),
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'matched' });
  });

  it('sets Skill Python execution path environment per request', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-skill-python-env-'));
    const workspace = join(scope, 'workspace');
    const tempOne = join(scope, 'temp', 'run-one');
    const tempTwo = join(scope, 'temp', 'run-two');
    const skillRoot = mkdtempSync(join(tmpdir(), 'nextagent-skill-python-env-skill-'));
    mkdirSync(workspace, { recursive: true });
    mkdirSync(tempOne, { recursive: true });
    mkdirSync(tempTwo, { recursive: true });
    mkdirSync(join(skillRoot, 'scripts'), { recursive: true });
    writeFileSync(
      join(skillRoot, 'scripts', 'export.py'),
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const label = process.argv[2];',
        'const workspaceDir = process.env.NEXTAGENT_WORKSPACE_DIR;',
        'const tempDir = process.env.NEXTAGENT_TEMP_DIR;',
        'const skillRoot = process.env.NEXTAGENT_SKILL_ROOT;',
        'if (!workspaceDir || !tempDir || !skillRoot) process.exit(21);',
        "if (skillRoot !== path.resolve(__dirname, '..')) process.exit(22);",
        "fs.writeFileSync(path.join(workspaceDir, `${label}.result.txt`), 'result');",
        "fs.writeFileSync(path.join(tempDir, 'stage.txt'), label);",
        "process.stdout.write('env-ok');",
      ].join('\n'),
    );
    const scriptPath = '.nextagent/skills/proj/rag-skill/scripts/export.py';
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: workspace,
      executableOverrides: { python: process.execPath },
    });

    const first = await gateway.execute(
      request({
        command: 'python',
        args: [scriptPath, 'one'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'temp', logicalPath: 'temp', physicalPath: tempOne, access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/proj/rag-skill', physicalPath: skillRoot, access: 'read' },
          ],
        },
      }),
    );
    const second = await gateway.execute(
      request({
        command: 'python',
        args: [scriptPath, 'two'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'temp', logicalPath: 'temp', physicalPath: tempTwo, access: 'readWrite' },
            { kind: 'systemResources', logicalPath: '.nextagent/skills/proj/rag-skill', physicalPath: skillRoot, access: 'read' },
          ],
        },
      }),
    );

    expect(first).toMatchObject({ exitCode: 0, stdout: 'env-ok' });
    expect(second).toMatchObject({ exitCode: 0, stdout: 'env-ok' });
    expect(readFileSync(join(workspace, 'one.result.txt'), 'utf8')).toBe('result');
    expect(readFileSync(join(workspace, 'two.result.txt'), 'utf8')).toBe('result');
    expect(readFileSync(join(tempOne, 'stage.txt'), 'utf8')).toBe('one');
    expect(readFileSync(join(tempTwo, 'stage.txt'), 'utf8')).toBe('two');
  }, 15_000);

  pythonIt(
    'runs a real Skill Python script with workspace result and run temp paths',
    async () => {
      const scope = mkdtempSync(join(tmpdir(), 'nextagent-real-skill-python-env-'));
      const workspace = join(scope, 'workspace');
      const tempRoot = join(scope, 'temp', 'run-real');
      const skillRoot = mkdtempSync(join(tmpdir(), 'nextagent-real-skill-python-env-skill-'));
      mkdirSync(workspace, { recursive: true });
      mkdirSync(tempRoot, { recursive: true });
      mkdirSync(join(skillRoot, 'scripts'), { recursive: true });
      writeFileSync(
        join(skillRoot, 'scripts', 'export.py'),
        [
          'import os',
          'from pathlib import Path',
          "workspace_dir = os.environ.get('NEXTAGENT_WORKSPACE_DIR')",
          "temp_dir = os.environ.get('NEXTAGENT_TEMP_DIR')",
          "skill_root = os.environ.get('NEXTAGENT_SKILL_ROOT')",
          'if not workspace_dir or not temp_dir or not skill_root:',
          '    raise SystemExit(21)',
          'if Path(skill_root).resolve() != Path(__file__).resolve().parents[1]:',
          '    raise SystemExit(22)',
          "Path(workspace_dir, 'python-result.txt').write_text('result-ok', encoding='utf-8')",
          "Path(temp_dir, 'python-stage.txt').write_text('stage-ok', encoding='utf-8')",
          "print('real-python-env-ok', end='')",
        ].join('\n'),
      );
      const gateway = createRestrictedLocalSandboxGateway({
        workspaceDir: workspace,
        executableOverrides: { python: hostPython! },
      });

      const result = await gateway.execute(
        request({
          command: 'python',
          args: ['.nextagent/skills/proj/rag-skill/scripts/export.py'],
          filesystem: {
            defaultCwd: scope,
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
              { kind: 'temp', logicalPath: 'temp', physicalPath: tempRoot, access: 'readWrite' },
              { kind: 'systemResources', logicalPath: '.nextagent/skills/proj/rag-skill', physicalPath: skillRoot, access: 'read' },
            ],
          },
        }),
      );

      expect(result).toMatchObject({ exitCode: 0, stdout: 'real-python-env-ok' });
      expect(readFileSync(join(workspace, 'python-result.txt'), 'utf8')).toBe('result-ok');
      expect(readFileSync(join(tempRoot, 'python-stage.txt'), 'utf8')).toBe('stage-ok');
    },
    15_000,
  );

  it('translates explicit shared-data python script paths without adding search authority', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-shared-scope-'));
    const workspace = join(scope, 'workspace');
    const sharedData = mkdtempSync(join(tmpdir(), 'nextagent-shared-data-'));
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(sharedData, 'scripts'), { recursive: true });
    writeFileSync(join(sharedData, 'scripts', 'diagnose.js'), "process.stdout.write(process.argv.slice(2).join('|'))");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['shared-data/scripts/diagnose.js', '--case', 'shared-data/cases/alarm.json'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: sharedData, access: 'read' },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '--case|shared-data/cases/alarm.json',
    });

    const bySearchName = await gateway.execute(
      request({
        command: 'diagnose.js',
        args: [],
        executable: 'bash',
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: sharedData, access: 'read' },
          ],
        },
      }),
    );
    expect(bySearchName.safeError).toMatchObject({
      code: 'BASH_EXECUTION_REJECTED',
      safeDetails: { reason: 'unsupported-executable' },
    });
  });

  it('resolves shared-data root arguments for ordinary sandbox commands', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-shared-scope-'));
    const workspace = join(scope, 'workspace');
    const sharedData = join(scope, 'shared-data');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sharedData, { recursive: true });
    writeFileSync(join(sharedData, 'A.TXT'), 'shared');
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { node: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'node',
        args: ['-e', "const fs = require('node:fs'); process.stdout.write(fs.readdirSync(process.argv[1]).join(','));", 'shared-data'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: sharedData, access: 'read' },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'A.TXT',
    });
  });

  it('resolves shared-data root arguments before shell interpretation', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-shared-shell-scope-'));
    const workspace = join(scope, 'workspace');
    const sharedData = mkdtempSync(join(tmpdir(), 'nextagent-shared-shell-data-'));
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(sharedData, 'A.TXT'), 'shared');
    writeFileSync(join(sharedData, 'list.js'), "const fs = require('node:fs'); console.log(fs.readdirSync(__dirname).join('\\n'));");
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: scope });
    const args = ['shared-data/list.js', '|', process.platform === 'win32' ? 'findstr' : 'grep', 'A.TXT'];

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'node',
        args,
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: sharedData, access: 'read' },
          ],
        },
      }),
    );

    expect(result.safeError).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split(/\r?\n/u)).toContain('A.TXT');
  });

  it('rejects unsafe shared-data python script path arguments before interpreter execution', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-shared-scope-'));
    const workspace = join(scope, 'workspace');
    const sharedData = mkdtempSync(join(tmpdir(), 'nextagent-shared-data-'));
    mkdirSync(workspace, { recursive: true });
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: process.execPath },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['shared-data/../diagnose.js'],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: sharedData, access: 'read' },
          ],
        },
      }),
    );

    expect(result.safeError).toMatchObject({
      code: 'PYTHON_EXECUTION_REJECTED',
      safeDetails: { reason: 'unauthorized-path' },
    });
  });

  it('does not implement LOCAL readonly isolation by mutating host permissions', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages', 'agent-platform-gateway-local', 'src', 'sandbox', 'restricted-local-sandbox.ts'),
      'utf8',
    );

    expect(source).not.toContain('protectReadonlyRoots');
    expect(source).not.toContain('icacls');
    expect(source).not.toContain('stats.mode & ~0o222');
  });

  posixPythonIt('executes a readable Python script without adding execute permission', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-python-mode-'));
    const workspace = join(scope, 'workspace');
    const script = join(workspace, 'script.py');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(script, "print('python-readable')\n");
    chmodSync(script, 0o640);
    const before = statSync(script).mode & 0o777;
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: hostPython! },
    });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['workspace/script.py'],
        filesystem: {
          defaultCwd: scope,
          roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' }],
        },
      }),
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stdout.replaceAll('\r\n', '\n')).toBe('python-readable\n');
    expect(statSync(script).mode & 0o777).toBe(before);
  });

  posixIt('stages a readable non-executable direct script in sandbox temp and removes the copy', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-direct-script-'));
    const workspace = join(scope, 'workspace');
    const tempRoot = join(scope, 'temp', 'run-direct');
    const script = join(workspace, 'scripts', 'run.sh');
    mkdirSync(join(workspace, 'scripts'), { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(script, "#!/bin/sh\nprintf 'staged-direct'\n");
    chmodSync(script, 0o640);
    const before = statSync(script).mode & 0o777;
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: scope });

    const result = await gateway.execute(
      request({
        executable: 'bash',
        command: 'workspace/scripts/run.sh',
        args: [],
        filesystem: {
          defaultCwd: scope,
          roots: [
            { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
            { kind: 'temp', logicalPath: 'temp', physicalPath: tempRoot, access: 'readWrite' },
          ],
        },
      }),
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'staged-direct' });
    expect(statSync(script).mode & 0o777).toBe(before);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  posixIt('preserves Skill and workspace modes during concurrent success and failure', async () => {
    const scope = mkdtempSync(join(tmpdir(), 'nextagent-permission-invariant-'));
    const workspace = join(scope, 'workspace');
    const sharedData = join(scope, 'shared-data');
    const skillRoot = join(scope, '.nextagent', 'skills', 'projection', 'diagnostics');
    const script = join(skillRoot, 'scripts', 'mode.js');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sharedData, { recursive: true });
    mkdirSync(join(skillRoot, 'scripts'), { recursive: true });
    writeFileSync(
      script,
      "const fs=require('node:fs');setTimeout(()=>{process.stdout.write((fs.statSync(__filename).mode&0o777).toString(8));if(process.argv[2]==='fail')process.exit(2)},50)",
    );
    chmodSync(workspace, 0o750);
    chmodSync(sharedData, 0o750);
    chmodSync(skillRoot, 0o750);
    chmodSync(script, 0o640);
    const before = {
      workspace: statSync(workspace).mode & 0o777,
      sharedData: statSync(sharedData).mode & 0o777,
      skill: statSync(skillRoot).mode & 0o777,
      script: statSync(script).mode & 0o777,
    };
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: scope,
      executableOverrides: { python: process.execPath },
    });
    const execution = (outcome: 'success' | 'fail') =>
      gateway.execute(
        request({
          command: 'python',
          args: ['.nextagent/skills/projection/diagnostics/scripts/mode.js', outcome],
          filesystem: {
            defaultCwd: scope,
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
              { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: sharedData, access: 'read' },
              { kind: 'systemResources', logicalPath: '.nextagent/skills/projection/diagnostics', physicalPath: skillRoot, access: 'read' },
            ],
          },
        }),
      );

    const [success, failure] = await Promise.all([execution('success'), execution('fail')]);

    expect(success).toMatchObject({ exitCode: 0, stdout: '640' });
    expect(failure).toMatchObject({ exitCode: 2, stdout: '640' });
    expect(statSync(workspace).mode & 0o777).toBe(before.workspace);
    expect(statSync(sharedData).mode & 0o777).toBe(before.sharedData);
    expect(statSync(skillRoot).mode & 0o777).toBe(before.skill);
    expect(statSync(script).mode & 0o777).toBe(before.script);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'returns a bounded permission rejection for an unreadable direct script',
    async () => {
      const scope = mkdtempSync(join(tmpdir(), 'nextagent-direct-permission-'));
      const workspace = join(scope, 'workspace');
      const tempRoot = join(scope, 'temp');
      const script = join(workspace, 'blocked.sh');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(tempRoot, { recursive: true });
      writeFileSync(script, '#!/bin/sh\nexit 0\n');
      chmodSync(script, 0o000);
      const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: scope });

      const result = await gateway.execute(
        request({
          executable: 'bash',
          command: 'workspace/blocked.sh',
          args: [],
          filesystem: {
            defaultCwd: scope,
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspace, access: 'readWrite' },
              { kind: 'temp', logicalPath: 'temp', physicalPath: tempRoot, access: 'readWrite' },
            ],
          },
        }),
      );

      expect(result.safeError).toMatchObject({
        code: 'BASH_EXECUTION_REJECTED',
        safeDetails: { reason: 'permission-denied' },
      });
      expect(JSON.stringify(result.safeError)).not.toContain(scope);
      expect(statSync(script).mode & 0o777).toBe(0);
    },
  );

  builtinExecutableIt(
    'bounds each background output file at the first byte beyond the limit',
    async () => {
      for (const outputChannel of ['stdout', 'stderr'] as const) {
        const root = mkdtempSync(join(tmpdir(), `nextagent-sandbox-${outputChannel}-limit-`));
        writeFileSync(join(root, 'overflow.js'), `process.${outputChannel}.write(Buffer.alloc(10 * 1024 * 1024 + 1, 120));`);
        const gateway = createRestrictedLocalSandboxGateway({
          workspaceDir: root,
          executableOverrides: { python: process.execPath },
        });
        const started = await gateway.startBackground(
          request({
            command: 'python',
            args: ['overflow.js'],
            filesystem: {
              defaultCwd: root,
              roots: [{ kind: 'workspace' as const, logicalPath: 'workspace', physicalPath: root, access: 'readWrite' as const }],
            },
          }),
        );
        expect('handle' in started).toBe(true);
        if (!('handle' in started)) {
          return;
        }

        const stdoutPath = join(root, 'tool-results', `${started.handle.taskId}.stdout.txt`);
        const stderrPath = join(root, 'tool-results', `${started.handle.taskId}.stderr.txt`);
        const finished = await started.completion;

        expect(finished).toMatchObject({ status: 'FAILED', exitCode: -1 });
        expect(statSync(outputChannel === 'stdout' ? stdoutPath : stderrPath).size).toBe(10 * 1024 * 1024);
        expect(statSync(outputChannel === 'stdout' ? stderrPath : stdoutPath).size).toBe(0);
      }
    },
    30_000,
  );

  builtinExecutableIt(
    'allows background output that ends exactly at the byte limit',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-exact-limit-'));
      writeFileSync(join(root, 'exact.js'), 'process.stdout.write(Buffer.alloc(10 * 1024 * 1024, 120));');
      const gateway = createRestrictedLocalSandboxGateway({
        workspaceDir: root,
        executableOverrides: { python: process.execPath },
      });
      const started = await gateway.startBackground(
        request({
          command: 'python',
          args: ['exact.js'],
          filesystem: {
            defaultCwd: root,
            roots: [{ kind: 'workspace' as const, logicalPath: 'workspace', physicalPath: root, access: 'readWrite' as const }],
          },
        }),
      );
      expect('handle' in started).toBe(true);
      if (!('handle' in started)) {
        return;
      }

      const finished = await started.completion;
      const stdoutPath = join(root, 'tool-results', `${started.handle.taskId}.stdout.txt`);
      expect(finished).toMatchObject({ status: 'COMPLETED', exitCode: 0 });
      expect(statSync(stdoutPath).size).toBe(10 * 1024 * 1024);
    },
    30_000,
  );
});

function request(overrides: Partial<Parameters<ReturnType<typeof createRestrictedLocalSandboxGateway>['execute']>[0]> = {}) {
  return {
    executionId: 'sandbox-test',
    requestRunId: brand<string, 'RequestRunId'>('run-sandbox'),
    tenantId: brand<string, 'TenantId'>('tenant-sandbox'),
    subjectId: brand<string, 'SubjectId'>('subject-sandbox'),
    executable: 'python' as const,
    command: 'python',
    args: ['script.py'],
    filesystem: { defaultCwd: process.cwd(), roots: [] },
    environment: {},
    timeoutMs: 5000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024,
    ...overrides,
  };
}

function resolveHostPython(): string | undefined {
  const candidates = [
    { command: 'python', args: ['-c', "import sys; print(sys.executable, end='')"] },
    { command: 'py', args: ['-3', '-c', "import sys; print(sys.executable, end='')"] },
  ];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, { encoding: 'utf8' });
    if (result.status === 0) {
      const executable = result.stdout.trim();
      if (executable.length > 0) {
        return executable;
      }
    }
  }
  return undefined;
}
