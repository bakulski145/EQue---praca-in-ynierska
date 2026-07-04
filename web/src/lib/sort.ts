/**
 * Sortuje kopię tablicy alfabetycznie (polska lokalizacja) wg podanego pola.
 * Używane wszędzie tam, gdzie lista mogłaby "skakać" przy odświeżeniu z WS —
 * stała alfabetyczna kolejność sprawia, że elementy nie zmieniają miejsca.
 */
export function sortByName<T>(items: T[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => getName(a).localeCompare(getName(b), 'pl'));
}
