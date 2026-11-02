import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from '@/components/PixelButton';
import { PixelBadge } from '@/components/PixelBadge';
import { SpritePortrait } from '@/components/SpritePortrait';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { ThreadsPanel } from '@/components/ThreadsPanel';
import { TasksKanban, parseTasks, waitsOnHuman, type HiveTask } from '@/components/TasksKanban';
import { AskMeTab } from '@/components/AskMeTab';
import { TriggersTab } from '@/components/triggers/TriggersTab';
import { TriggerHistoryTab } from '@/components/triggers/TriggerHistoryTab';
import { MemoryGraphPanel } from '@/components/MemoryGraphPanel';
import { MemoryTab } from '@/components/CommandCenterPanel';
import { CapabilitiesPanel } from '@/components/CapabilitiesPanel';
import { WorkersTab } from '@/components/WorkersTab';
import { useStore, type Agent } from '@/store/store';
import { TeamScreen } from './TeamScreen';
import {
  TASK_COLUMNS,
  floorMessages,
  isStaleTask,
  shiftColumn,
  sortAgentCards,
  stageMove,
  stagedMovesMessage,
  type StagedMove,
  type TaskStatus,
  type WorkspaceScreen
} from '@shared/workspace';

const POLL_MS = 5000;
const NAV: WorkspaceScreen[] = ['tasks', 'inbox', 'automations', 'memory', 'capabilities', 'temps', 'team'];

const screenBox: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' };
const scroll: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', padding: 12 };
const muted: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' };
const card: CSSProperties = { padding: 10, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' };

/** Open questions waiting on the human, polled for the bell and stat tiles. */
function useFloorTasks(): HiveTask[] {
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  useEffect(() => {
    const read = () => window.cth.hiveTasks().then((raw) => setTasks(parseTasks(raw))).catch(() => { /* keep last good */ });
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return tasks;
}

function NavButton({ active, onClick, children, end }: { active: boolean; onClick: () => void; children: ReactNode; end?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', border: 'none', cursor: 'pointer',
        textAlign: 'start', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)',
        background: active ? 'var(--cth-paper-100)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'none'
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {end}
    </button>
  );
}

const LIVE: ReadonlySet<string> = new Set(['working', 'thinking', 'compacting']);

/** The Pro workspace: one screen at a time, chosen from the sidebar. Everything it
 *  shows comes from the same hive as Classic, so switching views loses nothing. */
export function WorkspaceShell() {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const [screen, setScreen] = useState<WorkspaceScreen>('orchestrator');
  const [room, setRoom] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const tasks = useFloorTasks();
  const waiting = tasks.filter(waitsOnHuman).length;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); setCollapsed((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const god = agents.find((a) => a.isGod);
  const others = useMemo(() => sortAgentCards(agents), [agents]);
  const openAgent = (id: string) => {
    useStore.setState({ selectedId: id });
    setRoom(id);
    setScreen('agents');
  };
  const roomAgent = agents.find((a) => a.id === room);
  // A room whose agent has gone falls back to the card grid.
  const showRoom = screen === 'agents' && !!roomAgent;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: 8 }}>
      {!collapsed && (
        <nav aria-label={t('workspace.nav')} style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', background: 'var(--cth-cream-200)', padding: 6 }}>
          <NavButton active={screen === 'orchestrator'} onClick={() => { if (god) useStore.setState({ selectedId: god.id }); setScreen('orchestrator'); }}>
            {god?.name ?? t('workspace.orchestrator')}
          </NavButton>
          {NAV.map((key) => (
            <NavButton
              key={key}
              active={screen === key}
              onClick={() => setScreen(key)}
              end={key === 'inbox' && waiting > 0
                ? <span aria-label={t('workspace.waitingCount', { count: waiting })} style={{ fontSize: 11, padding: '0 5px', background: 'var(--cth-coral)', color: 'var(--cth-on-accent)' }}>{waiting}</span>
                : undefined}
            >
              {t(`workspace.screen_${key}`)}
            </NavButton>
          ))}
          <NavButton active={false} onClick={() => void window.cth.staplerToggle()}>{t('workspace.stapler')}</NavButton>
          <div style={{ ...muted, padding: '8px 10px 2px' }}>{t('workspace.agents')}</div>
          <NavButton active={screen === 'agents' && !room} onClick={() => { setRoom(null); setScreen('agents'); }}>{t('workspace.allAgents')}</NavButton>
          {others.map((a) => (
            <NavButton
              key={a.id}
              active={showRoom && room === a.id && selectedId === a.id}
              onClick={() => openAgent(a.id)}
              end={<span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: LIVE.has(a.status) ? 'var(--cth-mint)' : 'var(--cth-ink-300)' }} />}
            >
              {a.name}
            </NavButton>
          ))}
          <NavButton active={false} onClick={() => useStore.getState().setAddAgentOpen(true)}>+ {t('workspace.addAgent')}</NavButton>
        </nav>
      )}

      <main style={screenBox}>
        {screen === 'orchestrator' && (god
          ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <StatTiles agents={agents} tasks={tasks} waiting={waiting} />
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><AgentDetailPanel agent={god} /></div>
            </div>
          : <div style={scroll}><span style={muted}>{t('workspace.noOrchestrator')}</span></div>)}
        {screen === 'agents' && (roomAgent
          ? <AgentRoom agent={roomAgent} />
          : <AgentGrid agents={others} tasks={tasks} onOpen={openAgent} />)}
        {screen === 'tasks' && <TasksScreen tasks={tasks} agents={agents} />}
        {screen === 'inbox' && <InboxScreen />}
        {screen === 'automations' && <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><TriggersTab /></div>}
        {screen === 'memory' && god && <MemoryScreen godId={god.id} />}
        {screen === 'capabilities' && <div style={scroll}><CapabilitiesPanel /></div>}
        {screen === 'temps' && <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><WorkersTab /></div>}
        {screen === 'team' && <TeamScreen />}
      </main>
    </div>
  );
}

