export type MemoryItem = { id: string; text: string; source: string; pinned: boolean; createdAt: string; updatedAt: string };
export type NoteItem = { id: string; title: string; body: string; createdAt: string; updatedAt: string };
export type ContactItem = { id: string; kind: string; address: string; name: string | null; approvedAt: string | null; createdAt: string };

export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}
