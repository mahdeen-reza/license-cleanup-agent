import { useState } from 'react';
import type { ReasoningTableContent } from '../types';
import ReasoningTableReview from './ReasoningTableReview';

interface Props {
  onConfirmed: () => void;
}

interface OnboardResult {
  reasoningTable: ReasoningTableContent;
  usedMock: boolean;
}

export default function SystemOnboarder({ onConfirmed }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [usageFile, setUsageFile] = useState<File | null>(null);
  const [pastFile, setPastFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OnboardResult | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('System name is required.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    if (!usageFile) { setError('Usage report CSV is required.'); return; }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('description', description.trim());
      fd.append('usageFile', usageFile);
      if (pastFile) fd.append('pastAnalysisFile', pastFile);

      const res = await fetch('/api/systems/onboard', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setError(err.error ?? 'Generation failed.');
        return;
      }
      const data = await res.json() as OnboardResult;
      setResult(data);
    } catch {
      setError('Request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <ReasoningTableReview
        name={name.trim()}
        description={description.trim()}
        reasoningTable={result.reasoningTable}
        usedMock={result.usedMock}
        onRegenerate={() => setResult(null)}
        onConfirmed={onConfirmed}
      />
    );
  }

  return (
    <div className="card" style={{ maxWidth: 748, margin: '0 auto', padding: '16px 20px' }}>
      <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 700, color: '#7c93c3' }}>Onboard New System</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 11 }}>
        Upload a sample usage CSV and describe the system. The agent will generate a Reasoning Table
        for your review before activating the system.
      </p>

      <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>System Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Gong"
            style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}
            disabled={loading}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Description</label>
          <textarea
            rows={4}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe this tool in 2-5 sentences: what it does, who uses it, and rough rules for who should have access."
            style={{ width: '100%', resize: 'vertical', fontSize: 13, padding: '8px 10px' }}
            disabled={loading}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
            Usage Report CSV <span style={{ color: '#ff6b6b' }}>*</span>
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={e => setUsageFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', padding: '5px 0 5px 9px', fontSize: 13 }}
            disabled={loading}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Sample usage export from the new system — used to detect activity fields and account patterns.
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Past Analysis CSV (optional)</label>
          <input
            type="file"
            accept=".csv"
            onChange={e => setPastFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', padding: '5px 0 5px 9px', fontSize: 13 }}
            disabled={loading}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Previous manual analysis showing example decisions — helps calibrate the Reasoning Table.
          </div>
        </div>

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</div>
        )}

        <div>
          <button type="submit" className="primary" disabled={loading} style={{ padding: '8px 20px', fontSize: 13 }}>
            {loading ? 'Generating Reasoning Table...' : 'Generate Reasoning Table'}
          </button>
        </div>
      </form>
    </div>
  );
}
