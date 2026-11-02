import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { tempsPerAgent } from '@shared/tempRouting';
import { TempTargetOptions } from './AnswerTargetOptions';

const field: CSSProperties = { padding: '5px 8px', border: 'none', outline: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)' };

/** These save straight away, like the Capabilities settings, rather than waiting for
 *  the Settings dialog's save button. */
export function TempsPerAgentSetting({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--cth-ink-900)' }}>
      {t('tempRouting.perAgent')}
      <input
        type="number" min="0" max="4" step="1"
        defaultValue={tempsPerAgent(config.tempsPerAgent)}
        onBlur={(e) => void window.cth.updateConfig({ tempsPerAgent: tempsPerAgent(Number(e.target.value)) })}
        style={{ ...field, width: 60 }}
      />
    </label>
  );
}

export function AnswerBySettings({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {(['slackAnswerBy', 'webhookAnswerBy'] as const).map((key) => (
        <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--cth-ink-700)' }}>
          {t(`tempRouting.${key}`)}
          <select
            defaultValue={config[key] ?? ''}
            onChange={(e) => void window.cth.updateConfig({ [key]: e.target.value || undefined })}
            style={field}
          >
            <option value="">{t('tempRouting.orchestrator')}</option>
            <TempTargetOptions />
          </select>
        </label>
      ))}
    </div>
  );
}
