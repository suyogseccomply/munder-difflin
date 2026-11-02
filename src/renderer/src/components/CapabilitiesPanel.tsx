import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { useStore, type Agent } from '@/store/store';
import type { HarnessConfig } from '@/store/config';
import { MCP_CATALOG } from '@shared/mcpCatalog';
import {
  CAPABILITY_KINDS,
  ROLE_BUNDLES,
  bundledServerEnabled,
  filterCapabilities,
  serverSpecFromEntry,
  type CapabilityEntry,
  type CapabilityList
} from '@shared/capabilities';

const PAGE = 60;

const box: CSSProperties = {
  padding: 8, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
};
const input: CSSProperties = {
  padding: '5px 8px 3px', border: 'none', outline: 'none', minWidth: 0,
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)'
};
const muted: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' };
const code: CSSProperties = {
  display: 'block', padding: 6, fontSize: 12, overflowWrap: 'anywhere',
  background: 'var(--cth-cream-100)', color: 'var(--cth-ink-900)'
};

/** Browse the public list, then decide per agent who gets what. Loading the list
 *  enables nothing, and every server shows its full launch command first. */
export function CapabilitiesPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'browse' | 'who'>('browse');
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const refreshConfig = useCallback(() => { void window.cth.getConfig().then(setConfig); }, []);
  useEffect(refreshConfig, [refreshConfig]);

  const tabButton = (key: 'browse' | 'who', label: string) => (
    <PixelButton variant={tab === key ? 'primary' : 'secondary'} size="sm" onClick={() => setTab(key)}>{label}</PixelButton>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {tabButton('browse', t('capabilities.browse'))}
        {tabButton('who', t('capabilities.whoHasWhat'))}
      </div>
      {config && (tab === 'browse'
        ? <BrowseTab config={config} onConfig={setConfig} />
        : <WhoHasWhatTab config={config} onConfig={setConfig} />)}
    </div>
  );
}

function BrowseTab({ config, onConfig }: { config: HarnessConfig; onConfig: (c: HarnessConfig) => void }) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<CapabilityList | null>(null);
  const [meta, setMeta] = useState<{ issuedAt?: string; stale: boolean; error?: string; loading: boolean }>({ stale: false, loading: true });
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reviewedOnly, setReviewedOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    setMeta((m) => ({ ...m, loading: true }));
    const res = await window.cth.capabilitiesList(force);
    setList(res.list);
    setMeta({ issuedAt: res.issuedAt, stale: res.stale, error: res.error, loading: false });
  }, []);
  useEffect(() => { void load(false); }, [load]);
  useEffect(() => setShown(PAGE), [query, kind, purpose, reviewedOnly]);

  const hits = useMemo(
    () => (list ? filterCapabilities(list.entries, { query, kind, purpose, reviewedOnly }) : []),
    [list, query, kind, purpose, reviewedOnly]
  );

  const signedOn = meta.issuedAt ? new Date(meta.issuedAt).toLocaleDateString(i18n.language) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...muted, flex: 1, minWidth: 200 }}>
          {meta.loading ? t('capabilities.loading')
            : list ? t('capabilities.verified', { count: list.entries.length, date: signedOn })
            : t('capabilities.unavailable')}
          {meta.stale && meta.error ? ` ${t('capabilities.stale', { error: meta.error })}` : ''}
        </span>
        <PixelButton variant="secondary" size="sm" onClick={() => void load(true)} disabled={meta.loading}>{t('capabilities.refresh')}</PixelButton>
      </div>

      {!list && !meta.loading && (
        <div style={box}>
          <div style={{ fontSize: 13, color: 'var(--cth-ink-900)', marginBottom: 4 }}>{t('capabilities.offlineTitle')}</div>
          <ul style={{ ...muted, margin: 0, paddingInlineStart: 18 }}>
            {MCP_CATALOG.map((e) => <li key={e.id}>{e.label}: {e.description}</li>)}
          </ul>
        </div>
      )}

      {list && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('capabilities.search')}
              aria-label={t('capabilities.search')}
              style={{ ...input, flex: 1, minWidth: 180 }}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('capabilities.allKinds')} style={input}>
              <option value="">{t('capabilities.allKinds')}</option>
              {CAPABILITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label={t('capabilities.allPurposes')} style={input}>
              <option value="">{t('capabilities.allPurposes')}</option>
              {list.purposes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={reviewedOnly} onChange={(e) => setReviewedOnly(e.target.checked)} />
              {t('capabilities.reviewedOnly')}
            </label>
          </div>
          <span style={muted}>{t('capabilities.results', { count: hits.length })}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {hits.slice(0, shown).map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                open={open === entry.id}
                onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                config={config}
                onConfig={onConfig}
              />
            ))}
          </div>
          {hits.length > shown && (
            <PixelButton variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE)}>{t('capabilities.showMore')}</PixelButton>
          )}
        </>
      )}
    </div>
  );
}

