
export interface ActivityEntry {
  ticketId: string;
  ticketCode: string;
  customerName: string | null;
  locationId: number;
  outcome: 'done' | 'noshow';
  resolvedAt: string;
}

let entries: ActivityEntry[] = [];

export function recordResolved(entry: ActivityEntry) {
  entries = [entry, ...entries];
}

export function getActivity(): ActivityEntry[] {
  return entries;
}
