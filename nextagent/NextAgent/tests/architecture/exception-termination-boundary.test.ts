import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('exception termination ownership', () => {
  it('rejects the representative log-and-rethrow fixture and accepts a consuming boundary', () => {
    expect(logAndRethrowViolations(fixture('invalid-log-and-rethrow.ts'))).toEqual(['error']);
    expect(logAndRethrowViolations(fixture('valid-consume.ts'))).toEqual([]);
  });

  it('keeps touched propagation helpers and Todo persistence layers free of duplicate exception events', () => {
    const model = source('packages/agent-core/src/model/run-bound-model-invocation.ts');
    const tools = source('packages/agent-core/src/tools/tool-loop.ts');
    const context = source('packages/agent-observability/src/trajectory/typed-observation-adapters.ts');
    const runtimeTodo = source('packages/agent-runtime/src/todos/gateway-todo-state.ts');
    const gatewayTodo = source('packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts');

    expect(model).not.toContain('model.invocation.exception_captured');
    expect(tools).not.toContain('tool.call.exception_captured');
    expect(context).not.toContain('context.assembly.exception_captured');
    expect(runtimeTodo).not.toContain('todo.runtime.replace.failed');
    expect(gatewayTodo).not.toContain('todo.gateway.replace.failed');
  });

  it('does not place reusable process-fatal handlers in agent-app', () => {
    const appSources = [
      'packages/agent-app/src/index.ts',
      'packages/agent-app/src/composition/create-app.ts',
      'packages/agent-app/src/composition/app-lifecycle-composition.ts',
    ]
      .map(source)
      .join('\n');
    expect(appSources).not.toMatch(/uncaughtException|unhandledRejection/u);
  });
});

function fixture(name: string): string {
  return source(join('tests', 'fixtures', 'exception-termination', name));
}

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function logAndRethrowViolations(text: string): readonly string[] {
  const file = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined && ts.isIdentifier(node.variableDeclaration.name)) {
      const caughtName = node.variableDeclaration.name.text;
      const hasRethrow = node.block.statements.some(
        (statement) =>
          ts.isThrowStatement(statement) &&
          statement.expression !== undefined &&
          ts.isIdentifier(statement.expression) &&
          statement.expression.text === caughtName,
      );
      const hasCaughtLog = node.block.statements.some(
        (statement) =>
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          ts.isPropertyAccessExpression(statement.expression.expression) &&
          ['error', 'warn'].includes(statement.expression.expression.name.text) &&
          statement.expression.arguments.some((argument) => argument.getText(file).includes(caughtName)),
      );
      if (hasRethrow && hasCaughtLog) {
        violations.push(caughtName);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}
