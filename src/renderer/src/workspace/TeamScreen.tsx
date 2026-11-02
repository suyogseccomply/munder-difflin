import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from '@/components/PixelButton';
import { useStore } from '@/store/store';

type State = Extract<Awaited<ReturnType<typeof window.cth.teamsState>>, { ok: true }>['value'];
type PeerRow = State['peers'][number];

const scroll: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 };
const muted: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' };
const box: CSSProperties = { padding: 10, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', display: 'flex', flexDirection: 'column', gap: 6 };
const input: CSSProperties = { padding: '5px 8px', border: 'none', outline: 'none', minWidth: 0, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)' };
const code: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 12, overflowWrap: 'anywhere', color: 'var(--cth-ink-900)' };

/** One plain chat per teammate. Messages are end-to-end encrypted through the relay. */
export function TeamScreen() {
  const { t } = useTranslation();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [relay, setRelay] = useState('');
  const [invite, setInvite] = useState('');
  const [join, setJoin] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await window.cth.teamsState();
    if (res.ok) { setState(res.value); setRelay((r) => r || res.value.relayUrl); } else setError(res.error);
  }, []);
  useEffect(() => {
    void refresh();
    const off = window.cth.onTeamsChanged(() => void refresh());
    const timer = setInterval(() => void refresh(), 5000);
    return () => { off(); clearInterval(timer); };
  }, [refresh]);

  const act = async <T,>(fn: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>): Promise<T | null> => {
    setError('');
    const res = await fn();
    if (!res.ok) { setError(res.error); return null; }
    await refresh();
    return res.value;
  };

  if (!state) return <div style={scroll}><span style={muted}>{error || t('team.loading')}</span></div>;
  const current = state.peers.find((p) => p.officeId === open);

  return (
    <div style={scroll}>
      <div style={box}>
        <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('team.relay')}</strong>
        <span style={muted}>{t('team.relayHint')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://relay.example.com" aria-label={t('team.relay')} dir="ltr" style={{ ...input, flex: 1 }} />
          <PixelButton size="sm" variant="secondary" onClick={() => void act(() => window.cth.teamsSetRelay(relay))}>{t('team.save')}</PixelButton>
        </div>
        {state.lastError && <span style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{t('team.relayError', { error: state.lastError })}</span>}
      </div>

      <div style={box}>
        <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('team.addTeammate')}</strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <PixelButton size="sm" variant="secondary" disabled={!state.relayUrl} onClick={() => void act(() => window.cth.teamsCreateInvite()).then((c) => { if (c) setInvite(c); })}>{t('team.createInvite')}</PixelButton>
          <input value={join} onChange={(e) => setJoin(e.target.value)} placeholder={t('team.pasteCode')} aria-label={t('team.pasteCode')} dir="ltr" style={{ ...input, flex: 1, minWidth: 180 }} />
          <PixelButton size="sm" variant="secondary" disabled={!join.trim() || !state.relayUrl} onClick={() => void act(() => window.cth.teamsJoinInvite(join)).then((p) => { if (p) { setJoin(''); setOpen(p.officeId); } })}>{t('team.join')}</PixelButton>
        </div>
        {invite && (
          <>
            <span style={muted}>{t('team.inviteHint')}</span>
            <code dir="ltr" style={code}>{invite}</code>
          </>
        )}
      </div>

      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{error}</span>}

      {state.peers.length === 0 && <span style={muted}>{t('team.noTeammates')}</span>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {state.peers.map((p) => {
          const waiting = p.history.filter((m) => m.decision === 'pending').length;
          return (
            <PixelButton key={p.officeId} size="sm" variant={open === p.officeId ? 'primary' : 'secondary'} onClick={() => setOpen(p.officeId)}>
              {p.name}{waiting ? ` (${waiting})` : ''}
            </PixelButton>
          );
        })}
      </div>
      {current && <Chat peer={current} act={act} />}
    </div>
  );
}

