/**
 * Log akcji na biletach (obsłużono / nie zgłosił się) wykonanych w tej karcie
 * przeglądarki. Backend nie ma jeszcze endpointu zwracającego historię
 * biletów (COMPLETED/CANCELLED) per lokalizacja, więc to jest jedyne dziś
 * możliwe źródło "ile obsłużono" — realne akcje, ale bez pamięci między
 * sesjami/urządzeniami. Zniknie, gdy backend dostanie realny endpoint historii.
 */

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
