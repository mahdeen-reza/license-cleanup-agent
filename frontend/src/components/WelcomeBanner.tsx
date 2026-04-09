import { useState, useRef, useEffect } from 'react';

type View = 'analysis' | 'knowledge' | 'onboard' | 'history' | 'admin';

interface Props {
  email: string;
  name: string;
  role: 'admin' | 'standard';
  currentView: View;
  onNav: (view: View) => void;
}

const NAV_ITEMS: Array<{ view: View; label: string }> = [
  { view: 'analysis', label: 'Analysis' },
  { view: 'onboard', label: 'Onboard System' },
  { view: 'knowledge', label: 'Knowledge Base' },
  { view: 'history', label: 'Run History' },
];

export default function WelcomeBanner({ email, name, role, currentView, onNav }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  return (
    <header style={{
      background: '#1e1e1e',
      borderBottom: '1px solid #444',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'flex-end',
      paddingBottom: 6,
      height: 64,
      gap: 32,
    }}>
      <span style={{ fontWeight: 700, fontSize: 29, color: '#7c93c3', whiteSpace: 'nowrap', lineHeight: 1, marginBottom: 2 }}>
        IS License Clean-Up Agent
      </span>

      <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
        {NAV_ITEMS.map(({ view, label }) => (
          <button
            key={view}
            onClick={() => onNav(view)}
            style={{
              border: 'none',
              background: currentView === view ? '#3a3a3a' : 'transparent',
              color: currentView === view ? '#7c93c3' : '#a0a0a0',
              fontWeight: currentView === view ? 600 : 400,
              borderRadius: 4,
              padding: '4px 12px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(prev => !prev)}
          style={{
            border: 'none',
            background: dropdownOpen ? '#3a3a3a' : 'transparent',
            color: dropdownOpen ? '#7c93c3' : '#a0a0a0',
            fontWeight: dropdownOpen ? 600 : 400,
            fontSize: 13,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            borderRadius: 4,
            padding: '4px 8px',
          }}
        >
          {name}
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            background: '#333',
            border: '1px solid #444',
            borderRadius: 6,
            minWidth: 260,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 100,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '13px 18px',
              fontSize: 13,
              color: '#888',
              borderBottom: '1px solid #444',
              userSelect: 'text',
            }}>
              {email}
            </div>

            {role === 'admin' && (
              <button
                onClick={() => { setDropdownOpen(false); onNav('admin'); }}
                style={{
                  display: 'block',
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  color: '#f0f0f0',
                  fontSize: 13,
                  padding: '13px 18px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#3a3a3a')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Admin Console
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
