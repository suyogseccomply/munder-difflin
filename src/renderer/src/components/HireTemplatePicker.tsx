import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HIRE_TEMPLATES, HIRE_TEMPLATE_CATEGORIES, templateManifest } from '@shared/hireTemplates';
import type { HireManifest } from '@shared/hire';

export interface HireTemplatePickerProps {
  /** Pre-fills the Add-Agent form. A template never spawns anything itself. */
  onPick: (manifest: HireManifest) => void;
}

export function HireTemplatePicker({ onPick }: HireTemplatePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = HIRE_TEMPLATES.filter((x) => !q || `${x.name} ${x.description} ${x.category}`.toLowerCase().includes(q));
    return HIRE_TEMPLATE_CATEGORIES
      .map((category) => ({ category, items: hits.filter((x) => x.category === category) }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
      background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>
      <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('agentFiles.templatesIntro')}</span>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('agentFiles.templatesSearch')}
        aria-label={t('agentFiles.templatesSearch')}
        style={{
          padding: '6px 8px 4px', border: 'none', outline: 'none',
          background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
          fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)'
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
        {groups.map(({ category, items }) => (
          <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{category}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPick(templateManifest(item))}
                  style={{
                    padding: '6px 8px', border: 'none', cursor: 'pointer', textAlign: 'start',
                    background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                    fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink-900)'
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>{item.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
