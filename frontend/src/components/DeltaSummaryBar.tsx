import type { DeltaSummary } from '../types';

export type DeltaFilter = 'newly_inactive' | 'persistently_inactive' | 'recovered' | 'reappeared' | 'net_new' | null;

interface Props {
  deltaSummary: DeltaSummary;
  activeFilter: DeltaFilter;
  onFilterChange: (filter: DeltaFilter) => void;
}

const SEGMENTS: {
  key: DeltaFilter & string;
  label: string;
  sublabel: string;
  countKey: keyof DeltaSummary['counts'];
  color: string;
  bg: string;
  activeBg: string;
  border: string;
}[] = [
  {
    key: 'newly_inactive',
    label: 'Newly Inactive',
    sublabel: 'Primary review focus',
    countKey: 'newlyInactive',
    color: '#ff6b6b',
    bg: '#3d2020',
    activeBg: '#5a2d2d',
    border: '#6a3333',
  },
  {
    key: 'persistently_inactive',
    label: 'Persistently Inactive',
    sublabel: 'Seen before — faster review',
    countKey: 'persistentlyInactive',
    color: '#ffc107',
    bg: '#3d3520',
    activeBg: '#5a4a20',
    border: '#6a5a2a',
  },
  {
    key: 'recovered',
    label: 'Recovered',
    sublabel: 'Self-corrected — no action',
    countKey: 'recovered',
    color: '#66bb6a',
    bg: '#1e3a2a',
    activeBg: '#2d5a3d',
    border: '#3a6a4a',
  },
  {
    key: 'reappeared',
    label: 'Reappeared',
    sublabel: 'Re-provisioned — investigate',
    countKey: 'reappeared',
    color: '#7c93c3',
    bg: '#1e2a4a',
    activeBg: '#2a3a5a',
    border: '#3a4a6a',
  },
  {
    key: 'net_new',
    label: 'Net New',
    sublabel: 'First appearance',
    countKey: 'netNew',
    color: '#a0a0a0',
    bg: '#2a2a2a',
    activeBg: '#3a3a3a',
    border: '#555',
  },
];

export default function DeltaSummaryBar({ deltaSummary, activeFilter, onFilterChange }: Props) {
  if (deltaSummary.isBaseline) {
    return (
      <div className="card" style={{ padding: '14px 20px', background: '#2a2a2a' }}>
        <div style={{ fontSize: 13, color: '#a0a0a0' }}>
          <strong>Baseline run</strong> — no previous data to compare.
          Delta analysis will be available starting with the next run for this instance.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      {/* Segment buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {SEGMENTS.map((seg) => {
          const count = deltaSummary.counts[seg.countKey];
          const isActive = activeFilter === seg.key;
          return (
            <button
              key={seg.key}
              onClick={() => onFilterChange(isActive ? null : seg.key)}
              title={seg.sublabel}
              style={{
                flex: '1 1 120px',
                minWidth: 120,
                border: `1.5px solid ${isActive ? seg.border : 'transparent'}`,
                borderRadius: 6,
                padding: '8px 12px',
                background: isActive ? seg.activeBg : seg.bg,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, color: seg.color }}>{count}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: seg.color, marginTop: 2 }}>{seg.label}</div>
              <div style={{ fontSize: 10, color: '#777', marginTop: 1 }}>{seg.sublabel}</div>
            </button>
          );
        })}
      </div>

      {/* Mode mismatch warning */}
      {deltaSummary.modeMismatch && (
        <div style={{
          marginTop: 10,
          fontSize: 12,
          color: '#ffc107',
          background: '#3d3520',
          borderRadius: 4,
          padding: '6px 12px',
        }}>
          Previous run used <strong>{deltaSummary.previousMode}</strong> mode.
          Current run uses a different mode. Some newly inactive users may appear
          due to the threshold change, not activity decline.
        </div>
      )}

      {/* Long gap note */}
      {deltaSummary.daysSinceLastRun !== null && deltaSummary.daysSinceLastRun > 60 && (
        <div style={{
          marginTop: deltaSummary.modeMismatch ? 6 : 10,
          fontSize: 12,
          color: '#a0a0a0',
        }}>
          Last run was {deltaSummary.daysSinceLastRun} days ago
          {deltaSummary.previousRunDate && (
            <> ({new Date(deltaSummary.previousRunDate).toLocaleDateString()})</>
          )}.
        </div>
      )}
    </div>
  );
}
