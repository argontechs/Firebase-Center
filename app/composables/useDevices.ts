import { useCsrf } from '~/composables/useCsrf';

export interface DeviceRow {
  id: string;
  appId: string;
  provider: string;
  platform: string;
  token: string;
  externalUserId: string | null;
  tags: string[];
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface DeviceListResult {
  devices: DeviceRow[];
  nextCursor?: string;
}

export interface ManualAddBody {
  token: string;
  provider: 'fcm' | 'huawei';
  platform: 'android' | 'ios' | 'huawei' | 'web';
  externalUserId?: string;
  tags?: string[];
}

export interface DeviceListParams {
  appId?: string;
  platform?: string;
  provider?: string;
  tag?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export function useDevices() {
  const csrf = useCsrf();

  async function list(params: DeviceListParams = {}): Promise<DeviceListResult> {
    const query = new URLSearchParams();
    if (params.appId) query.set('appId', params.appId);
    if (params.platform) query.set('platform', params.platform);
    if (params.provider) query.set('provider', params.provider);
    if (params.tag) query.set('tag', params.tag);
    if (params.q) query.set('q', params.q);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    const qs = query.toString();
    return $fetch<DeviceListResult>(`/api/devices${qs ? `?${qs}` : ''}`);
  }

  async function manualAdd(appId: string, body: ManualAddBody): Promise<{ id: string }> {
    await csrf.fetchToken();
    return $fetch<{ id: string }>(`/api/apps/${appId}/devices/manual`, {
      method: 'POST',
      headers: csrf.headers(),
      body,
    });
  }

  async function setTags(id: string, tags: string[]): Promise<void> {
    await csrf.fetchToken();
    await $fetch(`/api/devices/${id}`, {
      method: 'PATCH',
      headers: csrf.headers(),
      body: { tags },
    });
  }

  async function remove(id: string): Promise<void> {
    await csrf.fetchToken();
    await $fetch(`/api/devices/${id}`, {
      method: 'DELETE',
      headers: csrf.headers(),
    });
  }

  return { list, manualAdd, setTags, remove };
}
