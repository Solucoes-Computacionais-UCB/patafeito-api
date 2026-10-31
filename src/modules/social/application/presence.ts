import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { users } from '../../../db/schema/users.js';
import { handleCandidate } from '../domain/handle.js';

/** Amigo é "online" se fez alguma requisição nos últimos 5 minutos. */
export const ONLINE_WINDOW_MS = 5 * 60_000;
const lastWrite = new Map<string, number>();

/**
 * Atualiza `last_seen_at` sem atrasar a requisição e no máximo uma vez a cada 5 min por usuário
 * (por processo). Falhas são ignoradas: presença é informativa.
 */
export function touchLastSeen(userId: string, now = Date.now()) {
  if (now - (lastWrite.get(userId) ?? 0) < ONLINE_WINDOW_MS) return;
  lastWrite.set(userId, now);
  void db.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, userId)).catch(() => lastWrite.delete(userId));
}

export function isOnline(lastSeenAt: Date | null, now = Date.now()) {
  return !!lastSeenAt && now - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

/** Primeiro @usuário livre derivado do nome (o índice único ainda é a garantia final). */
export async function availableHandle(displayName: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = handleCandidate(displayName);
    const taken = await db.query.users.findFirst({ columns: { id: true }, where: eq(users.handle, candidate) });
    if (!taken) return candidate;
  }
  return handleCandidate(`${displayName}${Date.now()}`);
}
