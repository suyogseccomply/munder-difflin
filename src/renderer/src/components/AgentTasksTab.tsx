import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { TASK_COLUMNS, inDateRange, type TaskDateRange } from '@shared/workspace';
import { parseTasks, type HiveTask } from './TasksKanban';

const RANGES: TaskDateRange[] = ['all', 'today', 'week', 'month'];

/** What one agent has on its plate and has finished, newest first. */
export function AgentTasksTab({ agentId }: { agentId: string }) {
  const { t, i18n } = useTranslation();
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const [range, setRange] = useState<TaskDateRange>('all');
  useEffect(() => {
    const read = () => window.cth.hiveTasks().then((raw) => setTasks(parseTasks(raw))).catch(() => { /* keep last good */ });
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => clearInterval(timer);
  }, []);
  const mine = useMemo(() => {
    const now = Date.now();
    return tasks
      .filter((x) => x.assignee === agentId && inDateRange(x.createdAt, range, now))
      .sort((a, b) => TASK_COLUMNS.indexOf(a.status) - TASK_COLUMNS.indexOf(b.status) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }, [tasks, agentId, range]);
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <select value={range} onChange={(e) => setRange(e.target.value as TaskDateRange)} aria-label={t('workspace.dateFilter')} style={{ alignSelf: 'flex-start', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', padding: '2px 4px' }}>
        {RANGES.map((r) => <option key={r} value={r}>{t(`workspace.range_${r}`)}</option>)}
      </select>
      {mine.length === 0 && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('workspace.noTasks')}</span>}
      {mine.map((task) => (
        <button key={task.id} type="button" onClick={() => openTaskDetail(task.id)} style={{ textAlign: 'start', padding: 6, border: 'none', cursor: 'pointer', background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)' }}>
          <div style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{task.title}</div>
          <div style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
            {task.id} · {t(`workspace.col_${task.status}`)}{task.createdAt && Number.isFinite(Date.parse(task.createdAt)) ? ` · ${new Date(task.createdAt).toLocaleDateString(i18n.language)}` : ''}
          </div>
        </button>
      ))}
    </div>
  );
}
