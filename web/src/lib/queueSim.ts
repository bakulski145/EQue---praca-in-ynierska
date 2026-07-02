export type EntryStatus = 'waiting' | 'serving' | 'done' | 'noshow';

export interface QueueEntry {
  id: number;
  code: string;
  clientLabel: string;
  addedAt: string;
  etaMin: number;
  status: EntryStatus;
  resolvedAt?: string;
}

export interface LocationQueueState {
  serving: QueueEntry | null;
  waiting: QueueEntry[];
  completed: QueueEntry[];
}

/* Deterministic per-location simulated queue snapshot — same location id
   always seeds the same shape, so the dashboard KPIs and the live queue
   tab agree with each other without sharing real state. */

export function formatTime(d: Date) {
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function makeEntry(base: number, offset: number, minutesAgo: number, etaMin: number, status: EntryStatus): QueueEntry {
  const num = base + offset;
  return {
    id: num,
    code: `A-${String(num).padStart(3, '0')}`,
    clientLabel: `Klient #${String(num).padStart(3, '0')}`,
    addedAt: formatTime(new Date(Date.now() - minutesAgo * 60000)),
    etaMin,
    status,
  };
}

export function seedLocationQueue(locationId: string): LocationQueueState {
  const hash = Array.from(locationId).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const base = 20 + (hash % 60);

  const serving = { ...makeEntry(base, 0, 14, 0, 'serving') };
  const waiting = [1, 2, 3, 4].map((n, i) =>
    makeEntry(base, n, (4 - i) * 3, (i + 1) * 6, 'waiting')
  );
  const completed = [-3, -2, -1].map((n, i) => ({
    ...makeEntry(base, n, 20 - i * 4, 0, i === 1 ? 'noshow' : 'done'),
    resolvedAt: formatTime(new Date(Date.now() - (18 - i * 4) * 60000)),
  } as QueueEntry));

  return { serving, waiting, completed };
}