function Chat({ peer, act }: {
  peer: PeerRow;
  act: <T>(fn: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>) => Promise<T | null>;
}) {
  const { t, i18n } = useTranslation();
  const agents = useStore((s) => s.agents);
  const [text, setText] = useState('');
  const [password, setPassword] = useState('');
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});

  const answerer = peer.answeredBy === 'you' ? '' : peer.answeredBy.agentId;
  const send = () => void act(() => window.cth.teamsSend(peer.officeId, text)).then((m) => { if (m) setText(''); });
  const sendFile = (folder: boolean) => void act(() => window.cth.teamsSendFile(peer.officeId, folder)).then((r) => { if (r) setPassword(r.password); });

  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ flex: 1, fontSize: 13, color: 'var(--cth-ink-900)' }}>{peer.name}</strong>
        <label style={{ ...muted, display: 'flex', gap: 4, alignItems: 'center' }}>
          {t('team.whoAnswers')}
          <select value={answerer} onChange={(e) => void act(() => window.cth.teamsSetAnswerer(peer.officeId, e.target.value || null))} style={input}>
            <option value="">{t('team.you')}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <PixelButton size="sm" variant="ghost" onClick={() => void act(() => window.cth.teamsRemovePeer(peer.officeId))}>{t('team.remove')}</PixelButton>
      </div>
      <span style={muted}>{t('team.fingerprint')} <code dir="ltr" style={code}>{peer.fingerprint}</code></span>
      {answerer && <span style={muted}>{t('team.agentHint')}</span>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflow: 'auto' }}>
        {peer.history.map((m) => (
          <div key={m.id} style={{ alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '5px 8px', background: m.direction === 'out' ? 'var(--cth-paper-100)' : 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
            <div style={{ fontSize: 13, color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div>
            <div style={muted}>{new Date(m.at).toLocaleString(i18n.language)}</div>
            {m.decision === 'pending' && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <PixelButton size="sm" variant="primary" onClick={() => void act(() => window.cth.teamsDecide(m.id, true))}>{t('team.approve')}</PixelButton>
                <PixelButton size="sm" variant="secondary" onClick={() => void act(() => window.cth.teamsDecide(m.id, false))}>{t('team.reject')}</PixelButton>
              </div>
            )}
            {m.decision === 'approved' && <div style={muted}>{t('team.approved')}</div>}
            {m.decision === 'rejected' && <div style={muted}>{t('team.rejected')}</div>}
            {m.file && m.direction === 'in' && (saved[m.id]
              ? <div style={muted}>{saved[m.id]}</div>
              : (
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    autoComplete="off"
                    value={passwords[m.id] ?? ''}
                    onChange={(e) => setPasswords((cur) => ({ ...cur, [m.id]: e.target.value }))}
                    placeholder={t('team.filePassword')}
                    aria-label={t('team.filePassword')}
                    style={{ ...input, width: 170 }}
                  />
                  <PixelButton
                    size="sm"
                    variant="secondary"
                    disabled={!passwords[m.id]}
                    onClick={() => void act(() => window.cth.teamsDownloadFile(m.file!.id, passwords[m.id])).then((paths) => { if (paths) setSaved((cur) => ({ ...cur, [m.id]: t('team.savedTo', { path: paths[0] }) })); })}
                  >
                    {t('team.download')}
                  </PixelButton>
                  <span style={{ ...muted, width: '100%' }}>{t('team.oneDownload')}</span>
                </div>
              ))}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) send(); }}
          placeholder={t('team.messagePlaceholder', { name: peer.name })}
          aria-label={t('team.messagePlaceholder', { name: peer.name })}
          style={{ ...input, flex: 1 }}
        />
        <PixelButton size="sm" variant="primary" disabled={!text.trim()} onClick={send}>{t('team.send')}</PixelButton>
        <PixelButton size="sm" variant="secondary" onClick={() => sendFile(false)}>{t('team.sendFile')}</PixelButton>
        <PixelButton size="sm" variant="secondary" onClick={() => sendFile(true)}>{t('team.sendFolder')}</PixelButton>
      </div>
      {password && (
        <div style={{ ...box, background: 'var(--cth-lemon-light)' }}>
          <span style={{ fontSize: 12, color: 'var(--cth-ink-900)' }}>{t('team.passwordHint')}</span>
          <code dir="ltr" style={code}>{password}</code>
        </div>
      )}
    </div>
  );
}
