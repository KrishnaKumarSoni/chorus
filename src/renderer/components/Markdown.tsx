import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const Markdown = React.memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`prose selectable ${streaming ? 'caret' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});