function EntryRow({ entry, open, onToggle, config, onConfig }: {
  entry: CapabilityEntry;
  open: boolean;
  onToggle: () => void;
  config: HarnessConfig;
  onConfig: (c: HarnessConfig) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const spec = useMemo(() => serverSpecFromEntry(entry), [entry]);
  const added = !!config.capabilityServers?.[entry.id];

  const addServer = async () => {
    const res = await window.cth.capabilitiesAddServer(entry.id);
    if (res.ok) { onConfig(res.config); setNote(t('capabilities.added')); }
    else setNote(res.error);
  };
  const removeServer = async () => onConfig(await window.cth.capabilitiesRemoveServer(entry.id));
  const installSkill = async () => {
    if (!entry.url) return;
    const res = await window.cth.skillsInstall(entry.url, entry.id);
    setNote(res.ok ? t('capabilities.installed') : res.error);
  };
  const copy = (text: string) => { void navigator.clipboard.writeText(text); setNote(t('capabilities.copied')); };

  const abilities = entry.can
    ? (['reads', 'writes', 'sends', 'spends', 'deletes'] as const).filter((k) => entry.can?.[k])
    : [];

  return (
    <div style={box}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{entry.name}</strong>
          <span style={muted}>{entry.kind} · {entry.maker}</span>
          <span style={{ ...muted, color: entry.reviewed ? 'var(--cth-ink-700)' : 'var(--cth-coral)' }}>
            {entry.reviewed ? t('capabilities.reviewed') : t('capabilities.notReviewed')}
          </span>
          {added && <span style={{ ...muted, color: 'var(--cth-ink-700)' }}>· {t('capabilities.addedShort')}</span>}
        </div>
        <div style={muted}>{entry.what}</div>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {abilities.length > 0 && <span style={muted}>{t('capabilities.canDo', { list: abilities.join(', ') })}</span>}
          {entry.licence && <span style={muted}>{t('capabilities.licence', { licence: entry.licence })}</span>}
          {entry.riskNote && <span style={{ ...muted, color: 'var(--cth-coral)' }}>{entry.riskNote}</span>}

          {spec && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={muted}>{t('capabilities.willRun')}</span>
              <code dir="ltr" style={code}>{[spec.command, ...spec.args].join(' ')}</code>
              {entry.secretNames.length > 0 && <span style={muted}>{t('capabilities.reads', { names: entry.secretNames.join(', ') })}</span>}
              <div>
                {added
                  ? <PixelButton variant="secondary" size="sm" onClick={() => void removeServer()}>{t('capabilities.remove')}</PixelButton>
                  : <PixelButton variant="primary" size="sm" onClick={() => void addServer()}>{t('capabilities.addServer')}</PixelButton>}
              </div>
              <span style={muted}>{t('capabilities.addHint')}</span>
            </div>
          )}

          {entry.door === 'skill-folder' && entry.url && (
            <div><PixelButton variant="primary" size="sm" onClick={() => void installSkill()}>{t('capabilities.installSkill')}</PixelButton></div>
          )}

          {entry.steps.length > 0 && !spec && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={muted}>{t('capabilities.runYourself')}</span>
              {entry.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {s.label && <span style={muted}>{s.label}</span>}
                  <code dir="ltr" style={code}>{s.argv.join(' ')}</code>
                  <div><PixelButton variant="secondary" size="sm" onClick={() => copy(s.argv.join(' '))}>{t('capabilities.copy')}</PixelButton></div>
                </div>
              ))}
            </div>
          )}

          {entry.manual.length > 0 && (
            <ul style={{ ...muted, margin: 0, paddingInlineStart: 18, overflowWrap: 'anywhere' }}>
              {entry.manual.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}

          <div><PixelButton variant="ghost" size="sm" onClick={() => void window.cth.openExternal(entry.source)}>{t('capabilities.source')}</PixelButton></div>
          {note && <span style={{ fontSize: 12, color: 'var(--cth-ink-900)' }}>{note}</span>}
        </div>
      )}
    </div>
  );
}