function StatTiles({ agents, tasks, waiting }: { agents: Agent[]; tasks: HiveTask[]; waiting: number }) {
  const { t } = useTranslation();
  const [spend, setSpend] = useState<number | null>(null);
  useEffect(() => {
    const read = () => window.cth.telemetrySnapshot().then((snap) => {
      setSpend(snap.usage.reduce((sum, r) => sum + (r.usd ?? 0), 0));
    }).catch(() => setSpend(null));
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  const tile = (label: string, value: string) => (
    <div style={{ ...card, flex: 1, minWidth: 110 }}>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: 15, color: 'var(--cth-ink-900)' }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 6, padding: 6, flexWrap: 'wrap', flexShrink: 0 }}>
      {tile(t('workspace.tileSpend'), spend === null ? '–' : `$${spend.toFixed(2)}`)}
      {tile(t('workspace.tileAgents'), String(agents.filter((a) => a.ptyId).length))}
      {tile(t('workspace.tileDoing'), String(tasks.filter((x) => x.status === 'doing').length))}
      {tile(t('workspace.tileWaiting'), String(waiting))}
    </div>
  );
}

function AgentGrid({ agents, tasks, onOpen }: { agents: Agent[]; tasks: HiveTask[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  if (agents.length === 0) {
    return (
      <div style={scroll}>
        <p style={muted}>{t('workspace.noAgents')}</p>
        <PixelButton variant="primary" size="md" onClick={() => useStore.getState().setAddAgentOpen(true)}>{t('workspace.addAgent')}</PixelButton>
      </div>
    );
  }
  return (
    <div style={{ ...scroll, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, alignContent: 'start' }}>
      {agents.map((a) => {
        const ticket = tasks.find((x) => x.assignee === a.id && x.status !== 'done');
        return (
          <button key={a.id} type="button" onClick={() => onOpen(a.id)} style={{ ...card, border: 'none', cursor: 'pointer', textAlign: 'start', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--cth-font-ui)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: `var(--cth-${a.accent}-light)` }}><SpritePortrait character={a.character} scale={1} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' }}>{a.name}</div>
                <div style={muted}>{a.model ?? a.provider ?? ''}</div>
              </div>
              <PixelBadge status={a.status} />
            </div>
            {a.recentAssistantText && <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', lineHeight: '16px', maxHeight: 48, overflow: 'hidden' }}>{a.recentAssistantText}</div>}
            {ticket && <div style={muted}>{ticket.id} · {ticket.title}</div>}
            {a.contextLimit && a.contextTokens !== undefined && (
              <div style={muted}>{t('workspace.context', { pct: Math.round((a.contextTokens / a.contextLimit) * 100) })}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The conversation beside the live terminal. The panel keeps its own tabs and
 *  controls, so pause, stop, steer and 1:1 all work here as they do in Classic. */
function AgentRoom({ agent }: { agent: Agent }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ width: '38%', minWidth: 240, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', boxShadow: 'inset -1px 0 0 var(--cth-ink-300)' }}>
        <ThreadsPanel agentId={agent.id} />
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <AgentDetailPanel agent={agent} />
      </div>
    </div>
  );
}

const TASK_VIEW_KEY = 'cth.workspace.taskView';

function TasksScreen({ tasks, agents }: { tasks: HiveTask[]; agents: Agent[] }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'board' | 'list'>(() => (localStorage.getItem(TASK_VIEW_KEY) === 'list' ? 'list' : 'board'));
  const [moves, setMoves] = useState<StagedMove[]>([]);
  const [note, setNote] = useState('');
  const pick = (v: 'board' | 'list') => { setView(v); localStorage.setItem(TASK_VIEW_KEY, v); };

  const stagedTo = (task: HiveTask): TaskStatus => moves.find((m) => m.taskId === task.id)?.to ?? task.status;
  const stage = (task: HiveTask, to: TaskStatus) => setMoves((m) => stageMove(m, task, to));
  const onKey = (e: KeyboardEvent, task: HiveTask) => {
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const forward = (e.key === 'ArrowRight') !== rtl;
      stage(task, shiftColumn(stagedTo(task), forward ? 1 : -1));
    }
  };
  const send = async () => {
    const res = await window.cth.hiveSend({ to: 'god', act: 'request', subject: t('workspace.movesSubject'), body: stagedMovesMessage(moves) }, 'human');
    if (res.ok) { setMoves([]); setNote(t('workspace.movesSent')); } else setNote(res.error ?? '');
  };
  const nameOf = (id?: string) => agents.find((a) => a.id === id)?.name ?? id ?? t('workspace.unassigned');
  const now = Date.now();

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 8, flexShrink: 0 }}>
        <PixelButton size="sm" variant={view === 'board' ? 'primary' : 'secondary'} onClick={() => pick('board')}>{t('workspace.board')}</PixelButton>
        <PixelButton size="sm" variant={view === 'list' ? 'primary' : 'secondary'} onClick={() => pick('list')}>{t('workspace.list')}</PixelButton>
        <span style={{ flex: 1 }} />
        {note && <span style={muted}>{note}</span>}
        {view === 'list' && moves.length > 0 && (
          <PixelButton size="sm" variant="primary" onClick={() => void send()}>{t('workspace.sendMoves', { count: moves.length })}</PixelButton>
        )}
      </div>
      {view === 'board'
        ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><TasksKanban /></div>
        : (
          <div style={scroll}>
            <p style={{ ...muted, marginTop: 0 }}>{t('workspace.listHint')}</p>
            {tasks.length === 0 && <span style={muted}>{t('workspace.noTasks')}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tasks.map((task) => (
                <div
                  key={task.id}
                  tabIndex={0}
                  role="group"
                  aria-label={task.title}
                  onKeyDown={(e) => onKey(e, task)}
                  onDoubleClick={() => useStore.getState().openTaskDetail(task.id)}
                  style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <span style={muted}>{task.id}</span>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13, color: 'var(--cth-ink-900)' }}>{task.title}</span>
                  {waitsOnHuman(task) && <span style={{ fontSize: 11, padding: '0 5px', background: 'var(--cth-coral-light)', color: 'var(--cth-ink-900)' }}>{t('workspace.asksYou')}</span>}
                  {isStaleTask(task, now) && <span style={{ fontSize: 11, padding: '0 5px', background: 'var(--cth-lemon-light)', color: 'var(--cth-ink-900)' }}>{t('workspace.stale')}</span>}
                  <span style={muted}>{nameOf(task.assignee)}</span>
                  <select
                    value={stagedTo(task)}
                    onChange={(e) => stage(task, e.target.value as TaskStatus)}
                    aria-label={t('workspace.moveCard', { title: task.title })}
                    style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', padding: '2px 4px' }}
                  >
                    {TASK_COLUMNS.map((c) => <option key={c} value={c}>{t(`workspace.col_${c}`)}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}

function InboxScreen() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'ask' | 'floor' | 'outside'>('ask');
  const [messages, setMessages] = useState<Awaited<ReturnType<typeof window.cth.hiveMessages>>>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (tab !== 'floor') return;
    const read = () => window.cth.hiveMessages({ limit: 200 }).then(setMessages).catch(() => { /* keep last good */ });
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, [tab]);
  const shown = useMemo(() => floorMessages(messages, query), [messages, query]);
  const button = (key: 'ask' | 'floor' | 'outside') => (
    <PixelButton size="sm" variant={tab === key ? 'primary' : 'secondary'} onClick={() => setTab(key)}>{t(`workspace.inbox_${key}`)}</PixelButton>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: 8, flexShrink: 0 }}>{button('ask')}{button('floor')}{button('outside')}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'ask' && <AskMeTab />}
        {tab === 'outside' && <TriggerHistoryTab />}
        {tab === 'floor' && (
          <div style={scroll}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workspace.searchFloor')}
              aria-label={t('workspace.searchFloor')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: 'none', outline: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)', marginBottom: 8 }}
            />
            {shown.length === 0 && <span style={muted}>{t('workspace.noMessages')}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {shown.map((m) => (
                <div key={m.id} style={card}>
                  <div style={muted}>{m.from} → {m.to} · {new Date(m.created_at).toLocaleString(i18n.language)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' }}>{m.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'auto' }}>{m.body}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryScreen({ godId }: { godId: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'search' | 'graph'>('search');
  const [who, setWho] = useState<string | undefined>(undefined);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: 8, flexShrink: 0 }}>
        <PixelButton size="sm" variant={view === 'search' ? 'primary' : 'secondary'} onClick={() => setView('search')}>{t('workspace.memorySearch')}</PixelButton>
        <PixelButton size="sm" variant={view === 'graph' ? 'primary' : 'secondary'} onClick={() => setView('graph')}>{t('workspace.memoryGraph')}</PixelButton>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'search'
          ? <MemoryTab godId={godId} who={who} onWho={setWho} />
          : <MemoryGraphPanel godId={godId} onJumpToMemory={(id) => { setWho(id); setView('search'); }} />}
      </div>
    </div>
  );
}
