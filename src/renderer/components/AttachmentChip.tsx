import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, FilePdf, Image, Table, X, Warning, FileCode } from '@phosphor-icons/react';
import type { Attachment } from '../../shared/types';
import { quick } from '../lib/motion';

const ICONS = { image: Image, pdf: FilePdf, docx: FileText, sheet: Table, text: FileCode, binary: FileText } as const;

export function AttachmentChip({ att, onRemove, compact }: { att: Attachment; onRemove?: () => void; compact?: boolean }) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (att.kind === 'image') window.chorus.attachments.preview(att.id).then(setPreview).catch(() => undefined);
  }, [att.id, att.kind]);
  const Icon = ICONS[att.kind];
  const kb = att.size > 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(att.size / 1024))} KB`;
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={quick}
      className="inline-flex items-center gap-2 rounded-[10px] border px-2 py-1 text-meta" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel-solid)' }} title={att.extractError ?? att.name}>
      {preview ? <img src={preview} alt="" className="h-6 w-6 rounded-[5px] object-cover" /> : <Icon size={16} weight="regular" style={{ color: 'var(--ink-2)' }} />}
      <span className="max-w-[160px] truncate">{att.name}</span>
      {!compact && <span className="mono" style={{ color: 'var(--muted)' }}>{kb}</span>}
      {att.extractError && <Warning size={14} weight="bold" style={{ color: 'var(--danger)' }} />}
      {onRemove && (
        <button className="btn btn-ghost -my-1 p-1.5" onClick={onRemove} aria-label={`Remove ${att.name}`}>
          <X size={12} weight="bold" />
        </button>
      )}
    </motion.div>
  );
}
