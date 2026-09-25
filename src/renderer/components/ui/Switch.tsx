import React from 'react';

/** An on/off switch. The label names what happens when it is on. */
export function Switch({ checked, onChange, id, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; id?: string; labelledBy?: string }) {
  return (
    <button type="button" role="switch" id={id} aria-checked={checked} aria-labelledby={labelledBy} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}
