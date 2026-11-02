import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';

/** Hands search results to an agent through its normal inbox. */
export function SendToAgent({ text, query }: { text: string; query: string }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const [note, setNote] = useState('');

  const send = async (id: string) => {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const res = await window.cth.hiveSend(
      { to: agent.isGod ? 'god' : id, act: 'inform', subject: t('commandCenter.sendSubject', { query: query.slice(0, 80) }), body: text },
      'human'
    );
    setNote(res.ok ? t('commandCenter.sent', { name: agent.name }) : (res.error ?? ''));
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
      <select
        value=""
        onChange={(e) => { if (e.target.value) void send(e.target.value); }}
        aria-label={t('commandCenter.sendPick')}
        style={{ padding: '3px 6px', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}
      >
        <option value="">{t('commandCenter.sendPick')}</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {note && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{note}</span>}
    </div>
  );
}
