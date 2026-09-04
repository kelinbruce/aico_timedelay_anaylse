// 导入 Node.js 子进程模块：execSync（同步执行命令）、spawn（异步启动长驻进程）
import { execSync, spawn } from 'node:child_process';
// 导入文件系统模块：existsSync（检查文件是否存在）、readFileSync（同步读取文件内容）
import { existsSync, readFileSync } from 'node:fs';
// 导入路径拼接模块（本文件未实际使用，可忽略）
import { resolve } from 'node:path';
// 导入路径常量：包根目录、启停脚本路径、PID 文件路径、默认主机和端口
import { PACKAGE_ROOT, START_SCRIPT, STOP_SCRIPT, PID_FILE_PATH, DEFAULT_HOST, DEFAULT_PORT, BASE_URL } from './package-root.js';

// 定义 ProcessHandle 接口：启动进程后返回的结构，包含进程 ID 和标准输出/错误
export interface ProcessHandle {
  pid: number; // 子进程的 PID
  stdout: string; // 进程启动以来收集的标准输出
  stderr: string; // 进程启动以来收集的标准错误
}

// 检查 NextAgent 是否正在运行：读 PID 文件 + 向进程发信号探测
export function isRunning(): boolean {
  // PID 文件不存在，说明没有运行
  if (!existsSync(PID_FILE_PATH)) {
    return false;
  }
  try {
    // 读取 PID 文件并解析 JSON
    const state = JSON.parse(readFileSync(PID_FILE_PATH, 'utf8'));
    // pid 字段不是数字，文件格式不对
    if (typeof state.pid !== 'number') {
      return false;
    }
    // process.kill(pid, 0) 不会真的杀进程，只是探测该 PID 是否存在
    process.kill(state.pid, 0);
    return true;
  } catch {
    // 读取失败或进程不存在，返回 false
    return false;
  }
}

// 停止 NextAgent：先调 stop 脚本，再强制 kill，最后轮询确认已停止
export async function stopNextAgent(timeoutMs = 15_000): Promise<void> {
  // 第一步：执行 bin/nextagent-stop 脚本，尝试优雅停止
  try {
    execSync(`node "${STOP_SCRIPT}"`, {
      cwd: PACKAGE_ROOT, // 工作目录设为包根目录
      timeout: timeoutMs, // 超时时间
      stdio: 'pipe', // 不将子进程输出打到当前控制台
    });
  } catch {
    // 脚本执行失败也继续，下面会兜底强制杀进程
  }

  // 第二步：如果 PID 文件还在，读取 PID 并强制杀进程
  if (existsSync(PID_FILE_PATH)) {
    try {
      const state = JSON.parse(readFileSync(PID_FILE_PATH, 'utf8'));
      // PID 合法就发 SIGTERM 杀掉
      if (typeof state.pid === 'number' && state.pid > 0) {
        try {
          process.kill(state.pid);
        } catch {
          /* 进程已死 */
        }
      }
    } catch {
      /* 读取失败忽略 */
    }
  }

  // 第三步：轮询等待进程真正退出，最多等 5 秒，每 500ms 检查一次
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isRunning()) {
      break;
    } // 进程已退出，跳出循环
    await sleep(500); // 等 500ms 再查
  }
}

// 启动 NextAgent 并等待 HTTP 端口就绪
export async function startNextAgent(
  timeoutMs = 60_000, // 等待就绪的超时时间，默认 60 秒
  host = DEFAULT_HOST, // 监听地址，默认 127.0.0.1
  port = DEFAULT_PORT, // 监听端口，默认 3000
): Promise<ProcessHandle> {
  // 如果已经在运行，直接报错，防止重复启动
  if (isRunning()) {
    throw new Error('NextAgent is already running. Call stopNextAgent() first.');
  }

  // 用 Promise 包装异步启动过程，以便在就绪时 resolve 或失败时 reject
  return new Promise<ProcessHandle>((resolvePromise, reject) => {
    // 用 spawn 启动子进程，运行 bin/nextagent-start 脚本
    const proc = spawn('node', [START_SCRIPT], {
      cwd: PACKAGE_ROOT, // 工作目录
      stdio: ['ignore', 'pipe', 'pipe'], // stdin 忽略，stdout/stderr 管道捕获
      env: { ...process.env }, // 继承当前环境变量
    });

    let stdout = ''; // 累积标准输出
    let stderr = ''; // 累积标准错误

    // 监听 stdout 数据事件，拼接到字符串
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // 监听 stderr 数据事件，拼接到字符串
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // 设置超时定时器：到了时间还没就绪就 reject
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`NextAgent did not become ready within ${timeoutMs}ms.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);

    // 设置轮询定时器：每 1 秒发一次 HTTP 请求，检查服务是否就绪
    const checkReady = setInterval(async () => {
      try {
        const resp = await fetch(`http://${host}:${port}/`);
        // 状态码 < 500 说明服务已正常响应
        if (resp.status < 500) {
          clearTimeout(timer); // 取消超时定时器
          clearInterval(checkReady); // 取消轮询定时器
          resolvePromise({ pid: proc.pid!, stdout, stderr }); // 返回进程信息
        }
      } catch {
        /* 服务还没起来，等下次轮询 */
      }
    }, 1_000);

    // 监听进程启动失败事件（如命令不存在）
    proc.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to start NextAgent: ${err.message}`));
    });

    // 监听进程意外退出事件
    proc.on('exit', (code) => {
      cleanup();
      // 退出码非 0 且非 null 表示异常退出
      if (code !== 0 && code !== null) {
        reject(new Error(`NextAgent exited with code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });

    // 清理函数：取消两个定时器，防止内存泄漏
    function cleanup() {
      clearTimeout(timer);
      clearInterval(checkReady);
    }
  });
}

// 等待 NextAgent 的 HTTP 端口可访问（不负责启动，只负责等）
export async function waitForReady(timeoutMs = 30_000, host = DEFAULT_HOST, port = DEFAULT_PORT): Promise<void> {
  const deadline = Date.now() + timeoutMs; // 计算超时截止时间
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://${host}:${port}/`);
      if (resp.status < 500) {
        return;
      } // 服务可用了，直接返回
    } catch {
      /* 还没起来 */
    }
    await sleep(500); // 等 500ms 再试
  }
  // 超时还没就绪，抛异常
  throw new Error(`NextAgent not ready at http://${host}:${port} within ${timeoutMs}ms`);
}

// 工具函数：休眠指定毫秒数
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
