/**
 * Turns search output into results a screen can show as cards. The meaning search has
 * no structured output: its command line prints text like
 *
 *   [1] wing / room
 *       Source: file.md
 *       Match:  cosine=0.61 bm25=1.2
 *
 *       the matched passage
 *
 * That text format isn't a promise, so a parse that finds nothing returns an empty
 * list and the screen shows the raw output instead of hiding it.
 */

export interface MeaningHit {
  rank: number;
  wing: string;
  room: string;
  source?: string;
  match?: string;
  body: string;
}

const HEADER = /^\s*\[(\d+)\]\s+(.+?)\s*\/\s*(.+?)\s*$/;

export function parseMeaningResults(output: string): MeaningHit[] {
  const hits: MeaningHit[] = [];
  let current: MeaningHit | null = null;
  const body: string[] = [];
  const close = (): void => {
    if (!current) return;
    current.body = body.join('\n').trim();
    hits.push(current);
    body.length = 0;
  };
  for (const line of output.split(/\r?\n/)) {
    const head = HEADER.exec(line);
    if (head) {
      close();
      current = { rank: Number(head[1]), wing: head[2], room: head[3], body: '' };
      continue;
    }
    if (!current) continue;
    const source = /^\s*Source:\s*(.+)$/.exec(line);
    const match = /^\s*Match:\s*(.+)$/.exec(line);
    if (source && !current.source) current.source = source[1].trim();
    else if (match && !current.match) current.match = match[1].trim();
    else if (!/^\s*[-=─]{3,}\s*$/.test(line)) body.push(line.trim());
  }
  close();
  return hits;
}

export type ResultShape = 'tickets' | 'agents' | 'notes';
export interface TextHit { source: string; excerpt: string }

/** The three shapes results come in. A note is anything that isn't the board or the
 *  roster, so an unexpected source is still shown rather than dropped. */
export function shapeOfSource(source: string): ResultShape {
  if (source === 'board.md' || source === 'tasks.json') return 'tickets';
  if (source === 'agents') return 'agents';
  return 'notes';
}

export function groupTextHits(hits: readonly TextHit[]): Record<ResultShape, TextHit[]> {
  const groups: Record<ResultShape, TextHit[]> = { tickets: [], agents: [], notes: [] };
  for (const hit of hits) groups[shapeOfSource(hit.source)].push(hit);
  return groups;
}

/** A person's instruction first, so the agent knows why it was sent the results. */
export function resultsMessage(prompt: string, results: string): string {
  const p = prompt.trim();
  return p ? `${p}\n\n--- search results ---\n${results}` : results;
}
