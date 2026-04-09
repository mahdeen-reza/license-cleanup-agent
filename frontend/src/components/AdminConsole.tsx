import { useState, useEffect } from 'react';
import type { MeResponse, AppUser } from '../types';

interface Props {
  currentUser: MeResponse;
}

export default function AdminConsole({ currentUser }: Props) {
  // Standard users see read-only profile
  if (currentUser.role !== 'admin') {
    return <UserProfile user={currentUser} />;
  }

  return <AdminPanel currentUser={currentUser} />;
}

// ─── Read-only profile for standard users ────────────────────────────────────

function UserProfile({ user }: { user: MeResponse }) {
  return (
    <div className="card" style={{ maxWidth: 480, padding: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#f0f0f0' }}>
        Your Profile
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 16px', fontSize: 14 }}>
        <span style={{ color: '#777' }}>Name</span>
        <span>{user.name}</span>
        <span style={{ color: '#777' }}>Email</span>
        <span>{user.email}</span>
        <span style={{ color: '#777' }}>Role</span>
        <span style={{ textTransform: 'capitalize' }}>{user.role}</span>
      </div>
    </div>
  );
}

// ─── Full admin panel ────────────────────────────────────────────────────────

function AdminPanel({ currentUser }: { currentUser: MeResponse }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setError(err.error ?? 'Failed to load users.');
        return;
      }
      setUsers(await res.json());
    } catch {
      setError('Network error loading users.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#f0f0f0' }}>User Management</h2>
        <button
          className="primary"
          onClick={() => { setShowAddForm(!showAddForm); setEditingId(null); }}
          style={{ fontSize: 13 }}
        >
          {showAddForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: 13, padding: '12px 16px', marginBottom: 12, background: '#3d2020', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {showAddForm && (
        <AddUserForm
          onSuccess={() => { setShowAddForm(false); loadUsers(); }}
          onError={setError}
        />
      )}

      {loading ? (
        <div className="muted" style={{ padding: 16 }}>Loading users...</div>
      ) : (
        <UserTable
          users={users}
          currentUserId={currentUser.id}
          editingId={editingId}
          onEdit={setEditingId}
          onUpdated={() => { setEditingId(null); loadUsers(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

// ─── Add User Form ───────────────────────────────────────────────────────────

function AddUserForm({ onSuccess, onError }: { onSuccess: () => void; onError: (msg: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'standard' | 'admin'>('standard');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    onError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError(err.error ?? 'Failed to add user.');
        return;
      }
      onSuccess();
    } catch {
      onError('Network error adding user.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@company.com"
          style={{ width: 260 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        Name
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full Name"
          style={{ width: 200 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as 'standard' | 'admin')}>
          <option value="standard">Standard</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button type="submit" className="primary" disabled={submitting} style={{ fontSize: 13 }}>
        {submitting ? 'Adding...' : 'Add'}
      </button>
    </form>
  );
}

// ─── User Table ──────────────────────────────────────────────────────────────

function UserTable({
  users,
  currentUserId,
  editingId,
  onEdit,
  onUpdated,
  onError,
}: {
  users: AppUser[];
  currentUserId: string;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onUpdated: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <table style={{ width: '100%', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Name</th>
          <th style={{ textAlign: 'left' }}>Email</th>
          <th style={{ textAlign: 'left' }}>Role</th>
          <th style={{ textAlign: 'left' }}>Status</th>
          <th style={{ textAlign: 'left' }}>Added By</th>
          <th style={{ textAlign: 'left' }}>Created</th>
          <th style={{ textAlign: 'right' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) =>
          editingId === u.id ? (
            <EditRow
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              onCancel={() => onEdit(null)}
              onSaved={onUpdated}
              onError={onError}
            />
          ) : (
            <ViewRow
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              onEdit={() => onEdit(u.id)}
              onToggleActive={() => toggleActive(u, currentUserId, onUpdated, onError)}
            />
          )
        )}
      </tbody>
    </table>
  );
}

// ─── View Row ────────────────────────────────────────────────────────────────

function ViewRow({
  user,
  isSelf,
  onEdit,
  onToggleActive,
}: {
  user: AppUser;
  isSelf: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  return (
    <tr style={{ opacity: user.active ? 1 : 0.5 }}>
      <td>
        {user.name}
        {isSelf && <span style={{ color: '#7c93c3', fontSize: 11, marginLeft: 6 }}>(you)</span>}
      </td>
      <td>{user.email}</td>
      <td style={{ textTransform: 'capitalize' }}>{user.role}</td>
      <td>
        <span style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 10,
          background: user.active ? '#1e3a2a' : '#3d2020',
          color: user.active ? '#66bb6a' : '#ff6b6b',
        }}>
          {user.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td style={{ color: '#777' }}>{user.addedBy}</td>
      <td style={{ color: '#777' }}>{new Date(user.createdAt).toLocaleDateString()}</td>
      <td style={{ textAlign: 'right' }}>
        <button onClick={onEdit} style={{ fontSize: 12, marginRight: 6 }}>Edit</button>
        {!isSelf && (
          <button
            onClick={onToggleActive}
            className={user.active ? 'danger' : 'primary'}
            style={{ fontSize: 12 }}
          >
            {user.active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Edit Row ────────────────────────────────────────────────────────────────

function EditRow({
  user,
  isSelf,
  onCancel,
  onSaved,
  onError,
}: {
  user: AppUser;
  isSelf: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError(err.error ?? 'Failed to update user.');
        return;
      }
      onSaved();
    } catch {
      onError('Network error updating user.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 140, fontSize: 13 }}
        />
      </td>
      <td style={{ color: '#777' }}>{user.email}</td>
      <td>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'standard')}
          style={{ fontSize: 13 }}
          disabled={isSelf}
        >
          <option value="standard">Standard</option>
          <option value="admin">Admin</option>
        </select>
      </td>
      <td colSpan={3} />
      <td style={{ textAlign: 'right' }}>
        <button onClick={handleSave} className="primary" disabled={saving} style={{ fontSize: 12, marginRight: 6 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
      </td>
    </tr>
  );
}

// ─── Toggle active helper ────────────────────────────────────────────────────

async function toggleActive(
  user: AppUser,
  currentUserId: string,
  onSuccess: () => void,
  onError: (msg: string) => void,
) {
  if (user.id === currentUserId) return;

  const action = user.active ? 'deactivate' : 'reactivate';
  if (!window.confirm(`Are you sure you want to ${action} ${user.name} (${user.email})?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      onError(err.error ?? `Failed to ${action} user.`);
      return;
    }
    onSuccess();
  } catch {
    onError(`Network error trying to ${action} user.`);
  }
}
