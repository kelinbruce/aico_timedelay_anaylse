import type { CapabilityLocales } from '@nextagent/agent-contracts/capability';

const names = {
  Read: ['Read file', '读取文件'],
  Write: ['Save file', '保存文件'],
  Edit: ['Update file', '更新文件'],
  Glob: ['Find files', '查找文件'],
  Grep: ['Search file contents', '搜索文件内容'],
  Bash: ['Run command', '执行命令'],
  Python: ['Run program', '执行程序'],
  Rag: ['Search knowledge', '检索知识'],
  ToolSearch: ['Find available capabilities', '查找可用能力'],
  TodoWrite: ['Update task plan', '更新任务计划'],
  Cron: ['Manage scheduled tasks', '管理定时任务'],
} as const;

export function builtinToolPresentation(capabilityId: keyof typeof names): {
  readonly displayName: string;
  readonly locales: CapabilityLocales;
} {
  const [english, chinese] = names[capabilityId];
  return {
    displayName: english,
    locales: { language: { 'zh-CN': { displayName: chinese }, 'en-US': { displayName: english } } },
  };
}
