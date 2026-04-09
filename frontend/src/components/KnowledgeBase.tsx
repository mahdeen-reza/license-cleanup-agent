import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import type { AccessCriteria, SystemRecord } from '../types';
import { apiFetch } from '../lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  confirmed?: boolean;
}

// Shared card padding value for consistency
const CARD_PAD = '16px 20px';

// Inline chevron SVG — right when collapsed, down when expanded
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// Section header style shared between Reasoning Table and Access Criteria
const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 20,
  color: '#7c93c3',
  userSelect: 'none',
};

// Markdown prose styles applied via component overrides
const mdComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f0f0f0', marginTop: 24, marginBottom: 12 }} {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 style={{ fontSize: 16, fontWeight: 600, color: '#f0f0f0', marginTop: 20, marginBottom: 8 }} {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', marginTop: 16, marginBottom: 8 }} {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p style={{ fontSize: 13, lineHeight: 1.7, color: '#ccc', marginBottom: 12 }} {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul style={{ paddingLeft: 20, marginBottom: 12, listStyleType: 'disc' }} {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol style={{ paddingLeft: 20, marginBottom: 12, listStyleType: 'decimal' }} {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li style={{ fontSize: 13, lineHeight: 1.7, color: '#ccc', marginBottom: 4 }} {...props} />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3, fontSize: 12, fontFamily: 'monospace', color: '#ffc107' }} {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong style={{ fontWeight: 600, color: '#f0f0f0' }} {...props} />
  ),
};

