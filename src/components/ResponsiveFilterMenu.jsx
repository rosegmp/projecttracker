import React, { useEffect, useRef, useState } from 'react';
import FluentIcon from './FluentIcon.jsx';

export default function ResponsiveFilterMenu({ children, label = 'Filter options' }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeFromOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeFromEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [open]);

  return (
    <div className="responsive-filter-menu" ref={menuRef}>
      <button
        className={`button secondary mobile-filter-menu-trigger${open ? ' active' : ''}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <FluentIcon name="moreVertical" />
      </button>
      <div className={`responsive-filter-menu-content${open ? ' mobile-open' : ''}`}>
        {children}
      </div>
    </div>
  );
}
