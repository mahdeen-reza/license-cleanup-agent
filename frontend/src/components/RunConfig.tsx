import { useState } from 'react';
import type { RunResult, SfInstance, CleanupMode, CleanupType } from '../types';
import { apiFetch } from '../lib/api';

interface Props {
  onRunComplete: (result: RunResult) => void;
}

const INSTANCES: SfInstance[] = ['Instance A', 'Instance B', 'Instance C', 'Instance D', 'Instance E'];

export default function RunConfig({ onRunComplete }: Props) {
  const [instance, setInstance] = useState<SfInstance>('Instance A');
  const [cleanupType, setCleanupType] = useState<CleanupType>('routine');
  const [mode, setMode] = useState<CleanupMode>('standard');
  const [licensesNeeded, setLicensesNeeded] = useState('');
  const [usageFile, setUsageFile] = useState<File | null>(null);
  const [hrFile, setHrFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!usageFile || !hrFile) {
      setError('Both CSV files are required.');
      return;
    }
    if (cleanupType === 'on_demand' && !licensesNeeded) {
      setError('Licenses needed is required for On-demand runs.');
      return;
    }

    const form = new FormData();
    form.append('instance', instance);
    form.append('cleanupType', cleanupType);
    form.append('mode', mode);
    if (cleanupType === 'on_demand') form.append('licensesNeeded', licensesNeeded);
    form.append('usageFile', usageFile);
    form.append('hrFile', hrFile);

    setLoading(true);
    try {
      const res = await apiFetch('/api/analysis/run', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = await res.json() as RunResult;
      onRunComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 748, margin: '0 auto', padding: '16px 20px' }}>
      <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700, color: '#7c93c3' }}>New Analysis Run</h2>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13 }}>

        <div>
          <label style={{ fontSize: 13 }}>IS System</label>
          <select value={instance} onChange={e => setInstance(e.target.value as SfInstance)} style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}>
            {INSTANCES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13 }}>Clean-up Type</label>
            <select value={cleanupType} onChange={e => setCleanupType(e.target.value as CleanupType)} style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}>
              <option value="routine">Routine</option>
              <option value="on_demand">On-demand</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13 }}>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value as CleanupMode)} style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}>
              <option value="standard">Standard (60+ days)</option>
              <option value="urgent">Urgent (30+ days)</option>
              <option value="critical">Critical (all users)</option>
            </select>
          </div>
        </div>

        {cleanupType === 'on_demand' && (
          <div>
            <label style={{ fontSize: 13 }}>Minimum Licenses Needed</label>
            <input
              type="number"
              min={1}
              value={licensesNeeded}
              onChange={e => setLicensesNeeded(e.target.value)}
              placeholder="e.g. 10"
              style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}
            />
          </div>
        )}

        <div>
          <label style={{ fontSize: 13 }}>User Extract CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={e => setUsageFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', padding: '5px 0 5px 9px', fontSize: 13 }}
          />
          <span className="muted" style={{ fontSize: 11 }}>Usage platform user export CSV</span>
        </div>

        <div>
          <label style={{ fontSize: 13 }}>HR System Export CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={e => setHrFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', padding: '5px 0 5px 9px', fontSize: 13 }}
          />
          <span className="muted" style={{ fontSize: 11 }}>HR system employee export CSV</span>
        </div>

        {error && <div className="error" style={{ fontSize: 13 }}>{error}</div>}

        <button type="submit" className="primary" disabled={loading} style={{ alignSelf: 'flex-start', padding: '8px 20px', fontSize: 13 }}>
          {loading ? 'Running analysis...' : 'Run Analysis'}
        </button>

        {loading && (
          <p className="muted" style={{ fontSize: 11 }}>
            Processing users — this may take a minute for large exports.
          </p>
        )}
      </form>
    </div>
  );
}