export default function KnowledgeBase() {
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string>('');
  const [criteria, setCriteria] = useState<AccessCriteria | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsMarkdown, setDocsMarkdown] = useState<string | null>(null);
  const [docsUsedMock, setDocsUsedMock] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  // Collapsible section state — both collapsed by default
  const [rtOpen, setRtOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);

  useEffect(() => {
    apiFetch('/api/systems')
      .then(r => r.json() as Promise<SystemRecord[]>)
      .then((data) => {
        setSystems(data);
        if (data.length > 0 && !selectedSystemId) {
          setSelectedSystemId(data[0].id);
        }
      })
      .catch(() => setSystems([]));
  }, []);

  useEffect(() => {
    if (!selectedSystemId) return;
    loadCriteria(selectedSystemId);
    setChatMessages([]);
    setPendingConfirm(false);
    setShowDocs(false);
    setDocsMarkdown(null);
  }, [selectedSystemId]);

  async function loadCriteria(systemId: string) {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/criteria/${encodeURIComponent(systemId)}`);
      const data = await res.json() as AccessCriteria;
      setCriteria(data);
    } finally {
      setLoading(false);
    }
  }

  async function sendChat(confirm = false) {
    const text = chatInput.trim();
    if ((!text && !confirm) || chatLoading) return;

    const message = confirm ? 'confirm' : text;
    setChatMessages(prev => [...prev, { role: 'user', content: message }]);
    setChatInput('');
    setChatLoading(true);
    setPendingConfirm(false);

    try {
      const res = await apiFetch(`/api/criteria/${encodeURIComponent(selectedSystemId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, confirm }),
      });
      const data = await res.json() as { reply: string; confirmed: boolean; version?: number };

      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply, confirmed: data.confirmed }]);

      if (data.confirmed) {
        await loadCriteria(selectedSystemId);
      } else if (data.reply.includes("Reply 'confirm'")) {
        setPendingConfirm(true);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Request failed. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  // Find the selected system by ID
  const matchingSystem = systems.find(s => s.id === selectedSystemId);

  async function generateDocs() {
    if (!matchingSystem) return;
    setDocsLoading(true);
    setShowDocs(false);
    setDocsMarkdown(null);
    try {
      const res = await apiFetch(`/api/systems/${matchingSystem.id}/generate-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'detailed' }),
      });
      const data = await res.json() as { markdown: string; usedMock: boolean };
      setDocsMarkdown(data.markdown);
      setDocsUsedMock(data.usedMock);
      setShowDocs(true);
    } catch {
      setDocsMarkdown('Failed to generate documentation. Please try again.');
      setDocsUsedMock(true);
      setShowDocs(true);
    } finally {
      setDocsLoading(false);
    }
  }

  function downloadMarkdown() {
    if (!docsMarkdown) return;
    const blob = new Blob([docsMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(matchingSystem?.name ?? 'system').replace(/\s+/g, '-')}-documentation.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderContent(content: string | object): string {
    if (typeof content === 'string') return content;
    return JSON.stringify(content, null, 2);
  }

  const rt = matchingSystem?.reasoningTable?.content ?? null;
  const hasRtContent = !!rt;

  return (
    <div style={{ display: 'flex', gap: 20, minHeight: 'calc(100vh - 100px)' }}>

      {/* Left: reasoning table + criteria viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

        {/* System selector */}
        <div className="card" style={{ padding: CARD_PAD, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ margin: 0 }}>System</label>
            <select value={selectedSystemId} onChange={e => setSelectedSystemId(e.target.value)}>
              {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {criteria && !criteria.isDefault && (
              <span className="muted" style={{ fontSize: 11 }}>
                v{criteria.version} · updated by {criteria.updatedBy} · {criteria.updatedAt ? new Date(criteria.updatedAt).toLocaleDateString() : ''}
              </span>
            )}
            {criteria?.isDefault && (
              <span style={{
                fontSize: 11, color: '#ffc107', background: 'rgba(255,193,7,0.12)',
                padding: '3px 10px', borderRadius: 12, whiteSpace: 'nowrap',
              }}>
                Default (no custom criteria saved yet)
              </span>
            )}
            <div style={{ flex: 1 }} />
            {matchingSystem && (
              <button onClick={generateDocs} disabled={docsLoading} style={{ fontSize: 12 }}>
                {docsLoading ? 'Generating...' : 'Generate Documentation'}
              </button>
            )}
          </div>
        </div>

        {/* Reasoning Table section */}
        <div className="card" style={{ padding: CARD_PAD, flexShrink: 0 }}>
          {/* Header — clickable only when there is RT content */}
          <div
            onClick={hasRtContent ? () => setRtOpen(o => !o) : undefined}
            style={{
              ...sectionHeaderStyle,
              cursor: hasRtContent ? 'pointer' : 'default',
              marginBottom: (hasRtContent && !rtOpen) ? 0 : 14,
            }}
          >
            {hasRtContent && <Chevron open={rtOpen} />}
            Reasoning Table
          </div>

          {/* Empty / no-system states — always visible, not collapsible */}
          {!matchingSystem && (
            <div className="muted" style={{ fontSize: 13 }}>
              No system found for this instance.
            </div>
          )}
          {matchingSystem && !rt && (
            <div style={{ fontSize: 13, color: '#ffc107', background: 'rgba(255,193,7,0.12)', padding: '8px 12px', borderRadius: 4 }}>
              No reasoning table configured
            </div>
          )}

          {/* RT content — collapsible */}
          {hasRtContent && rtOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Purpose + user base */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 2 }}>Tool Purpose</div>
                  <div style={{ fontSize: 13 }}>{rt.toolPurpose}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 2 }}>Primary User Base</div>
                  <div style={{ fontSize: 13 }}>{rt.primaryUserBase}</div>
                </div>
              </div>

              {/* Thresholds */}
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ background: '#1e2a4a', borderRadius: 4, padding: '6px 12px', fontSize: 12 }}>
                  Standard: <strong>{rt.thresholds?.standardDays ?? 60}d</strong>
                </div>
                <div style={{ background: '#3d3520', borderRadius: 4, padding: '6px 12px', fontSize: 12 }}>
                  Urgent: <strong>{rt.thresholds?.urgentDays ?? 30}d</strong>
                </div>
              </div>

              {/* Inactivity signals */}
              {rt.inactivitySignals?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 4 }}>Inactivity Signals</div>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontSize: 11 }}>Field</th>
                        <th style={{ textAlign: 'left', fontSize: 11 }}>Weight</th>
                        <th style={{ textAlign: 'left', fontSize: 11 }}>Reasoning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rt.inactivitySignals.map((s, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 12, fontFamily: 'monospace', paddingRight: 12 }}>{s.fieldName}</td>
                          <td style={{ fontSize: 12, paddingRight: 12 }}>{s.weight}</td>
                          <td style={{ fontSize: 12 }}>{s.reasoning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Consult-required roles */}
              {rt.consultRequiredRoles?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 4 }}>Consult-Required Roles</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {rt.consultRequiredRoles.map((r, i) => (
                      <span key={i} style={{ background: '#3d2020', color: '#ff6b6b', borderRadius: 3, padding: '2px 8px', fontSize: 11 }}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* GTM equivalent */}
              {rt.gtmEquivalentRoles && (
                <div>
                  <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 2 }}>GTM-Equivalent Roles</div>
                  <div style={{ fontSize: 13 }}>{rt.gtmEquivalentRoles}</div>
                </div>
              )}

              {/* Confirmed by */}
              {matchingSystem!.reasoningTable && (
                <div className="muted" style={{ fontSize: 11 }}>
                  v{matchingSystem!.reasoningTable.version} · confirmed by {matchingSystem!.reasoningTable.confirmedByEmail} · {new Date(matchingSystem!.reasoningTable.confirmedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Generated docs preview */}
        {showDocs && docsMarkdown && (
          <div className="card" style={{ padding: CARD_PAD, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 16, color: '#f0f0f0' }}>
                Generated Documentation
                {docsUsedMock && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#ffc107', background: 'rgba(255,193,7,0.12)', padding: '1px 6px', borderRadius: 3 }}>
                    template
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ fontSize: 12 }} onClick={() => navigator.clipboard.writeText(docsMarkdown)}>
                  Copy to Clipboard
                </button>
                <button style={{ fontSize: 12 }} onClick={downloadMarkdown}>
                  Download .md
                </button>
                <button style={{ fontSize: 12 }} onClick={() => setShowDocs(false)}>
                  Close
                </button>
              </div>
            </div>
            <pre style={{
              padding: 12, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', margin: 0, fontFamily: 'inherit',
              maxHeight: 480, overflow: 'auto', background: '#2a2a2a', borderRadius: 4,
            }}>
              {docsMarkdown}
            </pre>
          </div>
        )}

        {/* Access Criteria */}
        <div className="card" style={{ padding: CARD_PAD, flexShrink: 0 }}>
          <div
            onClick={() => setCriteriaOpen(o => !o)}
            style={{
              ...sectionHeaderStyle,
              paddingBottom: criteriaOpen ? 12 : 0,
              marginBottom: criteriaOpen ? 16 : 0,
              borderBottom: criteriaOpen ? '1px solid rgba(255,255,255,0.1)' : 'none',
            }}
          >
            <Chevron open={criteriaOpen} />
            Access Criteria
          </div>
          {criteriaOpen && (
            loading ? (
              <div style={{ padding: 24, color: '#a0a0a0' }}>Loading...</div>
            ) : criteria ? (
              <div>
                <Markdown components={mdComponents}>{renderContent(criteria.content)}</Markdown>
              </div>
            ) : null
          )}
        </div>

        {/* Version history */}
        {criteria?.versions && criteria.versions.length > 0 && (
          <div className="card" style={{ padding: CARD_PAD, maxHeight: 160, overflow: 'auto', flexShrink: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 16, color: '#f0f0f0' }}>Version History</div>
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Changed By</th>
                  <th>Note</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {criteria.versions.map(v => (
                  <tr key={v.id}>
                    <td>{v.version}</td>
                    <td>{v.changedBy}</td>
                    <td>{v.changeNote}</td>
                    <td>{new Date(v.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Right: criteria chat */}
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', border: '1px solid #444', borderRadius: 6, background: '#333', overflow: 'hidden', flexShrink: 0, position: 'sticky', top: 12, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 100px)' }}>
        <div style={{ padding: CARD_PAD, borderBottom: '1px solid #444', fontWeight: 600, fontSize: 16, color: '#f0f0f0' }}>
          Criteria Chat
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {chatMessages.length === 0 && (
            <div style={{
              color: '#888', fontSize: 12, fontStyle: 'italic',
              background: 'rgba(255,255,255,0.04)', borderRadius: 8,
              padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              Propose a criteria change. For example: "Finance users should only keep access if they're in AP or Revenue Accounting teams."
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              background: m.role === 'user' ? '#5b7bb4' : m.confirmed ? '#1e3a2a' : '#3a3a3a',
              color: '#f0f0f0',
              borderRadius: 8, padding: '8px 12px', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.content}
              {m.confirmed && <div style={{ marginTop: 4, fontSize: 11, color: '#66bb6a' }}>✓ Criteria updated</div>}
            </div>
          ))}
          {chatLoading && <div style={{ color: '#777', fontSize: 12 }}>Thinking...</div>}
        </div>

        <div style={{ padding: '10px 12px', borderTop: '1px solid #444', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pendingConfirm && (
            <button className="primary" onClick={() => sendChat(true)} style={{ width: '100%' }}>
              Confirm and Save Criteria Update
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              rows={3}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder="Propose a criteria change..."
              style={{ flex: 1, resize: 'none', fontSize: 12 }}
              disabled={chatLoading}
            />
            <button className="primary" onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim()} style={{ alignSelf: 'flex-end' }}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
