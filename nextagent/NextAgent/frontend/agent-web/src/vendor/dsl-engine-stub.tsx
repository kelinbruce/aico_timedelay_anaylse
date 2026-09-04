interface DSLEngineProps {
  readonly data?: readonly unknown[];
}

export function DSLEngine(_props: DSLEngineProps) {
  return <div style={{ padding: 12, color: '#999' }}>DSL 内容（本地不可预览）</div>;
}
