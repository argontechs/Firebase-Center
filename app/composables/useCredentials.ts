import type { CredentialListMeta } from '~~/server/utils/credentials/list';
import type { CredentialMeta } from '~~/server/utils/credentials/meta';

export function useCredentials(appId: string) {
  const fetchList = () => $fetch<CredentialListMeta[]>(`/api/apps/${appId}/credentials`);

  const save = (body: {
    provider: string;
    platform: string;
    label?: string;
    secret: string;
    meta?: Record<string, unknown>;
  }) => $fetch<CredentialMeta>(`/api/apps/${appId}/credentials`, { method: 'POST', body });

  const rotate = (cid: string, body: { secret: string; meta?: Record<string, unknown> }) =>
    $fetch<CredentialMeta>(`/api/apps/${appId}/credentials/${cid}/rotate`, { method: 'POST', body });

  return { fetchList, save, rotate };
}
