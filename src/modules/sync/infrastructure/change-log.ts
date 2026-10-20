import { syncChanges } from '../../../db/schema/sync.js';
import { db } from '../../../db/client.js';

type ChangeWriter = Pick<typeof db, 'insert'>;

// O tipo mínimo permite usar tanto o banco quanto uma transação Drizzle.
export async function recordSyncChange(writer: ChangeWriter, change: {
  userId: string;
  entityType: 'task' | 'notification' | 'pet' | 'inventory';
  entityId: string;
  changeType: 'upsert' | 'delete';
  version: number | string;
  data: unknown;
}) {
  await writer.insert(syncChanges).values({ ...change, version: String(change.version) });
}
