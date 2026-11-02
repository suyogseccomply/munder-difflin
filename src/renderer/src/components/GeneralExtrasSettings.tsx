import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { cleanTicketPrefix } from '@shared/workspace';

const field: CSSProperties = { padding: '5px 8px', border: 'none', outline: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--cth-ink-900)' };

/** Saved straight away, rather than waiting for the Settings dialog's save button. */
export function GeneralExtrasSettings({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  return (
    <>
      <label style={row}>
        {t('settings.general.defaultView')}
        <select
          defaultValue={config.defaultView ?? ''}
          onChange={(e) => void window.cth.updateConfig({ defaultView: (e.target.value || undefined) as HarnessConfig['defaultView'] })}
          style={field}
        >
          <option value="">{t('settings.general.defaultViewLast')}</option>
          <option value="classic">{t('workspace.toClassic')}</option>
          <option value="workspace">{t('workspace.toWorkspace')}</option>
        </select>
      </label>
      <label style={row}>
        {t('settings.general.ticketPrefix')}
        <input
          defaultValue={cleanTicketPrefix(config.ticketPrefix)}
          onBlur={(e) => { const v = cleanTicketPrefix(e.target.value); e.target.value = v; void window.cth.updateConfig({ ticketPrefix: v }); }}
          style={{ ...field, width: 90 }}
        />
      </label>
    </>
  );
}
