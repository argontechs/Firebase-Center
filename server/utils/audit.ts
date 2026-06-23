import { db } from '../db/client';
import { auditLog } from '../db/schema';

export type AuditAction =
  | 'login_success' | 'login_failure' | 'logout' | 'password_change'
  | 'user_create' | 'user_disable' | 'role_change' | 'master_key_rotation'
  | 'ingest_key_issue' | 'ingest_key_revoke'
  | 'send_key_issue' | 'send_key_rotate' | 'send_key_revoke'
  | 'credential_save' | 'credential_rotate'
  | 'campaign_send' | 'import_run'
  | 'api_send'
  | 'audience_save' | 'audience_delete';

export async function audit(input: {
  userId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    userId: input.userId,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metaJsonb: input.meta ?? null,
  });
}
