import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  runId: string;
}

export default function ReviewChat({ runId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Analysis complete. You can ask me to reclassify a user, add an exception, explain a classification, or filter results. For example: "Why was user@company.com classified as Human Review?"',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const res = await apiFetch(`/api/analysis/${runId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json() as { reply?: string; error?: string };
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply ?? data.error ?? 'No response.',
      }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Request failed. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      border: '1px solid #444', borderRadius: 6, background: '#333', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #444', fontWeight: 600, fontSize: 13 }}>
        Review Chat
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            background: m.role === 'user' ? '#5b7bb4' : '#3a3a3a',
            color: '#f0f0f0',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: '#777', fontSize: 12, padding: '4px 0' }}>
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #444', display: 'flex', gap: 8 }}>
        <textarea
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder='Ask about a user, reclassify, or add an exception…'
          style={{ flex: 1, resize: 'none', fontSize: 12 }}
          disabled={loading}
        />
        <button className="primary" onClick={send} disabled={loading || !input.trim()} style={{ alignSelf: 'flex-end' }}>
          Send
        </button>
      </div>
    </div>
  );
}
