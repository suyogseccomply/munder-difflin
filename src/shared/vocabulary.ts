/**
 * Spells technical names right after transcription. Whisper knows how these sound but
 * not how they're written, and writes "cube ernetes" or "post gress". Whole words only,
 * so a name is never corrected inside a longer word. This list is our own.
 */

/** Names the plain words must be cased to match. */
const NAMES: readonly string[] = [
  'Anthropic', 'Claude', 'OpenAI', 'ChatGPT', 'GPT', 'Gemini', 'Copilot', 'Cursor', 'Codex', 'Whisper', 'LangChain', 'Hugging Face', 'Ollama', 'MCP',
  'Kubernetes', 'Docker', 'Terraform', 'Ansible', 'Helm', 'Nginx', 'Linux', 'Ubuntu', 'macOS', 'iOS', 'Android', 'Windows', 'WSL',
  'AWS', 'GCP', 'Azure', 'S3', 'EC2', 'Lambda', 'CloudFront', 'Cloudflare', 'Vercel', 'Netlify', 'Heroku', 'DigitalOcean',
  'GitHub', 'GitLab', 'Bitbucket', 'Git', 'CI/CD', 'Jira', 'Confluence', 'Linear', 'Notion', 'Slack', 'Figma', 'Stripe', 'Razorpay', 'HubSpot', 'Salesforce', 'Zapier',
  'JavaScript', 'TypeScript', 'Node.js', 'Deno', 'Bun', 'React', 'Next.js', 'Vue', 'Svelte', 'Angular', 'Tailwind', 'Vite', 'Webpack', 'Electron', 'GraphQL', 'REST', 'gRPC', 'WebSocket', 'OAuth', 'JWT', 'SSO', 'SAML', 'API', 'SDK', 'CLI', 'JSON', 'YAML', 'HTML', 'CSS', 'SQL',
  'Python', 'Django', 'FastAPI', 'Flask', 'PyTorch', 'TensorFlow', 'NumPy', 'pandas', 'Rust', 'Golang', 'Java', 'Kotlin', 'Swift', 'Ruby on Rails',
  'PostgreSQL', 'Postgres', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Elasticsearch', 'Kafka', 'RabbitMQ', 'Snowflake', 'BigQuery', 'Supabase', 'Firebase',
  'ARR', 'MRR', 'KPI', 'OKR', 'SaaS', 'B2B', 'SOC 2', 'ISO 27001', 'GDPR', 'DPDP', 'PII'
];

/** How Whisper tends to mishear some of them. */
const MISHEARD: readonly (readonly [RegExp, string])[] = [
  [/\bcube(?:r|\s)?(?:n|\s)?e(?:r)?net(?:e)?s\b/gi, 'Kubernetes'],
  [/\bk\s?8\s?s\b/gi, 'Kubernetes'],
  [/\bpost\s?gress?(?:\s?q\s?l)?\b/gi, 'Postgres'],
  [/\bget\s?hub\b/gi, 'GitHub'],
  [/\bgit\s?lab\b/gi, 'GitLab'],
  [/\bchat\s?g\s?p\s?t\b/gi, 'ChatGPT'],
  [/\bopen\s?a\.?\s?i\b/gi, 'OpenAI'],
  [/\bclawed\b/gi, 'Claude'],
  [/\bclaud\b/gi, 'Claude'],
  [/\banthropics?\b/gi, 'Anthropic'],
  [/\bnext\s?js\b/gi, 'Next.js'],
  [/\bnode\s?js\b/gi, 'Node.js'],
  [/\bjava\s?script\b/gi, 'JavaScript'],
  [/\btype\s?script\b/gi, 'TypeScript'],
  [/\bgraph\s?q\s?l\b/gi, 'GraphQL'],
  [/\bm\s?c\s?p\b/gi, 'MCP'],
  [/\bs\s?a\s?a\s?s\b/gi, 'SaaS']
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Matches a name as a whole word, in any case. Lookarounds rather than \b, as names
 *  can begin or end with punctuation, like Node.js or CI/CD. */
const wordRe = (name: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'giu');

const BUILT_IN: readonly (readonly [RegExp, string])[] = NAMES.map((n) => [wordRe(n), n] as const);

/** A few built-ins are also everyday words, so casing them would damage a sentence. */
const LOWER_MEANS_WORD: ReadonlySet<string> = new Set(['Linear', 'Notion', 'Slack', 'Stripe', 'Cursor', 'Swift', 'React', 'Rust', 'Helm', 'Bun', 'Java', 'Lambda', 'Flask', 'Whisper', 'Windows', 'Git', 'REST', 'Python', 'Angular']);

export function cleanVocabulary(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((w): w is string => typeof w === 'string').map((w) => w.trim()).filter((w) => w && w.length <= 60))].slice(0, 500);
}

/** Corrects one transcript. The user's own words win over the built-in spellings. */
export function correctTranscript(text: string, userWords: readonly string[] = []): string {
  let out = text;
  for (const [re, to] of MISHEARD) out = out.replace(re, to);
  for (const [re, name] of BUILT_IN) {
    if (LOWER_MEANS_WORD.has(name)) continue;
    out = out.replace(re, name);
  }
  for (const word of cleanVocabulary(userWords as unknown[])) out = out.replace(wordRe(word), word);
  return out;
}

export const VOCABULARY_SIZE = NAMES.length;
