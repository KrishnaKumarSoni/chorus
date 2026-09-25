import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Consensus summaries tag conclusions like **[2/2 agree]**; show those as pills with a text label, not colour alone. */
const TAG_RE = /^\[(\d)\/2(?:\s*[·-]\s*(.+))?\s*(agree|unresolved)?\]$/i;

function tagTone(text: string): 'agree' | 'conditional' | 'open' {
  if (/unresolved|1\/2/i.test(text)) return 'open';
  if (/assumption/i.test(text)) return 'conditional';
  return 'agree';
}

const TONE = {
  agree: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  conditional: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  open: { background: 'var(--danger-soft)', color: 'var(--danger)' },
} as const;

const components: Components = {
  strong({ children }) {
    const text = React.Children.toArray(children).join('');
    if (typeof text === 'string' && TAG_RE.test(text.trim())) {
      const label = text.trim().slice(1, -1);
      return <span className="mr-1 inline-block whitespace-nowrap rounded-full px-2 py-px align-[1px] text-caption font-semibold not-italic" style={TONE[tagTone(label)]}>{label}</span>;
    }
    return <strong>{children}</strong>;
  },
};

export const Markdown = React.memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`prose selectable ${streaming ? 'caret' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
});
