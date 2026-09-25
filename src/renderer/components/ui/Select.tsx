import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CaretUpDown, Check } from '@phosphor-icons/react';
import { pop } from '../../lib/motion';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Secondary line under the label, e.g. what a model is for. */
  detail?: string;
  /** Short trailing text, e.g. a context window size. */
  meta?: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  /** Needed when no visible <label htmlFor> points at `id`. */
  ariaLabel?: string;
  size?: 'md' | 'sm';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const GAP = 6;
const MAX_HEIGHT = 320;

/**
 * A listbox in the app's own design, following the ARIA APG select-only
 * combobox pattern: the trigger keeps focus semantics, arrows move the active
 * option, Enter/Space choose, Escape and Tab close, typing jumps by label.
 * The popover is portalled so scroll containers never clip it, and it grows
 * from the edge of the trigger it came from.
 */
export function Select<T extends string>({ value, options, onChange, id, ariaLabel, size = 'md', placeholder = 'Choose…', disabled, className }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const width = Math.max(r.width, size === 'sm' ? 180 : 240);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    if (below >= Math.min(MAX_HEIGHT, 200) || below >= above) setRect({ left, width, top: r.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) });
    else setRect({ left, width, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) });
  }, [size]);

  const openList = (at = Math.max(0, selectedIndex)) => {
    if (disabled) return;
    place();
    setActive(at);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    if (open) list.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const onResize = () => close(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeahead = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at > 600 ? key : typed.current.text + key, at: now };
    const q = typed.current.text.toLowerCase();
    const start = typed.current.text.length === 1 ? active + 1 : active;
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length;
      if (options[i].label.toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openList(e.key === 'ArrowUp' ? Math.max(0, selectedIndex - 1) : Math.max(0, selectedIndex));
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((a) => Math.min(last, a + 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive((a) => Math.max(0, a - 1)); break;
      case 'Home': e.preventDefault(); setActive(0); break;
      case 'End': e.preventDefault(); setActive(last); break;
      case 'PageDown': e.preventDefault(); setActive((a) => Math.min(last, a + 8)); break;
      case 'PageUp': e.preventDefault(); setActive((a) => Math.max(0, a - 8)); break;
      case 'Enter': case ' ': e.preventDefault(); choose(active); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(); break;
      case 'Tab': close(false); break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const i = typeahead(e.key);
          if (i >= 0) setActive(i);
        }
    }
  };

  const fromTop = rect?.top !== undefined;
  return (
    <>
      <button ref={trigger} type="button" id={id} disabled={disabled}
        className={`${size === 'sm' ? 'select-trigger select-trigger-sm' : 'select-trigger'} ${className ?? ''}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        onClick={() => (open ? close() : openList())} onKeyDown={onTriggerKey}>
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? <span style={{ color: 'var(--muted)' }}>{placeholder}</span>}</span>
        {selected?.meta && size === 'md' && <span className="mono shrink-0 text-caption" style={{ color: 'var(--muted)' }}>{selected.meta}</span>}
        <CaretUpDown size={size === 'sm' ? 12 : 14} weight="bold" aria-hidden className="shrink-0" style={{ color: 'var(--muted)' }} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div ref={list} id={listId} role="listbox" tabIndex={-1}
              aria-labelledby={ariaLabel ? undefined : id} aria-label={ariaLabel}
              aria-activedescendant={`${listId}-${active}`}
              onKeyDown={onListKey}
              initial={{ opacity: 0, scale: 0.96, y: fromTop ? -4 : 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: 'easeOut' } }}
              transition={pop}
              className="popover scroll fixed z-[60] outline-none"
              style={{ left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom, maxHeight: rect.maxHeight, transformOrigin: fromTop ? 'top center' : 'bottom center' }}>
              {options.map((o, i) => (
                <div key={o.value} id={`${listId}-${i}`} data-index={i} role="option" aria-selected={o.value === value}
                  data-active={i === active} className="option"
                  onMouseMove={() => i !== active && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                  <span className="mt-[3px] w-3.5 shrink-0" aria-hidden>
                    {o.value === value && <Check size={14} weight="bold" style={{ color: 'var(--accent)' }} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{o.label}</span>
                      {o.meta && <span className="mono ml-auto shrink-0 text-caption" style={{ color: 'var(--muted)' }}>{o.meta}</span>}
                    </span>
                    {o.detail && <span className="mt-0.5 block text-caption" style={{ color: 'var(--muted)' }}>{o.detail}</span>}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
