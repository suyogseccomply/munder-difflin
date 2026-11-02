import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyEngineAvailability } from '@shared/engineAvailability';
import type { AgentProvider } from '@/store/config';
import { PixelButton } from './PixelButton';

const code: CSSProperties = { display: 'block', padding: 6, fontSize: 12, overflowWrap: 'anywhere', background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)' };
type Tools = Awaited<ReturnType<typeof window.cth.toolsStatus>>;

/** A missing engine shows as what to do next, not as an error after pressing spawn.
 *  Says nothing while the engine is installed or the check hasn't run. */
export function EngineSetupCard({ provider, label }: { provider: AgentProvider; label: string }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<Tools | undefined>();
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try { setTools(await window.cth.toolsStatus()); } catch { /* unknown never blocks */ } finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const a = classifyEngineAvailability(tools, provider);
  if (a.state === 'installed' || a.state === 'unknown') return null;
  const installs = a.state === 'installs-on-first-run';
  return (
    <div role="status" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, background: installs ? 'var(--cth-cream-100)' : 'var(--cth-coral-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
      <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('engineSetup.notInstalled', { label })}</strong>
      <span style={{ fontSize: 12, color: 'var(--cth-ink-700)', lineHeight: '16px' }}>{installs ? t('engineSetup.installsItself') : t('engineSetup.installFirst')}</span>
      {a.installCommand && <code dir="ltr" style={code}>{a.installCommand}</code>}
      <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('engineSetup.signIn')}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a.installCommand && <PixelButton size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(a.installCommand)}>{t('engineSetup.copy')}</PixelButton>}
        {a.docsUrl && <PixelButton size="sm" variant="secondary" onClick={() => void window.cth.openExternal(a.docsUrl!)}>{t('engineSetup.manual')}</PixelButton>}
        <PixelButton size="sm" variant="secondary" disabled={checking} onClick={() => void check()}>{t('engineSetup.checkAgain')}</PixelButton>
      </div>
    </div>
  );
}