function WhoHasWhatTab({ config, onConfig }: { config: HarnessConfig; onConfig: (c: HarnessConfig) => void }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const listServers = useMemo(() => Object.entries(config.capabilityServers ?? {}), [config.capabilityServers]);
  const keyNames = useMemo(() => [...new Set([
    ...MCP_CATALOG.flatMap((e) => Object.keys(e.spec.env ?? {})),
    ...listServers.flatMap(([, s]) => s.secretNames ?? [])
  ])], [listServers]);

  const refreshKeys = useCallback(() => {
    void window.cth.capabilitiesKeyStatus(keyNames).then(setKeys);
  }, [keyNames]);
  useEffect(refreshKeys, [refreshKeys]);

  const saveKey = async (name: string) => {
    const value = draft[name];
    if (!value) return;
    const res = await window.cth.capabilitiesSetKey(name, value);
    // The typed value is dropped either way; a saved key is never shown again.
    setDraft((d) => ({ ...d, [name]: '' }));
    if (!res.ok) setNotes((n) => ({ ...n, [name]: res.error ?? t('capabilities.keyFailed') }));
    refreshKeys();
  };

  const grant = async (agentId: string, serverId: string, value: boolean) =>
    onConfig(await window.cth.capabilitiesSetGrant(agentId, serverId, value));

  const applyBundle = async (agent: Agent, bundleId: string) => {
    const res = await window.cth.capabilitiesApplyBundle(agent.id, bundleId);
    if (!res.ok) return;
    onConfig(res.config);
    setNotes((n) => ({
      ...n,
      [agent.id]: res.needsConsent.length ? t('capabilities.needsConsent', { list: res.needsConsent.join(', ') }) : t('capabilities.bundleApplied')
    }));
  };

  const named = agents.filter((a) => !a.isAssistant);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={muted}>{t('capabilities.whoHint')}</span>

      {named.length === 0 && <span style={muted}>{t('capabilities.noAgents')}</span>}
      {named.map((agent) => {
        const grants = config.agentMcpGrants?.[agent.id];
        return (
          <div key={agent.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ flex: 1, fontSize: 13, color: 'var(--cth-ink-900)' }}>{agent.name}</strong>
              <select
                value=""
                onChange={(e) => { if (e.target.value) void applyBundle(agent, e.target.value); }}
                aria-label={t('capabilities.applyBundle')}
                style={input}
              >
                <option value="">{t('capabilities.applyBundle')}</option>
                {ROLE_BUNDLES.map((b) => <option key={b.id} value={b.id} title={b.description}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 2 }}>
              {MCP_CATALOG.map((e) => (
                <label key={e.id} title={e.description} style={{ ...muted, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={bundledServerEnabled(e.id, e.tier, e.defaultEnabled, config.mcpDefaults, grants)}
                    onChange={(ev) => void grant(agent.id, e.id, ev.target.checked)}
                  />
                  {e.label}{e.tier !== 'safe-readonly' ? ` (${e.tier})` : ''}
                </label>
              ))}
              {listServers.map(([id, s]) => (
                <label key={id} title={[s.command, ...s.args].join(' ')} style={{ ...muted, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={grants?.[id] === true} onChange={(ev) => void grant(agent.id, id, ev.target.checked)} />
                  {s.label} ({t('capabilities.fromList')})
                </label>
              ))}
            </div>
            {notes[agent.id] && <span style={{ fontSize: 12, color: 'var(--cth-ink-900)' }}>{notes[agent.id]}</span>}
          </div>
        );
      })}

      <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('capabilities.keys')}</strong>
        <span style={muted}>{t('capabilities.keysHint')}</span>
        {keyNames.map((name) => (
          <div key={name} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <code dir="ltr" style={{ fontSize: 12, flex: 1, minWidth: 180, color: 'var(--cth-ink-900)' }}>{name}</code>
            <span style={muted}>{keys[name] ? t('capabilities.keySaved') : t('capabilities.keyMissing')}</span>
            <input
              type="password"
              autoComplete="off"
              value={draft[name] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
              aria-label={name}
              placeholder={keys[name] ? t('capabilities.keyReplace') : t('capabilities.keyEnter')}
              style={{ ...input, width: 200 }}
            />
            <PixelButton variant="secondary" size="sm" onClick={() => void saveKey(name)} disabled={!draft[name]}>{t('capabilities.keySave')}</PixelButton>
            {notes[name] && <span style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{notes[name]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
