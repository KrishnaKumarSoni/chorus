import React, { useId, useRef } from 'react';
import { motion } from 'framer-motion';
import { quick } from '../../lib/motion';

export interface Segment<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Accessible name when `label` is not plain text. */
  name?: string;
}

/**
 * A single-choice radio group drawn as a segmented control. Arrow keys move
 * and select (roving tabindex), as the APG radio group pattern describes.
 */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, ariaLabelledBy, className }: {
  value: T;
  options: Segment<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
}) {
  const pill = useId();
  const root = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + options.length) % options.length;
    onChange(options[next].value);
    root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={root} role="radiogroup" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className={`segmented ${className ?? ''}`}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.name} tabIndex={on ? 0 : -1}
            className="segment" onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}>
            {on && <motion.span layoutId={pill} className="segment-pill" transition={quick} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
