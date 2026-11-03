import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { VOCABULARY_SIZE, cleanVocabulary } from '@shared/vocabulary';

const field = { padding: '5px 8px', border: 'none', outline: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)' } as const;

/** Saved straight away, rather than waiting for the Settings dialog's save button. */
export function StaplerSettings({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t('staplerSettings.title')}</strong>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--cth-ink-900)' }}>
        {t('staplerSettings.model')}
        <select
          defaultValue={config.staplerModel ?? 'standard'}
          onChange={(e) => void window.cth.updateConfig({ staplerModel: e.target.value as 'standard' | 'larger' })}
          style={field}
        >
          <option value="standard">{t('staplerSettings.standard')}</option>
          <option value="larger">{t('staplerSettings.larger')}</option>
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--cth-ink-900)' }}>
        {t('staplerSettings.words', { count: VOCABULARY_SIZE })}
        <textarea
          rows={3}
          defaultValue={(config.staplerVocabulary ?? []).join('\n')}
          onBlur={(e) => void window.cth.updateConfig({ staplerVocabulary: cleanVocabulary(e.target.value.split('\n')) })}
          style={{ ...field, resize: 'vertical' }}
        />
      </label>
    </div>
  );
}
