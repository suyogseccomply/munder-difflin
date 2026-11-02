import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { type Agent } from '@/store/store';
import { inferAgentProvider } from '@/store/config';
import {
  HIRE_EXPORT_FIELDS,
  buildHireManifest,
  type HireExportField,
  type HireExportSource
} from '@shared/hire';

export interface ExportAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

/** Choose what goes into an agent file, preview it, then save it. The preview is
 *  the exact manifest that gets written, and refused fields say why. */
export function ExportAgentModal({ agent, onClose }: ExportAgentModalProps) {
  const { t } = useTranslation();
  const [tokenCap, setTokenCap] = useState<number | undefined>();
  const [include, setInclude] = useState<Partial<Record<HireExportField, boolean>>>({});
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void window.cth.getConfig()
      .then((c) => setTokenCap(c.agentTokenCaps?.[agent.id]))
      .catch(() => setTokenCap(undefined));
  }, [agent.id]);

  // Only the listed fields are copied: the command, cwd, worktree path and env
  // never reach the builder, so they cannot reach the file.
  const source: HireExportSource = useMemo(() => ({
    name: agent.name,
    description: agent.description,
    goal: agent.goal,
    character: agent.character,
    accent: agent.accent,
    provider: inferAgentProvider(agent.command, agent.provider),
    model: agent.model,
    isolate: agent.worktreePath ? true : undefined,
    tokenCap
  }), [agent, tokenCap]);

  const result = useMemo(() => buildHireManifest(source, include), [source, include]);
  const available = HIRE_EXPORT_FIELDS.filter((f) => source[f] !== undefined && source[f] !== '');

  const save = async () => {
    if (!result.manifest) return;
    setStatus(null);
    const res = await window.cth.saveHireFile(result.manifest);
    if (res.ok) setStatus({ kind: 'saved', text: t('agentFiles.saved', { path: res.path }) });
    else if (res.error !== 'cancelled') setStatus({ kind: 'error', text: res.error });
  };

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: 'rgba(26, 19, 32, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '95vw' }}>
        <PixelPanel variant="dialog" title={t('agentFiles.exportTitle')} style={{ padding: 16 }} noPadding>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxHeight: '86vh', overflowY: 'auto' }}>
            <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('agentFiles.exportIntro')}</span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {available.map((f) => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--cth-ink-900)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={include[f] !== false}
                    onChange={(e) => setInclude((cur) => ({ ...cur, [f]: e.target.checked }))}
                  />
                  {t(`agentFiles.field_${f}`)}
                </label>
              ))}
            </div>

            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('agentFiles.neverIncluded')}</span>

            {result.omitted.length > 0 && (
              <div style={{ padding: 8, background: 'var(--cth-lemon-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontSize: 12, color: 'var(--cth-ink-900)' }}>
                <strong>{t('agentFiles.left')}</strong>
                <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                  {result.omitted.map(({ field, reason }) => (
                    <li key={field}>
                      {t(`agentFiles.field_${field}`)}: {t(`agentFiles.reason_${reason.replace(/-/g, '_')}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('agentFiles.preview')}</span>
              <pre
                dir="ltr"
                style={{
                  margin: 0, padding: 8, maxHeight: 220, overflow: 'auto',
                  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                  fontSize: 12, color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
                }}
              >
                {result.manifest ? JSON.stringify(result.manifest, null, 2) : result.errors.join('\n')}
              </pre>
            </div>

            {status && (
              <span style={{ fontSize: 12, overflowWrap: 'anywhere', color: status.kind === 'error' ? 'var(--cth-coral)' : 'var(--cth-ink-900)' }}>
                {status.text}
              </span>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <PixelButton variant="ghost" size="md" onClick={onClose}>{t('agentFiles.close')}</PixelButton>
              <PixelButton variant="primary" size="md" onClick={() => void save()} disabled={!result.manifest}>{t('agentFiles.save')}</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
