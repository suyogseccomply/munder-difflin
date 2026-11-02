import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { TEMP_TARGET, cloneTarget } from '@shared/tempRouting';

/** "A temp" and "A temp, clone of" for any select that picks who answers. */
export function TempTargetOptions() {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  return (
    <>
      <option value={TEMP_TARGET}>{t('tempRouting.aTemp')}</option>
      {agents.filter((a) => !a.isAssistant).map((a) => (
        <option key={a.id} value={cloneTarget(a.id)}>{t('tempRouting.cloneOf', { name: a.name })}</option>
      ))}
    </>
  );
}
