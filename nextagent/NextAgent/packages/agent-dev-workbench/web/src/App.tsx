import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  ExpandOutlined,
  FileSearchOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  ProfileOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Alert, Button, Collapse, Descriptions, Empty, Input, Select, Space, Spin, Statistic, Tabs, Tag, Typography } from 'antd';
import type { DescriptionsProps, TabsProps } from 'antd';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProcessGraphCanvas } from './ProcessGraphCanvas';

const apiBase = '/__nextagent/dev/workbench/api';

type AvailabilityStatus = 'available' | 'partial' | 'unavailable' | 'truncated';
type RunStatus = string;

interface DetailAvailability {
  readonly status: AvailabilityStatus;
  readonly reasonCode?: string;
}

interface AgentEntry {
  readonly agentId: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly sourceKind?: string;
  readonly agentInvocation?: string;
  readonly kind: 'agent' | 'subagent' | 'historical';
  readonly userInvocable?: boolean;
  readonly parentAgentScope?: Record<string, unknown>;
  readonly sessionCount: number;
  readonly configuration?: Record<string, unknown>;
  readonly configurationAvailability: DetailAvailability;
}

interface SessionEntry {
  readonly agentId: string;
  readonly sessionId: string;
  readonly title?: string;
  readonly parentSessionId?: string;
  readonly parentRunId?: string;
  readonly parentRequestId?: string;
  readonly updatedAt: number;
  readonly latestRunStatus?: RunStatus;
}

interface MessageEntry {
  readonly messageId: string;
  readonly requestId: string;
  readonly runId?: string;
  readonly role: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: number;
}

interface RunEntry {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly runId: string;
  readonly agentAssemblyRef: string;
  readonly parentRunId?: string;
  readonly parentRequestId?: string;
  readonly status: RunStatus;
  readonly terminalCommitState: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly rootMessageSummary?: string;
}

interface GraphNode {
  readonly actionId: string;
  readonly type: string;
  readonly label: string;
  readonly status: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly refs: Record<string, unknown>;
  readonly detailAvailability: DetailAvailability;
}

interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'sequence' | 'child';
}

interface EffectiveView {
  readonly status: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly modelIds: readonly string[];
  readonly promptTemplateRefs: readonly string[];
  readonly disclosedCapabilityIds: readonly string[];
  readonly renderedToolNames: readonly string[];
  readonly skillCapabilityIds: readonly string[];
  readonly agentCapabilityIds: readonly string[];
  readonly agentConfiguration?: Record<string, unknown>;
  readonly agentConfigurationAvailability: DetailAvailability;
}

interface GraphView {
  readonly requestRunId: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly effectiveView: EffectiveView;
  readonly detailAvailability: DetailAvailability;
}

interface ChildRunTarget {
  readonly agentId: string;
  readonly sessionId: string;
  readonly runId: string;
}

interface ActionDetail {
  readonly actionId: string;
  readonly detailAvailability: DetailAvailability;
  readonly status?: string;
  readonly timing?: {
    readonly startedAt?: number;
    readonly endedAt?: number;
    readonly durationMs?: number;
  };
  readonly refs: Record<string, unknown>;
  readonly safeSummary: Record<string, unknown>;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly promptApproximation?: PromptApproximation;
}

interface PromptApproximation {
  readonly status: 'approximate' | 'partial' | 'unavailable';
  readonly authoritative: false;
  readonly templateRef?: string;
  readonly template?: Record<string, unknown>;
  readonly selectedMessageRefs: readonly string[];
  readonly selectedMessages: ReadonlyArray<{
    readonly messageId: string;
    readonly role: string;
    readonly contentType: string;
    readonly content: string;
  }>;
  readonly missingMessageRefs: readonly string[];
  readonly renderedToolNames: readonly string[];
  readonly limitations: readonly string[];
}

interface LogEvidenceView {
  readonly entries: ReadonlyArray<{
    readonly source: string;
    readonly timestamp?: number;
    readonly message: string;
    readonly refs: Record<string, unknown>;
  }>;
  readonly detailAvailability: DetailAvailability;
}

