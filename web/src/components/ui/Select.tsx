import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 220ms var(--ease-out)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function Select({ value, onChange, options, placeholder = 'Wybierz…', disabled = false, style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  const toggleOpen = () => {
    if (disabled) return;
    setOpen(o => {
      const next = !o;
      if (next) {
        measure();
        setOpenCount(c => c + 1);
        const idx = options.findIndex(opt => opt.value === value);
        setHighlight(idx >= 0 ? idx : 0);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, options.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = options[highlight];
        if (opt) { onChange(opt.value); setOpen(false); }
      }
    };
    const onReposition = () => measure();

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, options, highlight, onChange]);

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%', ...style }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          border: `1.5px solid ${open ? 'var(--focus-ring)' : 'var(--border-default)'}`,
          borderRadius: 'var(--radius-md)', padding: '11px 14px',
          fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 500,
          color: selected ? 'var(--text-strong)' : 'var(--text-faint)',
          background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.65 : 1,
          transition: 'border-color 160ms var(--ease-out)',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ display: 'flex', color: 'var(--text-faint)' }}><ChevronIcon open={open} /></span>
      </button>

      {rect && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 1000,
            transformOrigin: 'top center',
            transform: open ? 'scaleY(1) translateY(0)' : 'scaleY(0.92) translateY(-6px)',
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
            transition: 'transform 190ms var(--ease-out), opacity 150ms var(--ease-out)',
            background: 'var(--surface-card)', border: '1.5px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 14px 32px rgba(21,27,31,0.20)',
            maxHeight: 264, overflowY: 'auto', padding: 6, boxSizing: 'border-box',
          }}
        >
          <ul key={openCount} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {options.length === 0 && (
              <li style={{ padding: '10px 12px', fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--text-faint)' }}>Brak opcji</li>
            )}
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isHighlighted = i === highlight;
              return (
                <li
                  key={opt.value}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => { onChange(opt.value); setOpen(false); triggerRef.current?.focus(); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '9px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    fontFamily: 'var(--font-ui)', fontSize: 14.5, fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? 'var(--text-brand)' : 'var(--text-body)',
                    background: isHighlighted ? 'var(--surface-sunken)' : 'transparent',
                    animation: open ? `eque-option-in 200ms var(--ease-out) ${Math.min(i, 8) * 16}ms both` : 'none',
                    transition: 'background 120ms var(--ease-out)',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  {isSelected && <span style={{ display: 'flex', color: 'var(--brand)', flexShrink: 0 }}><CheckIcon /></span>}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
