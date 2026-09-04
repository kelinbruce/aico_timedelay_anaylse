// setup-package.mjs: 检查 target/ 目录是否包含 NextAgent 二进制包
// 用户需手动将二进制包解压到 target/ 目录

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const targetDir = resolve(projectRoot, 'target');

console.log('[setup] 检查 target/ 目录...');
console.log(`[setup] 路径: ${targetDir}`);
console.log('');

if (!existsSync(targetDir)) {
  console.error('[setup] 错误: target/ 目录不存在');
  console.error('');
  console.error('请将 NextAgent 二进制包解压到以下目录:');
  console.error(`  ${targetDir}`);
  console.error('');
  console.error('解压后 target/ 应包含:');
  console.error('  target/bin/          (启动脚本)');
  console.error('  target/backend/      (后端代码)');
  console.error('  target/config/       (配置文件)');
  console.error('  target/node_modules/ (含 @nextagent/* 包)');
  console.error('');
  process.exit(1);
}

const requiredDirs = ['bin', 'backend', 'config'];
const missingDirs = requiredDirs.filter((d) => !existsSync(resolve(targetDir, d)));
const presentDirs = requiredDirs.filter((d) => existsSync(resolve(targetDir, d)));

if (presentDirs.length > 0) {
  console.log(`[setup] 已存在: ${presentDirs.join(', ')}`);
}

if (missingDirs.length > 0) {
  console.warn(`[setup] 缺少: ${missingDirs.join(', ')}`);
  console.error('');
  console.error('target/ 目录不完整，请确认解压了完整的 NextAgent 二进制包');
  process.exit(1);
}

const nextagentDir = resolve(targetDir, 'node_modules', '@nextagent');
if (existsSync(nextagentDir)) {
  const pkgCount = readdirSync(nextagentDir).length;
  console.log(`[setup] @nextagent 包: ${pkgCount} 个`);
} else {
  console.warn('[setup] 警告: target/node_modules/@nextagent 不存在');
  console.warn('[setup] Vitest 测试将无法运行');
}

const startScript = resolve(targetDir, 'bin', 'nextagent-start');
if (existsSync(startScript)) {
  console.log('[setup] 启动脚本: OK');
} else {
  console.warn('[setup] 警告: bin/nextagent-start 不存在');
}

console.log('');
console.log('[setup] 就绪! 可以运行:');
console.log('  npm test          # Vitest 测试');
console.log('  npm run test:e2e  # Playwright 测试 (需先启动 NextAgent)');
console.log('');
console.log('启动 NextAgent:');
console.log(`  node ${targetDir}\\bin\\nextagent-start`);
