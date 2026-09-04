import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';
import { ROOT_PLUGIN_API_VERSION } from '../index.js';

export interface CreatePluginScaffoldOptions {
  readonly targetDirectory: string;
}

export interface CreatePluginScaffoldResult {
  readonly pluginId: string;
  readonly files: readonly string[];
}

export function createPluginScaffold(options: CreatePluginScaffoldOptions): CreatePluginScaffoldResult {
  if (hasParentTraversal(options.targetDirectory)) {
    throw new Error('Plugin scaffold target must not use parent traversal.');
  }
  const targetDirectory = normalize(options.targetDirectory);
  const pluginId = safePluginId(basename(targetDirectory));
  if (existsSync(targetDirectory)) {
    throw new Error('Plugin scaffold target already exists.');
  }

  const files = ['package.json', 'tsconfig.json', 'esbuild.config.ts', 'src/index.ts', 'plugin.json', 'tests/plugin.test.ts', 'README.md'];
  mkdirSync(join(targetDirectory, 'src'), { recursive: true });
  mkdirSync(join(targetDirectory, 'tests'), { recursive: true });
  for (const file of files) {
    writeFileSync(join(targetDirectory, file), templateFor(file, pluginId), 'utf8');
  }
  return Object.freeze({ pluginId, files: Object.freeze(files) });
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes('..');
}

function safePluginId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id)) {
    throw new Error('Plugin scaffold target directory name must be a safe plugin id.');
  }
  return id;
}

function templateFor(file: string, pluginId: string): string {
  switch (file) {
    case 'package.json':
      return `${JSON.stringify(
        {
          name: pluginId,
          version: '1.0.0',
          type: 'module',
          private: true,
          scripts: {
            build: 'tsx esbuild.config.ts',
            test: 'vitest run',
          },
          dependencies: {
            '@nextagent/agent-plugin-sdk': '1.0.0',
          },
          devDependencies: {
            esbuild: '^0.24.0',
            tsx: '^4.19.0',
            typescript: '^5.9.0',
            vitest: '^4.0.0',
          },
        },
        null,
        2,
      )}\n`;
    case 'tsconfig.json':
      return `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            skipLibCheck: true,
          },
          include: ['src/**/*.ts', 'tests/**/*.ts', 'esbuild.config.ts'],
        },
        null,
        2,
      )}\n`;
    case 'esbuild.config.ts':
      return `import { build } from "esbuild";\n\nawait build({\n  entryPoints: ["src/index.ts"],\n  outfile: "dist/index.js",\n  bundle: true,\n  platform: "node",\n  format: "esm",\n  sourcemap: "inline",\n  target: "node22",\n  packages: "bundle"\n});\n`;
    case 'src/index.ts':
      return `import { definePlugin,defineTool,defineToolProvider } from "@nextagent/agent-plugin-sdk";\n\nconst echoTool = defineTool({\n  name: "echo",\n  description: "Echoes a safe diagnostic payload for plugin smoke testing.",\n  inputSchema: { type: "object", additionalProperties: false, properties: { text: { type: "string" } }, required: ["text"] },\n  outputSchema: { type: "object", additionalProperties: false, properties: { text: { type: "string" } }, required: ["text"] },\n  async execute(input) {\n    return { text: String(input.text ?? "") };\n  }\n});\n\nexport default definePlugin({\n  pluginId: "${pluginId}",\n  version: "1.0.0",\n  providers: [defineToolProvider({ providerId: "${pluginId}.tools", tools: [echoTool] })]\n});\n`;
    case 'plugin.json':
      return `${JSON.stringify(
        {
          pluginId,
          version: '1.0.0',
          apiVersion: ROOT_PLUGIN_API_VERSION,
          main: './dist/index.js',
          artifactType: 'esm-bundle',
          hostExternals: [],
        },
        null,
        2,
      )}\n`;
    case 'tests/plugin.test.ts':
      return `import { describe,expect,it } from "vitest";\nimport { getPluginMetadata } from "@nextagent/agent-plugin-sdk";\nimport plugin from "../src/index.js";\n\ndescribe("${pluginId}", () => {\n  it("exposes safe plugin metadata", () => {\n    expect(getPluginMetadata(plugin)).toEqual({\n      apiVersion: "1.0",\n      pluginId: "${pluginId}",\n      version: "1.0.0",\n      providerIds: ["${pluginId}.tools"],\n      policyIds: [],\n      hookIds: []\n    });\n  });\n});\n`;
    case 'README.md':
      return `# ${pluginId}\n\nRun \`npm run build\`, then copy \`plugin.json\` and \`dist/index.js\` to \`configRoot/plugins/${pluginId}/\`.\n\nThis scaffold tests the materialized plugin object only. App loader, manifest, bundle static scan, host external validation, Agent activation and capability governance are validated by NextAgent runtime tests.\n`;
    default:
      throw new Error(`Unknown scaffold template: ${file}`);
  }
}
