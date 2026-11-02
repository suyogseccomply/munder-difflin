import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Events = Awaited<ReturnType<typeof window.cth.integrationsLog>>;

const line = { fontSize: 11, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-mono)' } as const;

/** Last call and the recent history for one integration. `refresh` changes after
 *  a test, so a new result shows straight away. */
export function IntegrationLog({ id, refresh }: { id: string; refresh?: unknown }) {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState<Events>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void window.cth.integrationsLog(id).then(setEvents).catch(() => setEvents([]));
  }, [id, refresh]);

  const status = (n: number) => (n > 0 ? String(n) : t('integrations.logFailed'));
  const when = (at: number) => new Date(at).toLocaleString(i18n.language);

  if (events.length === 0) return <span style={line}>{t('integrations.logEmpty')}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={line}>{t('integrations.logLast', { status: status(events[0].status), when: when(events[0].at) })}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', ...line }}
        >
          {open ? t('integrations.logHide') : t('integrations.logShow', { count: events.length })}
        </button>
      </div>
      {open && events.map((e, i) => (
        <span key={i} style={line}>
          {when(e.at)} · {e.source === 'test' ? t('integrations.logTest') : e.method} · {status(e.status)} · {e.ms}ms
        </span>
      ))}
    </div>
  );
}