export function App() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [conversation, setConversation] = useState<MessageEntry[]>([]);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [graph, setGraph] = useState<GraphView>();
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [detail, setDetail] = useState<ActionDetail>();
  const [logs, setLogs] = useState<LogEvidenceView>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState({ sessions: false, run: false, detail: false });
  const [error, setError] = useState<string>();
  const [fitSignal, setFitSignal] = useState(0);
  const [activeTab, setActiveTab] = useState('conversation');
  const [deepLinkUnavailable, setDeepLinkUnavailable] = useState(false);
  const detailRequestSequence = useRef(0);
  const initialTarget = useRef(readWorkbenchTarget());
  const pendingRunId = useRef<string | undefined>(initialTarget.current.runId);
  const suppressHistorySync = useRef(false);

  const loadSessions = useCallback(async () => {
    setLoading((v) => ({ ...v, sessions: true }));
    setError(undefined);
    try {
      const [agentPage, sessionPage] = await Promise.all([
        loadJson<{ readonly entries: AgentEntry[] }>('/agents'),
        loadJson<{ readonly entries: SessionEntry[] }>('/sessions'),
      ]);
      setAgents(agentPage.entries);
      setSessions(sessionPage.entries);
      const targetSessionId = initialTarget.current.sessionId;
      if (targetSessionId !== undefined) {
        const targetSession = sessionPage.entries.find((session) => session.sessionId === targetSessionId);
        if (targetSession === undefined) {
          setDeepLinkUnavailable(true);
          setError('当前会话不在可访问的调测范围内');
          setSelectedAgentId(undefined);
          setSelectedSessionId(undefined);
        } else {
          setDeepLinkUnavailable(false);
          setSelectedAgentId(targetSession.agentId);
          setSelectedSessionId(targetSession.sessionId);
        }
      }
    } catch (cause) {
      setError(readError(cause));
      setAgents([]);
      setSessions([]);
    } finally {
      setLoading((v) => ({ ...v, sessions: false }));
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    setLoading((v) => ({ ...v, run: true }));
    setError(undefined);
    setGraph(undefined);
    setDetail(undefined);
    setLogs(undefined);
    try {
      const runPage = await loadJson<{ readonly entries: RunEntry[] }>(`/runs?sessionId=${encodeURIComponent(sessionId)}`);
      setConversation([]);
      setRuns(runPage.entries);
      const requestedRunId = pendingRunId.current;
      pendingRunId.current = undefined;
      setSelectedRunId(runPage.entries.find((run) => run.runId === requestedRunId)?.runId ?? runPage.entries[0]?.runId);
    } catch (cause) {
      setError(readError(cause));
      setConversation([]);
      setRuns([]);
      setSelectedRunId(undefined);
    } finally {
      setLoading((v) => ({ ...v, run: false }));
    }
  }, []);

  const loadRun = useCallback(
    async (runId: string) => {
      detailRequestSequence.current += 1;
      setLoading((v) => ({ ...v, run: true }));
      setError(undefined);
      setDetail(undefined);
      try {
        const sessionId = runs.find((run) => run.runId === runId)?.sessionId;
        const [g, l, conv] = await Promise.all([
          loadJson<GraphView>(`/runs/${encodeURIComponent(runId)}/graph`),
          loadJson<LogEvidenceView>(`/runs/${encodeURIComponent(runId)}/logs`),
          sessionId === undefined
            ? Promise.resolve({ messages: [] as MessageEntry[] })
            : loadJson<{ readonly messages: MessageEntry[] }>(
                `/sessions/${encodeURIComponent(sessionId)}/conversation?requestRunId=${encodeURIComponent(runId)}`,
              ),
        ]);
        setGraph(g);
        setLogs(l);
        setConversation(conv.messages);
        setSelectedActionId(g.nodes[0]?.actionId);
        setFitSignal((v) => v + 1);
        setActiveTab('detail');
      } catch (cause) {
        setError(readError(cause));
        setGraph(undefined);
        setLogs(undefined);
      } finally {
        setLoading((v) => ({ ...v, run: false }));
      }
    },
    [runs],
  );

  const loadDetail = useCallback(async (runId: string, actionId: string) => {
    const requestSequence = ++detailRequestSequence.current;
    setLoading((v) => ({ ...v, detail: true }));
    setError(undefined);
    try {
      const d = await loadJson<ActionDetail>(`/runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(actionId)}`);
      const l = await loadJson<LogEvidenceView>(`/runs/${encodeURIComponent(runId)}/logs${queryFromRefs(d.refs)}`);
      if (requestSequence !== detailRequestSequence.current) {
        return;
      }
      setDetail(d);
      setLogs(l);
    } catch (cause) {
      if (requestSequence !== detailRequestSequence.current) {
        return;
      }
      setError(readError(cause));
      setDetail(undefined);
    } finally {
      if (requestSequence === detailRequestSequence.current) {
        setLoading((v) => ({ ...v, detail: false }));
      }
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!deepLinkUnavailable && (selectedAgentId === undefined || !agents.some((agent) => agent.agentId === selectedAgentId))) {
      setSelectedAgentId(agents[0]?.agentId);
    }
  }, [deepLinkUnavailable, selectedAgentId, agents]);

  const sessionsForAgent = useMemo(() => sessions.filter((s) => s.agentId === selectedAgentId), [sessions, selectedAgentId]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSessions = useMemo(
    () =>
      normalizedQuery.length === 0
        ? sessionsForAgent
        : sessionsForAgent.filter((s) => [s.sessionId, s.title ?? ''].join(' ').toLowerCase().includes(normalizedQuery)),
    [sessionsForAgent, normalizedQuery],
  );

  useEffect(() => {
    if (selectedAgentId === undefined || deepLinkUnavailable) {
      setSelectedSessionId(undefined);
      return;
    }
    const exists = selectedSessionId !== undefined && sessionsForAgent.some((s) => s.sessionId === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(sessionsForAgent[0]?.sessionId);
    }
  }, [deepLinkUnavailable, selectedAgentId, selectedSessionId, sessionsForAgent]);

  useEffect(() => {
    if (selectedSessionId) {
      void loadSession(selectedSessionId);
    } else {
      setConversation([]);
      setRuns([]);
      setSelectedRunId(undefined);
      setGraph(undefined);
      setDetail(undefined);
      setLogs(undefined);
    }
  }, [loadSession, selectedSessionId]);

  useEffect(() => {
    if (selectedRunId) {
      void loadRun(selectedRunId);
    } else {
      setGraph(undefined);
      setDetail(undefined);
      setLogs(undefined);
    }
  }, [loadRun, selectedRunId]);

  useEffect(() => {
    if (selectedRunId && selectedActionId) {
      void loadDetail(selectedRunId, selectedActionId);
    }
  }, [loadDetail, selectedActionId, selectedRunId]);

  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId);
  const selectedRun = runs.find((r) => r.runId === selectedRunId);
  const selectedAction = graph?.nodes.find((n) => n.actionId === selectedActionId);
  const openChildRun = useCallback(
    (agentId: string, sessionId: string, runId: string) => {
      replaceWorkbenchHistory(selectedSessionId, selectedRunId);
      window.history.pushState({}, '', workbenchTargetUrl(sessionId, runId));
      suppressHistorySync.current = true;
      pendingRunId.current = runId;
      setSelectedAgentId(agentId);
      setSelectedSessionId(sessionId);
      setActiveTab('detail');
    },
    [selectedRunId, selectedSessionId],
  );

  useEffect(() => {
    if (selectedSessionId === undefined) {
      return;
    }
    if (suppressHistorySync.current) {
      suppressHistorySync.current = false;
      return;
    }
    replaceWorkbenchHistory(selectedSessionId, selectedRunId);
  }, [selectedRunId, selectedSessionId]);

  useEffect(() => {
    const navigateFromHistory = () => {
      const target = readWorkbenchTarget();
      const session = sessions.find((entry) => entry.sessionId === target.sessionId);
      if (session === undefined) {
        return;
      }
      suppressHistorySync.current = true;
      pendingRunId.current = target.runId;
      setSelectedAgentId(session.agentId);
      setSelectedSessionId(session.sessionId);
    };
    window.addEventListener('popstate', navigateFromHistory);
    return () => window.removeEventListener('popstate', navigateFromHistory);
  }, [sessions]);

  return (
    <div className="wb-shell">
      <header className="wb-topbar">
        <div className="wb-breadcrumb">
          <RobotOutlined className="wb-breadcrumb-icon" />
          <Typography.Text strong>{selectedAgentId ?? '未选择智能体'}</Typography.Text>
          <span className="wb-breadcrumb-sep">/</span>
          <Typography.Text ellipsis style={{ maxWidth: 240 }}>
            {selectedSession?.title ?? '未选择会话'}
          </Typography.Text>
          {selectedRun ? (
            <>
              <span className="wb-breadcrumb-sep">/</span>
              <Typography.Text code ellipsis style={{ maxWidth: 180 }}>
                {selectedRun.runId}
              </Typography.Text>
            </>
          ) : null}
        </div>
        <Space size={8}>
          {selectedSessionId ? (
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => returnToAgentWeb(selectedSessionId)}>
              返回对话
            </Button>
          ) : null}
          {selectedRun ? <Tag color={statusColor(selectedRun.status)}>{runStatusText(selectedRun.status)}</Tag> : null}
          {graph ? <Tag color={availabilityColor(graph.effectiveView.status)}>{effectiveViewText(graph.effectiveView.status)}</Tag> : null}
          {graph ? <Tag>{graph.nodes.length} 动作</Tag> : null}
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadSessions()} loading={loading.sessions}>
            刷新
          </Button>
        </Space>
      </header>

      {error ? <Alert className="wb-error" type="error" showIcon message={error} /> : null}

      <div className="wb-body">
        <aside className="wb-sidebar">
          <div className="wb-sidebar-agent">
            <Select
              size="small"
              style={{ width: '100%' }}
              placeholder="选择智能体"
              value={selectedAgentId}
              onChange={(agentId) => {
                setSelectedAgentId(agentId);
                setActiveTab('agent');
              }}
              options={agents.map((agent) => ({
                value: agent.agentId,
                label: `${agent.kind === 'subagent' ? 'Subagent · ' : agent.kind === 'historical' ? '历史 · ' : ''}${agent.displayName ?? agent.agentId} (${agent.sessionCount})`,
              }))}
            />
          </div>
          <section className="wb-sidebar-section">
            <div className="wb-section-header">
              <span>会话</span>
              <Tag>{visibleSessions.length}</Tag>
            </div>
            <Input.Search
              size="small"
              allowClear
              placeholder="搜索会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="wb-sidebar-search"
            />
            <div className="wb-sidebar-scroll">
              {visibleSessions.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" />
              ) : (
                visibleSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className={s.sessionId === selectedSessionId ? 'wb-list-item selected' : 'wb-list-item'}
                    onClick={() => setSelectedSessionId(s.sessionId)}
                  >
                    <div className="wb-run-header">
                      <Typography.Text ellipsis style={{ fontWeight: 500 }}>
                        {s.title ?? '未命名会话'}
                      </Typography.Text>
                      {s.parentRunId ? (
                        <Tag color="cyan" className="wb-mini-tag">
                          Subagent
                        </Tag>
                      ) : null}
                    </div>
                    <div className="wb-list-item-meta">
                      <span>{formatTime(s.updatedAt)}</span>
                      {s.latestRunStatus ? (
                        <Tag color={statusColor(s.latestRunStatus)} className="wb-mini-tag">
                          {runStatusText(s.latestRunStatus)}
                        </Tag>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="wb-sidebar-section">
            <div className="wb-section-header">
              <span>运行</span>
              <Tag>{runs.length}</Tag>
            </div>
            <div className="wb-sidebar-scroll">
              {runs.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行" />
              ) : (
                runs.map((r) => {
                  const rootMsg = rootMessageForRun(r, conversation);
                  return (
                    <div
                      key={r.runId}
                      className={r.runId === selectedRunId ? 'wb-list-item selected' : 'wb-list-item'}
                      onClick={() => setSelectedRunId(r.runId)}
                    >
                      <div className="wb-run-header">
                        <Typography.Text code ellipsis style={{ fontSize: 11 }}>
                          {r.runId}
                        </Typography.Text>
                        <Tag color={statusColor(r.status)} className="wb-mini-tag">
                          {runStatusText(r.status)}
                        </Tag>
                      </div>
                      <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                        {rootMsg || '无关联消息'}
                      </Typography.Paragraph>
                      <span className="wb-list-item-meta">{formatTime(r.updatedAt)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>

        <main className="wb-graph-area">
          <div className="wb-graph-toolbar">
            <Space size={8}>
              <NodeIndexOutlined />
              <Typography.Text strong>过程图</Typography.Text>
              {graph ? <Tag color={availabilityColor(graph.detailAvailability.status)}>{availabilityText(graph.detailAvailability)}</Tag> : null}
            </Space>
            <Button size="small" icon={<ExpandOutlined />} onClick={() => setFitSignal((v) => v + 1)}>
              适配
            </Button>
          </div>
          <Spin spinning={loading.run} wrapperClassName="wb-graph-spin">
            {graph && graph.nodes.length > 0 ? (
              <ProcessGraphCanvas
                graph={graph}
                selectedActionId={selectedActionId}
                fitSignal={fitSignal}
                onSelect={(id) => {
                  setSelectedActionId(id);
                  setActiveTab('detail');
                }}
                onOpenChildRun={openChildRun}
              />
            ) : (
              <div className="wb-graph-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selectedRunId ? '正在加载过程图' : '选择运行以加载过程图'} />
              </div>
            )}
          </Spin>
        </main>

        <aside className="wb-context">
          <Tabs
            size="small"
            activeKey={activeTab}
            onChange={setActiveTab}
            className="wb-context-tabs"
            items={contextTabs({
              conversation,
              selectedRunId,
              selectedAction,
              detail,
              loadingDetail: loading.detail,
              effectiveView: graph?.effectiveView,
              onOpenChildRun: openChildRun,
              logs,
            })}
          />
        </aside>
      </div>
    </div>
  );
}

function contextTabs(args: {
  readonly conversation: readonly MessageEntry[];
  readonly selectedRunId: string | undefined;
  readonly selectedAction: GraphNode | undefined;
  readonly detail: ActionDetail | undefined;
  readonly loadingDetail: boolean;
  readonly effectiveView: EffectiveView | undefined;
  readonly onOpenChildRun: (agentId: string, sessionId: string, runId: string) => void;
  readonly logs: LogEvidenceView | undefined;
}): TabsProps['items'] {
  return [
    {
      key: 'conversation',
      label: (
        <span>
          <MessageOutlined /> 对话
        </span>
      ),
      children: <ConversationTab messages={args.conversation} />,
    },
    {
      key: 'detail',
      label: (
        <span>
          <FileSearchOutlined /> 详情
        </span>
      ),
      children: (
        <Spin spinning={args.loadingDetail}>
          {args.selectedAction ? (
            <DetailTab node={args.selectedAction} detail={args.detail} onOpenChildRun={args.onOpenChildRun} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择过程图节点" />
          )}
        </Spin>
      ),
    },
    {
      key: 'configuration',
      label: (
        <span>
          <ApartmentOutlined /> 运行配置
        </span>
      ),
      children: <EffectiveViewTab effectiveView={args.effectiveView} node={args.selectedAction} detail={args.detail} />,
    },
    {
      key: 'logs',
      label: (
        <span>
          <ProfileOutlined /> 日志
        </span>
      ),
      children: <LogsTab logs={args.logs} />,
    },
  ];
}

function ConversationTab({ messages }: { readonly messages: readonly MessageEntry[] }) {
  if (messages.length === 0) {
    return (
      <div className="wb-tab-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无对话消息" />
      </div>
    );
  }
  return (
    <div className="wb-conversation">
      {messages.map((msg) => (
        <div key={msg.messageId} className="wb-msg highlighted">
          <div className="wb-msg-header">
            <Tag color={roleColor(msg.role)} className="wb-mini-tag">
              {roleText(msg.role)}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {formatTime(msg.createdAt)}
            </Typography.Text>
          </div>
          <div className="wb-msg-content">{msg.content}</div>
        </div>
      ))}
    </div>
  );
}

function DetailTab({
  node,
  detail,
  onOpenChildRun,
}: {
  readonly node: GraphNode;
  readonly detail: ActionDetail | undefined;
  readonly onOpenChildRun: (agentId: string, sessionId: string, runId: string) => void;
}) {
  const payload = extractPayload(detail);
  const overviewItems: NonNullable<DescriptionsProps['items']> = [
    { key: 'type', label: '类型', children: actionTypeText(node.type) },
    { key: 'label', label: '标签', children: node.label },
    {
      key: 'status',
      label: '状态',
      children: <Tag color={statusColor(detail?.status ?? node.status)}>{runStatusText(detail?.status ?? node.status)}</Tag>,
    },
  ];
  if (detail?.timing?.startedAt !== undefined) {
    overviewItems.push({ key: 'start', label: '开始', children: formatTime(detail.timing.startedAt) });
  }
  if (detail?.timing?.endedAt !== undefined) {
    overviewItems.push({ key: 'end', label: '结束', children: formatTime(detail.timing.endedAt) });
  }
  if (detail?.timing?.durationMs !== undefined) {
    overviewItems.push({ key: 'dur', label: '耗时', children: formatDuration(detail.timing.durationMs) });
  }
  const refItems = buildRefItems(detail);
  const isCapabilityNode = node.type === 'capability' || node.type === 'subagent';
  const capItems = isCapabilityNode ? buildCapabilityItems(detail, payload) : [];
  const modelItems = node.type === 'model' ? buildModelItems(detail, payload) : [];
  const hookItems = node.type === 'hook' ? buildHookItems(payload) : [];
  const fieldItems = payload ? buildPayloadItems(payload, node.type) : [];

  return (
    <div className="wb-detail">
      <Descriptions title="概览" bordered size="small" column={1} items={overviewItems} />
      {refItems.length > 0 ? <Descriptions title="引用" bordered size="small" column={1} items={refItems} /> : null}
      {capItems.length > 0 ? <Descriptions title="能力信息" bordered size="small" column={1} items={capItems} /> : null}
      {node.type === 'subagent' ? <SubagentInvocationDetail detail={detail} onOpenChildRun={onOpenChildRun} /> : null}
      {node.type === 'capability' ? <CapabilityInvocationDetail detail={detail} /> : null}
      {modelItems.length > 0 ? <Descriptions title="模型调用" bordered size="small" column={1} items={modelItems} /> : null}
      {node.type === 'model' ? <ModelTokenUsage detail={detail} payload={payload} /> : null}
      {node.type === 'model' ? <PromptApproximationPanel prompt={detail?.promptApproximation} /> : null}
      {hookItems.length > 0 ? <Descriptions title="Hook 信息" bordered size="small" column={1} items={hookItems} /> : null}
      {fieldItems.length > 0 ? (
        <Descriptions title={node.type === 'model' ? '上下文与模型选项' : '安全投影字段'} bordered size="small" column={1} items={fieldItems} />
      ) : null}
      {detail && Object.keys(detail.safeSummary).length > 0 ? (
        <Collapse
          size="small"
          className="wb-detail-raw"
          items={[{ key: 'raw', label: '原始安全摘要', children: <pre className="wb-json">{JSON.stringify(detail.safeSummary, null, 2)}</pre> }]}
        />
      ) : null}
    </div>
  );
}

function CapabilityInvocationDetail({ detail }: { readonly detail: ActionDetail | undefined }) {
  const items: NonNullable<DescriptionsProps['items']> = [
    {
      key: 'input',
      label: '调用参数',
      children:
        detail?.input === undefined ? (
          <Typography.Text type="secondary">不可用</Typography.Text>
        ) : (
          <pre className="wb-json-inline">{JSON.stringify(detail.input, null, 2)}</pre>
        ),
    },
    {
      key: 'output',
      label: '调用结果',
      children:
        detail?.output === undefined ? (
          <Typography.Text type="secondary">不可用</Typography.Text>
        ) : (
          <pre className="wb-json-inline">{JSON.stringify(detail.output, null, 2)}</pre>
        ),
    },
  ];
  return <Descriptions title="工具调用" bordered size="small" column={1} items={items} />;
}

function SubagentInvocationDetail({
  detail,
  onOpenChildRun,
}: {
  readonly detail: ActionDetail | undefined;
  readonly onOpenChildRun: (agentId: string, sessionId: string, runId: string) => void;
}) {
  const input = isRecord(detail?.input) ? detail.input : undefined;
  const refs = detail?.refs;
  const target: ChildRunTarget | undefined =
    typeof refs?.childAgentId === 'string' && typeof refs.childSessionId === 'string' && typeof refs.childRunId === 'string'
      ? { agentId: refs.childAgentId, sessionId: refs.childSessionId, runId: refs.childRunId }
      : undefined;
  const items: NonNullable<DescriptionsProps['items']> = [
    { key: 'agent', label: '目标 Agent', children: stringValue(input?.agentId ?? refs?.targetAgentId) },
    {
      key: 'prompt',
      label: '委派 Prompt',
      children:
        typeof input?.prompt === 'string' ? (
          <pre className="wb-prompt-content">{input.prompt}</pre>
        ) : (
          <Typography.Text type="secondary">不可用</Typography.Text>
        ),
    },
    {
      key: 'result',
      label: '执行结果',
      children:
        detail?.output === undefined ? (
          <Typography.Text type="secondary">不可用</Typography.Text>
        ) : (
          <pre className="wb-json-inline">{JSON.stringify(detail.output, null, 2)}</pre>
        ),
    },
    {
      key: 'child',
      label: '子运行',
      children:
        target === undefined ? (
          <Typography.Text type="secondary">{typeof refs?.childLinkReasonCode === 'string' ? refs.childLinkReasonCode : '不可用'}</Typography.Text>
        ) : (
          <Space direction="vertical" size={4}>
            <Typography.Text code>{target.runId}</Typography.Text>
            <Button size="small" icon={<ApartmentOutlined />} onClick={() => onOpenChildRun(target.agentId, target.sessionId, target.runId)}>
              打开子运行
            </Button>
          </Space>
        ),
    },
  ];
  return <Descriptions title="Subagent 调用" bordered size="small" column={1} items={items} />;
}

function ModelTokenUsage({ detail, payload }: { readonly detail: ActionDetail | undefined; readonly payload: Record<string, unknown> | undefined }) {
  const usage = payload?.usage ?? detail?.refs.usage;
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
    return <Alert className="wb-token-unavailable" type="info" showIcon message="Token 消耗" description="模型提供商未返回 Token 用量" />;
  }
  const values = usage as Record<string, unknown>;
  return (
    <section className="wb-token-usage">
      <Typography.Text strong>Token 消耗</Typography.Text>
      <div className="wb-token-grid">
        <Statistic title="输入" value={typeof values.inputTokens === 'number' ? values.inputTokens : '--'} />
        <Statistic title="输出" value={typeof values.outputTokens === 'number' ? values.outputTokens : '--'} />
        <Statistic title="总计" value={typeof values.totalTokens === 'number' ? values.totalTokens : '--'} />
      </div>
    </section>
  );
}

function PromptApproximationPanel({ prompt }: { readonly prompt: PromptApproximation | undefined }) {
  if (!prompt || prompt.status === 'unavailable') {
    return <Alert type="info" showIcon message="Prompt 近似视图" description="当前模型节点没有足够的模板引用或消息引用，无法近似还原。" />;
  }
  const template = prompt.template;
  const sections = Array.isArray(template?.sections) ? template.sections.filter(isRecord) : [];
  const templateContent =
    template === undefined ? (
      <Typography.Text type="secondary">模板引用无法在当前本地 registry 中精确解析。</Typography.Text>
    ) : (
      <div className="wb-prompt-sections">
        <Descriptions
          size="small"
          column={1}
          items={[
            { key: 'ref', label: '模板引用', children: prompt.templateRef ?? '—' },
            { key: 'purpose', label: '用途', children: stringValue(template.purpose) },
            { key: 'source', label: '来源层', children: stringValue(template.sourceLayer) },
          ]}
        />
        {sections.map((section, index) => (
          <div className="wb-prompt-section" key={typeof section.id === 'string' ? section.id : index}>
            <Typography.Text strong>{typeof section.id === 'string' ? section.id : `Section ${index + 1}`}</Typography.Text>
            <pre className="wb-prompt-content">{typeof section.content === 'string' ? section.content : JSON.stringify(section, null, 2)}</pre>
          </div>
        ))}
      </div>
    );
  const messageContent =
    prompt.selectedMessages.length === 0 ? (
      <Typography.Text type="secondary">没有可关联的选中消息。</Typography.Text>
    ) : (
      <div className="wb-prompt-messages">
        {prompt.selectedMessages.map((message) => (
          <div className="wb-prompt-message" key={message.messageId}>
            <div className="wb-msg-header">
              <Tag color={roleColor(message.role)} className="wb-mini-tag">
                {roleText(message.role)}
              </Tag>
              <Typography.Text type="secondary" copyable={{ text: message.messageId }}>
                {message.messageId}
              </Typography.Text>
            </div>
            <pre className="wb-prompt-content">{message.content}</pre>
          </div>
        ))}
      </div>
    );
  const missingContent =
    prompt.missingMessageRefs.length === 0 ? null : (
      <Alert type="warning" showIcon message="缺失消息引用" description={prompt.missingMessageRefs.join(', ')} />
    );
  return (
    <section className="wb-prompt-approximation">
      <Alert
        type="warning"
        showIcon
        message={
          <Space size={8}>
            <span>Prompt 近似视图</span>
            <Tag color={prompt.status === 'approximate' ? 'gold' : 'orange'}>{prompt.status === 'approximate' ? '近似重建' : '部分可用'}</Tag>
          </Space>
        }
        description="由已有模板引用、持久化消息和工具名组成，不等同于模型提供商最终收到的请求。"
      />
      <Collapse
        size="small"
        defaultActiveKey={['template', 'messages', 'limitations']}
        items={[
          { key: 'template', label: `System 模板${prompt.templateRef ? ` · ${prompt.templateRef}` : ''}`, children: templateContent },
          {
            key: 'messages',
            label: `选中消息 (${prompt.selectedMessages.length}/${prompt.selectedMessageRefs.length})`,
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {missingContent}
                {messageContent}
              </Space>
            ),
          },
          { key: 'tools', label: `工具上下文 (${prompt.renderedToolNames.length})`, children: stringListTags(prompt.renderedToolNames) },
          {
            key: 'limitations',
            label: `无法还原 (${prompt.limitations.length})`,
            children: (
              <ul className="wb-prompt-limitations">
                {prompt.limitations.map((code) => (
                  <li key={code}>{promptLimitationText(code)}</li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </section>
  );
}

function buildCapabilityItems(
  detail: ActionDetail | undefined,
  payload: Record<string, unknown> | undefined,
): NonNullable<DescriptionsProps['items']> {
  if (!detail) {
    return [];
  }
  const refs = detail.refs;
  const items: NonNullable<DescriptionsProps['items']> = [];
  const toolName =
    typeof refs.toolName === 'string' ? refs.toolName : typeof payload?.toolName === 'string' ? (payload.toolName as string) : undefined;
  const capKind =
    typeof refs.capabilityKind === 'string'
      ? refs.capabilityKind
      : typeof payload?.capabilityKind === 'string'
        ? (payload.capabilityKind as string)
        : undefined;
  if (toolName) {
    items.push({ key: 'toolName', label: '工具名称', children: toolName });
  }
  if (capKind) {
    items.push({ key: 'capKind', label: '能力类型', children: capKind });
  }
  const argSize =
    typeof refs.argumentSizeBucket === 'string'
      ? refs.argumentSizeBucket
      : typeof payload?.argumentSizeBucket === 'string'
        ? (payload.argumentSizeBucket as string)
        : undefined;
  if (argSize) {
    items.push({ key: 'argSize', label: '参数大小', children: argSize });
  }
  const argKeysRaw = refs.argumentKeys ?? payload?.argumentKeys;
  if (Array.isArray(argKeysRaw) && argKeysRaw.every((x) => typeof x === 'string')) {
    items.push({ key: 'argKeys', label: '参数键', children: (argKeysRaw as string[]).join(', ') || '—' });
  }
  const timeout =
    typeof refs.timeoutMs === 'number' ? refs.timeoutMs : typeof payload?.timeoutMs === 'number' ? (payload.timeoutMs as number) : undefined;
  if (timeout !== undefined) {
    items.push({ key: 'timeout', label: '超时(ms)', children: String(timeout) });
  }
  if (payload) {
    const result = payload.safeResultSummary;
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      items.push({ key: 'result', label: '结果摘要', children: <pre className="wb-json-inline">{JSON.stringify(result, null, 2)}</pre> });
    }
    const ctxPatch = payload.contextPatchSummary;
    if (typeof ctxPatch === 'object' && ctxPatch !== null && !Array.isArray(ctxPatch)) {
      items.push({ key: 'ctxPatch', label: '上下文补丁', children: <pre className="wb-json-inline">{JSON.stringify(ctxPatch, null, 2)}</pre> });
    }
    if (typeof payload.generatedMessageCount === 'number') {
      items.push({ key: 'msgCount', label: '生成消息数', children: String(payload.generatedMessageCount) });
    }
    if (typeof payload.artifactCount === 'number') {
      items.push({ key: 'artCount', label: '产物数', children: String(payload.artifactCount) });
    }
    if (typeof payload.resultRefPresent === 'boolean') {
      items.push({ key: 'resultRef', label: '结果引用', children: payload.resultRefPresent ? '有' : '无' });
    }
    if (typeof payload.fallbackTriggered === 'boolean' && payload.fallbackTriggered) {
      items.push({ key: 'fallback', label: 'fallback 已触发', children: '是' });
    }
  }
  return items;
}

function buildModelItems(detail: ActionDetail | undefined, payload: Record<string, unknown> | undefined): NonNullable<DescriptionsProps['items']> {
  if (!detail) {
    return [];
  }
  const items: NonNullable<DescriptionsProps['items']> = [];
  const p = payload ?? {};
  if (typeof p.modelId === 'string') {
    items.push({ key: 'modelId', label: '模型 ID', children: p.modelId });
  }
  if (typeof p.finishReason === 'string') {
    items.push({ key: 'finish', label: '完成原因', children: p.finishReason });
  }
  if (typeof p.toolCallCount === 'number') {
    items.push({ key: 'toolCalls', label: '工具调用数', children: String(p.toolCallCount) });
  }
  if (typeof p.safeErrorCode === 'string') {
    items.push({ key: 'errCode', label: '错误码', children: p.safeErrorCode });
  }
  if (typeof p.safeErrorCategory === 'string') {
    items.push({ key: 'errCat', label: '错误类别', children: p.safeErrorCategory });
  }
  const effectiveView = extractSummaryObject(detail?.safeSummary.effectiveView);
  items.push(
    { key: 'tools', label: '工具', children: stringListTags(effectiveView?.renderedToolNames) },
    { key: 'skills', label: 'Skill', children: stringListTags(effectiveView?.skillCapabilityIds) },
    { key: 'agents', label: 'Agent', children: stringListTags(effectiveView?.agentCapabilityIds) },
  );
  return items;
}

function buildHookItems(payload: Record<string, unknown> | undefined): NonNullable<DescriptionsProps['items']> {
  if (!payload) {
    return [];
  }
  const items: NonNullable<DescriptionsProps['items']> = [];
  const fields: ReadonlyArray<[string, string, (value: unknown) => ReactNode]> = [
    ['stage', 'Hook 点', (value) => hookStageText(String(value))],
    ['hookId', 'Hook ID', String],
    ['hookInvocationId', '调用 ID', String],
    ['kind', '类型', String],
    ['executionStrategy', '执行策略', String],
    ['outcome', '结果', String],
    ['idempotencyKey', '幂等键', String],
  ];
  for (const [key, label, render] of fields) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      items.push({ key, label, children: render(value) });
    }
  }
  if (isRecord(payload.effects)) {
    items.push({ key: 'effects', label: '影响', children: <pre className="wb-json-inline">{JSON.stringify(payload.effects, null, 2)}</pre> });
  }
  return items;
}

function EffectiveViewTab({
  effectiveView,
  node,
  detail,
}: {
  readonly effectiveView: EffectiveView | undefined;
  readonly node: GraphNode | undefined;
  readonly detail: ActionDetail | undefined;
}) {
  if (!effectiveView || effectiveView.status === 'unavailable') {
    return (
      <div className="wb-tab-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生效视图不可用" />
      </div>
    );
  }
  const items: NonNullable<DescriptionsProps['items']> = [
    { key: 'status', label: '状态', children: <Tag color={availabilityColor(effectiveView.status)}>{effectiveViewText(effectiveView.status)}</Tag> },
    { key: 'agent', label: '智能体', children: effectiveView.agentId ?? '—' },
    { key: 'version', label: '版本', children: effectiveView.agentVersion ?? '—' },
    { key: 'assembly', label: '装配引用', children: effectiveView.agentAssemblyRef ?? '—' },
  ];
  const payload = extractPayload(detail);
  const modelIds = node?.type === 'model' && typeof payload?.modelId === 'string' ? [payload.modelId] : [];
  const promptTemplateRefs = node?.type === 'model' && typeof payload?.promptTemplateRef === 'string' ? [payload.promptTemplateRef] : [];
  const renderedToolNames =
    node?.type === 'model' && Array.isArray(payload?.renderedToolNames)
      ? payload.renderedToolNames.filter((value): value is string => typeof value === 'string')
      : [];
  const nodeItems: NonNullable<DescriptionsProps['items']> = [];
  if (node?.type === 'subagent') {
    nodeItems.push(
      { key: 'target', label: '目标 Agent', children: stringValue(detail?.refs.targetAgentId) },
      { key: 'child', label: '子运行', children: stringValue(detail?.refs.childRunId) },
      { key: 'link', label: '关联状态', children: stringValue(detail?.refs.childLinkAvailability) },
    );
  } else if (node?.type === 'capability') {
    nodeItems.push(
      { key: 'capability', label: '能力', children: stringValue(payload?.capabilityId ?? payload?.toolName) },
      { key: 'kind', label: '类型', children: stringValue(payload?.capabilityKind) },
    );
  }
  return (
    <div className="wb-effective">
      <Descriptions title="运行 Agent" bordered size="small" column={1} items={items} />
      <FieldList title="模型 ID" values={effectiveView.modelIds} />
      {node?.type === 'model' ? (
        <section className="wb-node-effective">
          <Typography.Text strong>当前模型节点</Typography.Text>
          <FieldList title="本次模型 ID" values={modelIds} />
          <FieldList title="提示词模板" values={promptTemplateRefs} />
          <FieldList title="工具" values={renderedToolNames} />
          <FieldList title="Skill" values={effectiveView.skillCapabilityIds} />
          <FieldList title="Agent" values={effectiveView.agentCapabilityIds} />
        </section>
      ) : nodeItems.length > 0 ? (
        <Descriptions title="当前节点" bordered size="small" column={1} items={nodeItems} />
      ) : null}
      <AgentConfigurationPanel effectiveView={effectiveView} />
    </div>
  );
}

function AgentConfigurationPanel({ effectiveView }: { readonly effectiveView: EffectiveView }) {
  return <AgentConfigurationContent configuration={effectiveView.agentConfiguration} availability={effectiveView.agentConfigurationAvailability} />;
}

function AgentConfigurationContent({
  configuration,
  availability,
}: {
  readonly configuration: Record<string, unknown> | undefined;
  readonly availability: DetailAvailability;
}) {
  if (!configuration) {
    return <Alert type="info" showIcon message="Agent 完整配置不可用" description={availabilityText(availability)} />;
  }
  const summaryItems: NonNullable<DescriptionsProps['items']> = [
    { key: 'displayName', label: '名称', children: stringValue(configuration.displayName) },
    { key: 'description', label: '说明', children: stringValue(configuration.description) },
    { key: 'agentType', label: '类型', children: stringValue(configuration.agentType) },
    { key: 'sourceKind', label: '来源', children: stringValue(configuration.sourceKind) },
    { key: 'userInvocable', label: '用户可调用', children: booleanValue(configuration.userInvocable) },
    { key: 'agentInvocation', label: 'Agent 调用策略', children: stringValue(configuration.agentInvocation) },
  ];
  const sections = [
    ['runtime', '运行设置', configuration.runtimeSettings],
    ['workspace', '工作区策略', configuration.workspacePolicy],
    ['capabilities', '能力绑定', configuration.capabilityBindings],
    ['routing', '路由', configuration.routing],
    ['hooks', 'Hooks', configuration.hooks],
    ['policies', '策略', configuration.policies],
    ['raw', '完整 JSON', configuration],
  ]
    .filter((entry) => entry[2] !== undefined)
    .map(([key, label, value]) => ({
      key: String(key),
      label: String(label),
      children: <pre className="wb-json">{JSON.stringify(value, null, 2)}</pre>,
    }));
  return (
    <section className="wb-agent-configuration">
      <Descriptions title="Agent 完整配置" bordered size="small" column={1} items={summaryItems} />
      <Collapse size="small" items={sections} />
    </section>
  );
}

function LogsTab({ logs }: { readonly logs: LogEvidenceView | undefined }) {
  if (!logs || logs.entries.length === 0) {
    return (
      <div className="wb-tab-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={availabilityText(logs?.detailAvailability)} />
      </div>
    );
  }
  return (
    <div className="wb-logs">
      {logs.entries.map((entry, i) => (
        <div key={i} className="wb-log-entry">
          <div className="wb-msg-header">
            <Tag className="wb-mini-tag">{logSourceText(entry.source)}</Tag>
            {entry.timestamp ? (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {formatTime(entry.timestamp)}
              </Typography.Text>
            ) : null}
          </div>
          <pre className="wb-log-msg">{entry.message}</pre>
        </div>
      ))}
    </div>
  );
}

function FieldList({ title, values }: { readonly title: string; readonly values: readonly string[] }) {
  if (values.length === 0) {
    return null;
  }
  return (
    <div className="wb-field-list">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {title}
      </Typography.Text>
      <div className="wb-field-tags">
        {values.map((v) => (
          <Tag key={v}>{v}</Tag>
        ))}
      </div>
    </div>
  );
}

const payloadLabels: Record<string, string> = {
  modelId: '模型 ID',
  modelOptionSummary: '模型选项',
  providerOptionKeys: '提供商选项',
  finishReason: '完成原因',
  toolCallCount: '工具调用数',
  safeErrorCode: '错误码',
  safeErrorCategory: '错误类别',
  capabilityKind: '能力类型',
  providerId: '提供者ID',
  version: '版本',
  toolName: '工具名称',
  stepId: '步骤ID',
  timeoutMs: '超时(ms)',
  argumentKeys: '参数键',
  argumentSizeBucket: '参数大小',
  generatedMessageCount: '生成消息数',
  artifactCount: '产物数',
  resultRefPresent: '结果引用',
  contextPatchSummary: '上下文补丁',
  fallbackTriggered: 'fallback 已触发',
  safeResultSummary: '结果摘要',
  promptTemplateRef: '提示词模板',
  promptTemplateVersion: '模板版本',
  selectedMessageRefs: '选中消息',
  disclosedCapabilityIds: '实际披露能力',
  modelMessageCount: '模型消息数',
  renderedToolNames: '工具',
  contextBudgetEvidence: '上下文预算',
  compressionEvidence: '压缩证据',
  degradationReasonCodes: '降级原因',
  policyId: '策略ID',
  policyVersion: '策略版本',
  policyDomain: '策略域',
  policyPoint: '策略点',
  laneKind: '队列类型',
  queueDepthBucket: '队列深度',
  schedulerDecisionCode: '调度决策',
  strategyCode: '压缩策略',
  beforeTokenEstimateBucket: '压缩前Token',
  afterTokenEstimateBucket: '压缩后Token',
  retainedMessageCount: '保留消息数',
  droppedMessageCount: '丢弃消息数',
  summaryMessageId: '摘要消息ID',
  reasonCode: '原因码',
  durationMs: '耗时(ms)',
};

const scalarKeys = [
  'modelId',
  'modelMessageCount',
  'finishReason',
  'toolCallCount',
  'safeErrorCode',
  'safeErrorCategory',
  'capabilityKind',
  'providerId',
  'version',
  'toolName',
  'stepId',
  'timeoutMs',
  'argumentSizeBucket',
  'generatedMessageCount',
  'artifactCount',
  'resultRefPresent',
  'fallbackTriggered',
  'promptTemplateRef',
  'promptTemplateVersion',
  'policyId',
  'policyVersion',
  'policyDomain',
  'policyPoint',
  'laneKind',
  'queueDepthBucket',
  'schedulerDecisionCode',
  'strategyCode',
  'beforeTokenEstimateBucket',
  'afterTokenEstimateBucket',
  'retainedMessageCount',
  'droppedMessageCount',
  'summaryMessageId',
  'reasonCode',
  'durationMs',
  'agentAssemblyHash',
  'agentAssemblySnapshotRef',
] as const;

const arrayKeys = [
  'providerOptionKeys',
  'argumentKeys',
  'disclosedCapabilityIds',
  'renderedToolNames',
  'selectedMessageRefs',
  'degradationReasonCodes',
] as const;

const objectKeys = [
  'modelOptionSummary',
  'contextBudgetEvidence',
  'compressionEvidence',
  'contextPatchSummary',
  'safeResultSummary',
  'gatewayOperations',
  'budgetEvidence',
] as const;

function extractPayload(detail: ActionDetail | undefined): Record<string, unknown> | undefined {
  if (!detail) {
    return undefined;
  }
  const p = detail.refs.payload;
  return typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : undefined;
}

function buildRefItems(detail: ActionDetail | undefined): NonNullable<DescriptionsProps['items']> {
  if (!detail) {
    return [];
  }
  const refs = detail.refs;
  const items: NonNullable<DescriptionsProps['items']> = [];
  if (typeof refs.eventId === 'string') {
    items.push({ key: 'eventId', label: '事件ID', children: refs.eventId });
  }
  if (typeof refs.toolCallId === 'string') {
    items.push({ key: 'toolCallId', label: '工具调用ID', children: refs.toolCallId });
  }
  if (typeof refs.sequence === 'number') {
    items.push({ key: 'seq', label: '序列', children: String(refs.sequence) });
  }
  if (typeof refs.requestContextId === 'string') {
    items.push({ key: 'ctx', label: '上下文ID', children: refs.requestContextId });
  }
  if (typeof refs.runId === 'string') {
    items.push({ key: 'runId', label: '运行ID', children: refs.runId });
  }
  if (typeof refs.requestId === 'string') {
    items.push({ key: 'reqId', label: '请求ID', children: refs.requestId });
  }
  if (typeof refs.parentEventId === 'string') {
    items.push({ key: 'parent', label: '父事件', children: refs.parentEventId });
  }
  if (typeof refs.gatewayKind === 'string') {
    items.push({ key: 'gwKind', label: '网关类型', children: refs.gatewayKind });
  }
  if (typeof refs.operation === 'string') {
    items.push({ key: 'op', label: '操作', children: refs.operation });
  }
  return items;
}

function buildPayloadItems(payload: Record<string, unknown>, actionType: string): NonNullable<DescriptionsProps['items']> {
  const items: NonNullable<DescriptionsProps['items']> = [];
  const omitted = dedicatedPayloadKeys(actionType);
  for (const key of scalarKeys) {
    if (omitted.has(key)) {
      continue;
    }
    const v = payload[key];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      items.push({ key, label: payloadLabels[key] ?? key, children: String(v) });
    }
  }
  for (const key of arrayKeys) {
    if (omitted.has(key)) {
      continue;
    }
    const v = payload[key];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      items.push({ key, label: payloadLabels[key] ?? key, children: v.join(', ') || '—' });
    }
  }
  for (const key of objectKeys) {
    if (omitted.has(key)) {
      continue;
    }
    const v = payload[key];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      items.push({ key, label: payloadLabels[key] ?? key, children: <pre className="wb-json-inline">{JSON.stringify(v, null, 2)}</pre> });
    }
  }
  return items;
}

function dedicatedPayloadKeys(actionType: string): ReadonlySet<string> {
  if (actionType === 'model') {
    return new Set([
      'modelId',
      'finishReason',
      'toolCallCount',
      'safeErrorCode',
      'safeErrorCategory',
      'disclosedCapabilityIds',
      'renderedToolNames',
      'promptTemplateRef',
      'promptTemplateVersion',
      'selectedMessageRefs',
    ]);
  }
  if (actionType === 'capability' || actionType === 'subagent') {
    return new Set([
      'capabilityKind',
      'toolName',
      'timeoutMs',
      'argumentKeys',
      'argumentSizeBucket',
      'generatedMessageCount',
      'artifactCount',
      'resultRefPresent',
      'fallbackTriggered',
      'contextPatchSummary',
      'safeResultSummary',
    ]);
  }
  if (actionType === 'hook') {
    return new Set(['hookInvocationId', 'hookId', 'stage', 'kind', 'executionStrategy', 'outcome', 'idempotencyKey', 'durationMs', 'effects']);
  }
  return new Set();
}

function extractSummaryObject(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringListTags(value: unknown): ReactNode {
  if (!Array.isArray(value)) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  const values = value.filter((entry): entry is string => typeof entry === 'string');
  if (values.length === 0) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  return (
    <Space size={[4, 4]} wrap>
      {values.map((entry) => (
        <Tag key={entry}>{entry}</Tag>
      ))}
    </Space>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '—';
}

function booleanValue(value: unknown): string {
  return typeof value === 'boolean' ? (value ? '是' : '否') : '—';
}

function promptLimitationText(code: string): string {
  const labels: Record<string, string> = {
    DYNAMIC_TEMPLATE_VARIABLES_NOT_REPLAYED: '动态模板变量未重放',
    CAPABILITY_GENERATED_MESSAGES_NOT_RECONSTRUCTED: '能力生成消息未重建',
    ATTACHMENT_CONTENT_NOT_RECONSTRUCTED: '附件内容未重建',
    TOOL_SCHEMAS_NOT_RECONSTRUCTED: '完整工具 Schema 未重建',
    RENDER_TIME_TRANSFORMS_NOT_REPLAYED: '渲染时截断、压缩等变换未重放',
    BEFORE_MODEL_INVOKE_HOOK_MUTATIONS_NOT_RECONSTRUCTED: 'BEFORE_MODEL_INVOKE Hook 修改未重建',
    PROMPT_TEMPLATE_UNRESOLVABLE: '模板引用无法在当前 registry 中精确解析',
    SELECTED_MESSAGE_MISSING: '部分选中消息引用已缺失',
  };
  return labels[code] ?? code;
}

function hookStageText(value: string): string {
  return (
    (
      {
        BEFORE_REQUEST_ACCEPT: '请求接收前',
        BEFORE_PLANNING: '规划前',
        BEFORE_MODEL_INVOKE: '模型调用前',
        AFTER_MODEL_RESULT: '模型结果后',
        BEFORE_CAPABILITY_INVOKE: '能力调用前',
        AFTER_CAPABILITY_RESULT: '能力结果后',
        BEFORE_CONTEXT_COMPACT: '上下文压缩前',
        AFTER_CONTEXT_COMPACT: '上下文压缩后',
        BEFORE_AGENT_TERMINAL: 'Agent 终态前',
      } as Record<string, string>
    )[value] ?? value
  );
}

function rootMessageForRun(run: RunEntry, messages: readonly MessageEntry[]): string {
  if (run.rootMessageSummary && run.rootMessageSummary.length > 0) {
    return run.rootMessageSummary;
  }
  const msg =
    messages.find((m) => m.role === 'USER' && (m.requestId === run.requestId || m.runId === run.runId)) ??
    messages.find((m) => m.requestId === run.requestId || m.runId === run.runId);
  return msg?.content ?? '';
}

function returnToAgentWeb(sessionId: string): void {
  window.location.assign(`/#/session/${encodeURIComponent(sessionId)}`);
}

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`);
  if (!res.ok) {
    throw new Error(`查询失败: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function readWorkbenchTarget(): { readonly sessionId?: string; readonly runId?: string } {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('sessionId')?.trim();
  const runId = params.get('runId')?.trim();
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(runId ? { runId } : {}),
  };
}

function workbenchTargetUrl(sessionId: string, runId?: string): string {
  const params = new URLSearchParams({ sessionId });
  if (runId) {
    params.set('runId', runId);
  }
  return `/__nextagent/dev/workbench?${params.toString()}`;
}

function replaceWorkbenchHistory(sessionId: string | undefined, runId: string | undefined): void {
  if (sessionId === undefined) {
    return;
  }
  window.history.replaceState({}, '', workbenchTargetUrl(sessionId, runId));
}

function queryFromRefs(refs: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const key of ['requestId', 'sessionId', 'agentId', 'agentVersion', 'requestContextId', 'capabilityInvocationId']) {
    const v = refs[key];
    if (typeof v === 'string' && v.length > 0) {
      params.set(key, v);
    }
  }
  const q = params.toString();
  return q.length > 0 ? `?${q}` : '';
}

function availabilityText(a: DetailAvailability | undefined): string {
  if (!a) {
    return '不可用';
  }
  return a.reasonCode ? `${availabilityStatusText(a.status)}: ${a.reasonCode}` : availabilityStatusText(a.status);
}

function availabilityStatusText(s: string): string {
  switch (s) {
    case 'available':
      return '可用';
    case 'partial':
      return '部分';
    case 'unavailable':
      return '不可用';
    case 'truncated':
      return '截断';
    default:
      return s;
  }
}

function statusColor(s: string | undefined): string {
  const n = (s ?? '').toLowerCase();
  if (n.includes('failed')) {
    return 'red';
  }
  if (n.includes('cancel')) {
    return 'default';
  }
  if (n.includes('running') || n.includes('executing') || n.includes('queued') || n.includes('partial')) {
    return 'gold';
  }
  if (n.includes('completed') || n.includes('available') || n.includes('committed')) {
    return 'green';
  }
  return 'blue';
}

function availabilityColor(s: string | undefined): string {
  if (s === 'unavailable') {
    return 'red';
  }
  if (s === 'partial' || s === 'current-view' || s === 'truncated') {
    return 'gold';
  }
  return 'green';
}

function roleColor(role: string): string {
  switch (role.toUpperCase()) {
    case 'USER':
      return 'blue';
    case 'ASSISTANT':
      return 'green';
    case 'SYSTEM':
      return 'default';
    case 'TOOL':
      return 'purple';
    default:
      return 'default';
  }
}

function roleText(role: string): string {
  switch (role.toUpperCase()) {
    case 'USER':
      return '用户';
    case 'ASSISTANT':
      return '助手';
    case 'SYSTEM':
      return '系统';
    case 'TOOL':
      return '工具';
    default:
      return role;
  }
}

function runStatusText(s: string | undefined): string {
  if (!s) {
    return '未知';
  }
  const map: Record<string, string> = {
    COMPLETED: '已完成',
    FAILED: '已失败',
    CANCELED: '已取消',
    EXECUTING: '执行中',
    QUEUED: '排队中',
    ACCEPTED: '已接受',
    SUPERSEDED: '已替代',
    COMMITTED: '已提交',
  };
  return map[s] ?? s;
}

function actionTypeText(t: string): string {
  const map: Record<string, string> = {
    request: '请求',
    scheduler: '调度',
    context: '上下文',
    context_compaction: '上下文压缩',
    model: '模型调用',
    capability: '能力调用',
    subagent: 'Subagent 调用',
    hook: '钩子',
    policy: '策略',
    gateway: '网关',
    stream: '流',
    terminal: '终态',
  };
  return map[t] ?? t;
}

function effectiveViewText(s: string | undefined): string {
  switch (s) {
    case 'reconstructed':
      return '已重建';
    case 'current-view':
      return '当前视图';
    case 'partial':
      return '部分';
    case 'unavailable':
      return '不可用';
    default:
      return s ?? '—';
  }
}

function logSourceText(s: string): string {
  switch (s) {
    case 'runtime-diagnostic-log':
      return '运行诊断';
    case 'structured-safe-log':
      return '结构化日志';
    default:
      return s;
  }
}

function formatTime(v: number | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return '未知';
  }
  return new Date(v).toLocaleString('zh-CN');
}

function formatDuration(v: number | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return '不可用';
  }
  return `${v} 毫秒`;
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message : '工作台查询失败';
}
