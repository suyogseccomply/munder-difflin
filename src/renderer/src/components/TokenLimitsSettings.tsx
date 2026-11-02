import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { LIMIT_PERIODS, cleanPeriodLimits, type LimitPeriod, type PeriodLimits, type TokenLimits } from '@shared/tokenLimits';

type Usage = Awaited<ReturnType<typeof window.cth.tokenLimitsUsage>>;

const cell: CSSProperties = { padding: '4px 6px', fontSize: 12, color: 'var(--cth-ink-700)', textAlign: 'start' };
const input: CSSProperties = { width: 110, padding: '3px 6px', border: 'none', outline: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)' };

const short = (n: number): string => (n < 1000 ? String(n) : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`);

/** Limits per period. Saved when you leave a field. A blank field means no limit. */
export function TokenLimitsSettings() {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents).filter((a) => !a.isGod && !a.isAssistant);
  const [limits, setLimits] = useState<TokenLimits>({});
  const [usage, setUsage] = useState<Usage | null>(null);

  const refresh = useCallback(() => { void window.cth.tokenLimitsUsage().then(setUsage).catch(() => setUsage(null)); }, []);
  useEffect(() => {
    void window.cth.getConfig().then((c) => setLimits(c.tokenLimits ?? {}));
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const save = (next: TokenLimits) => { setLimits(next); void window.cth.updateConfig({ tokenLimits: next }); };
  const patch = (cur: PeriodLimits | undefined, period: LimitPeriod, raw: string): PeriodLimits =>
    cleanPeriodLimits({ ...cur, [period]: raw.trim() === '' ? undefined : Number(raw) });

  const row = (key: string, label: string, cur: PeriodLimits | undefined, used: Partial<Record<LimitPeriod, number>> | undefined, onChange: (p: PeriodLimits) => void) => (
    <tr key={key}>
      <td style={{ ...cell, color: 'var(--cth-ink-900)' }}>{label}</td>
      {LIMIT_PERIODS.map((period) => (
        <td key={period} style={cell}>
          <input
            type="number"
            min="0"
            step="100000"
            // Remounts when the saved value changes, so it never shows a stale number.
            key={String(cur?.[period] ?? '')}
            defaultValue={cur?.[period] ?? ''}
            aria-label={`${label}: ${t(`tokenLimits.${period}`)}`}
            onBlur={(e) => {
              const next = patch(cur, period, e.target.value);
              if (next[period] !== cur?.[period]) onChange(next);
            }}
            style={input}
          />
          {used?.[period] !== undefined && <div style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{t('tokenLimits.used', { value: short(used[period]!) })}</div>}
        </td>
      ))}
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('tokenLimits.title')}</strong>
      <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>{t('tokenLimits.hint')}</span>
      {usage && !usage.ready && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('tokenLimits.reading')}</span>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={cell} />
              {LIMIT_PERIODS.map((p) => <th key={p} style={cell}>{t(`tokenLimits.${p}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {row('office', t('tokenLimits.office'), limits.office, usage?.office, (office) => save({ ...limits, office }))}
            {agents.map((a) => row(a.id, a.name, limits.agents?.[a.id], usage?.agents[a.id], (p) => save({ ...limits, agents: { ...limits.agents, [a.id]: p } })))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
