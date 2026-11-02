import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { groupTextHits, parseMeaningResults, type ResultShape, type TextHit } from '@shared/memoryResults';

const VIEW_KEY = 'cth.memory.resultView';
type View = 'cards' | 'list';

const label: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)' };
const text: CSSProperties = { fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const cardBox: CSSProperties = { padding: 8, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', display: 'flex', flexDirection: 'column', gap: 2 };
const rowBox: CSSProperties = { padding: '3px 0', borderBottom: '1px solid var(--cth-ink-100)', display: 'flex', flexDirection: 'column' };

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'));
  return [view, (v) => { setView(v); localStorage.setItem(VIEW_KEY, v); }];
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const { t } = useTranslation();
  const button = (v: View) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => onChange(v)}
      style={{ padding: '1px 8px', border: 'none', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', background: view === v ? 'var(--cth-lemon-light)' : 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}
    >{t(`memoryResults.${v}`)}</button>
  );
  return <div style={{ display: 'flex', gap: 4, margin: '6px 0 4px' }}>{button('cards')}{button('list')}</div>;
}

const SHAPES: ResultShape[] = ['tickets', 'agents', 'notes'];

/** Exact-word matches, in the three shapes answers come in. */
export function ShapedTextResults({ hits }: { hits: readonly TextHit[] }) {
  const { t } = useTranslation();
  const [view, setView] = useView();
  const groups = useMemo(() => groupTextHits(hits), [hits]);
  return (
    <div style={{ marginTop: 6 }}>
      <ViewToggle view={view} onChange={setView} />
      {SHAPES.filter((shape) => groups[shape].length > 0).map((shape) => (
        <div key={shape} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-700)', marginBottom: 3 }}>{t(`memoryResults.${shape}`)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: view === 'cards' ? 4 : 0 }}>
            {groups[shape].map((hit, i) => (
              <div key={i} style={view === 'cards' ? cardBox : rowBox}>
                <span style={label}>{hit.source}</span>
                <span style={text}>{hit.excerpt}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Matches by meaning. If the output can't be read as results, it's shown as it came. */
export function MeaningResults({ output }: { output: string }) {
  const [view, setView] = useView();
  const hits = useMemo(() => parseMeaningResults(output), [output]);
  if (hits.length === 0) return <pre style={{ ...text, margin: '6px 0 0', fontFamily: 'var(--cth-font-mono)' }}>{output}</pre>;
  return (
    <div style={{ marginTop: 6 }}>
      <ViewToggle view={view} onChange={setView} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: view === 'cards' ? 4 : 0 }}>
        {hits.map((hit) => (
          <div key={hit.rank} style={view === 'cards' ? cardBox : rowBox}>
            <span style={label}>{hit.wing} / {hit.room}{hit.source ? ` · ${hit.source}` : ''}</span>
            <span style={text}>{hit.body}</span>
            {hit.match && <span style={label}>{hit.match}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
