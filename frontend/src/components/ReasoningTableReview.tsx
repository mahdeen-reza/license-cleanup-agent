import { useState } from 'react';
import type { ReasoningTableContent } from '../types';
import { apiFetch } from '../lib/api';

interface Props {
  name: string;
  description: string;
  reasoningTable: ReasoningTableContent;
  usedMock: boolean;
  onRegenerate: () => void;
  onConfirmed: () => void;
}

interface Signal {
  fieldName: string;
  weight: number;
  reasoning: string;
}

export default function ReasoningTableReview({
  name,
  description,
  reasoningTable,
  usedMock,
  onRegenerate,
  onConfirmed,
}: Props) {
  const [rt, setRt] = useState<ReasoningTableContent>({ ...reasoningTable });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // List fields as newline-separated strings for easy editing
  const [consultRolesText, setConsultRolesText] = useState(
    reasoningTable.consultRequiredRoles.join('\n'),
  );
  const [integrationPatternsText, setIntegrationPatternsText] = useState(
    reasoningTable.integrationPatterns.join('\n'),
  );

  function updateSignal(index: number, field: keyof Signal, value: string | number) {
    const updated = rt.inactivitySignals.map((s, i) =>
      i === index ? { ...s, [field]: value } : s,
    );
    setRt(prev => ({ ...prev, inactivitySignals: updated }));
  }

  function addSignal() {
    setRt(prev => ({
      ...prev,
      inactivitySignals: [
        ...prev.inactivitySignals,
        { fieldName: '', weight: 0.5, reasoning: '' },
      ],
    }));
  }

  function removeSignal(index: number) {
    setRt(prev => ({
      ...prev,
      inactivitySignals: prev.inactivitySignals.filter((_, i) => i !== index),
    }));
  }

  async function handleConfirm() {
    setError('');
    const finalRt: ReasoningTableContent = {
      ...rt,
      consultRequiredRoles: consultRolesText.split('\n').map(s => s.trim()).filter(Boolean),
      integrationPatterns: integrationPatternsText.split('\n').map(s => s.trim()).filter(Boolean),
    };

    setLoading(true);
    try {
      const res = await apiFetch('/api/systems/onboard/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, foundationalNote: description, reasoningTable: finalRt }),
      });

      if (!res.ok) {
        const err = await res.json() as { error: string };
        setError(err.error ?? 'Confirmation failed.');
        return;
      }

      onConfirmed();
    } catch {
      setError('Request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px' };
  const taStyle: React.CSSProperties = { width: '100%', resize: 'vertical', fontSize: 13, padding: '8px 10px' };
  const sectionStyle: React.CSSProperties = {
    background: '#333', border: '1px solid #444', borderRadius: 6,
    padding: '16px 20px', marginBottom: 12,
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#7c93c3' }}>Review Reasoning Table — {name}</h2>
        <button onClick={onRegenerate} disabled={loading} style={{ fontSize: 13 }}>← Regenerate</button>
      </div>

      {usedMock && (
        <div style={{
          background: 'rgba(255,193,7,0.12)', border: '1px solid #5a4a20', borderRadius: 4,
          padding: '8px 12px', marginBottom: 16, fontSize: 13, color: '#ffc107',
        }}>
          AI generation unavailable — template pre-filled with detected field names.
          Edit all placeholder fields before confirming.
        </div>
      )}

      <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
        Review and edit each field before activating. All fields are editable inline.
      </p>

      {/* System info */}
      <div style={sectionStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Tool Purpose</label>
            <textarea rows={3} value={rt.toolPurpose}
              onChange={e => setRt(p => ({ ...p, toolPurpose: e.target.value }))}
              style={taStyle} disabled={loading} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Primary User Base</label>
            <textarea rows={3} value={rt.primaryUserBase}
              onChange={e => setRt(p => ({ ...p, primaryUserBase: e.target.value }))}
              style={taStyle} disabled={loading} />
          </div>
        </div>
      </div>

      {/* Thresholds */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 20, color: '#7c93c3' }}>Inactivity Thresholds</div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <label style={{ fontSize: 11, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Standard (days)</label>
            <input type="number" value={rt.thresholds.standardDays}
              onChange={e => setRt(p => ({ ...p, thresholds: { ...p.thresholds, standardDays: +e.target.value } }))}
              style={{ width: 80, fontSize: 13, padding: '8px 10px' }} disabled={loading} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Urgent (days)</label>
            <input type="number" value={rt.thresholds.urgentDays}
              onChange={e => setRt(p => ({ ...p, thresholds: { ...p.thresholds, urgentDays: +e.target.value } }))}
              style={{ width: 80, fontSize: 13, padding: '8px 10px' }} disabled={loading} />
          </div>
        </div>
      </div>

      {/* Inactivity signals */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 20, color: '#7c93c3' }}>Inactivity Signals</div>
        <table style={{ width: '100%', marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={{ width: '28%', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Field Name</th>
              <th style={{ width: '12%', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Weight</th>
              <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Reasoning</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {rt.inactivitySignals.map((s, i) => (
              <tr key={i}>
                <td style={{ paddingRight: 8, paddingBottom: 8 }}>
                  <input value={s.fieldName}
                    onChange={e => updateSignal(i, 'fieldName', e.target.value)}
                    style={inputStyle} disabled={loading} placeholder="column_name" />
                </td>
                <td style={{ paddingRight: 8, paddingBottom: 8 }}>
                  <input type="number" step="0.1" min="0" max="1"
                    value={s.weight}
                    onChange={e => updateSignal(i, 'weight', parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', fontSize: 13, padding: '8px 10px' }} disabled={loading} />
                </td>
                <td style={{ paddingRight: 8, paddingBottom: 8 }}>
                  <input value={s.reasoning}
                    onChange={e => updateSignal(i, 'reasoning', e.target.value)}
                    style={inputStyle} disabled={loading} placeholder="Why this field signals inactivity" />
                </td>
                <td style={{ paddingBottom: 8 }}>
                  <button onClick={() => removeSignal(i)} disabled={loading}
                    style={{ padding: '2px 6px', fontSize: 12 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addSignal} disabled={loading} style={{ fontSize: 12 }}>+ Add Signal</button>
      </div>

      {/* Consult-required roles */}
      <div style={sectionStyle}>
        <label style={{ fontWeight: 700, fontSize: 20, color: '#7c93c3', display: 'block', marginBottom: 4 }}>
          Consult-Required Roles
        </label>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          One per line. These roles require manager consultation before any license action.
        </div>
        <textarea rows={4} value={consultRolesText}
          onChange={e => setConsultRolesText(e.target.value)}
          style={taStyle} disabled={loading}
          placeholder="Account Executive&#10;VP of Sales&#10;Customer Success Manager" />
      </div>

      {/* Integration patterns */}
      <div style={sectionStyle}>
        <label style={{ fontWeight: 700, fontSize: 20, color: '#7c93c3', display: 'block', marginBottom: 4 }}>
          Integration / Service Account Patterns
        </label>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          One per line. Keywords identifying bot/service/integration accounts to exclude from analysis.
        </div>
        <textarea rows={3} value={integrationPatternsText}
          onChange={e => setIntegrationPatternsText(e.target.value)}
          style={taStyle} disabled={loading}
          placeholder="integration&#10;api&#10;bot&#10;service" />
      </div>

      {/* GTM equivalent roles */}
      <div style={sectionStyle}>
        <label style={{ fontWeight: 700, fontSize: 20, color: '#7c93c3', display: 'block', marginBottom: 4 }}>
          GTM-Equivalent Roles
        </label>
        <textarea rows={3} value={rt.gtmEquivalentRoles}
          onChange={e => setRt(p => ({ ...p, gtmEquivalentRoles: e.target.value }))}
          style={taStyle} disabled={loading}
          placeholder="Describe revenue-facing roles that should never be auto-actioned..." />
      </div>

      {/* Additional notes */}
      <div style={sectionStyle}>
        <label style={{ fontWeight: 700, fontSize: 20, color: '#7c93c3', display: 'block', marginBottom: 4 }}>
          Additional Notes
        </label>
        <textarea rows={3} value={rt.additionalNotes}
          onChange={e => setRt(p => ({ ...p, additionalNotes: e.target.value }))}
          style={taStyle} disabled={loading}
          placeholder="Any special cases, known exceptions, or rules for this system..." />
      </div>

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="primary" onClick={handleConfirm} disabled={loading} style={{ fontSize: 13, padding: '8px 20px' }}>
          {loading ? 'Activating...' : 'Confirm & Activate'}
        </button>
        <button onClick={onRegenerate} disabled={loading} style={{ fontSize: 13 }}>Regenerate</button>
      </div>
    </div>
  );
}
