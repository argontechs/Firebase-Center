import { useCsrf } from '~/composables/useCsrf';

export interface AudienceRow {
  id: string;
  appId: string;
  name: string;
  platform: 'android' | 'ios' | 'huawei' | 'web' | null;
  provider: 'fcm' | 'huawei' | null;
  tag: string | null;
  createdBy: string | null;
  createdAt: string;
  count: number;
}

export interface AudienceBody {
  name: string;
  platform?: 'android' | 'ios' | 'huawei' | 'web';
  provider?: 'fcm' | 'huawei';
  tag?: string;
}

export interface AudienceFilter {
  platform?: 'android' | 'ios' | 'huawei' | 'web';
  provider?: 'fcm' | 'huawei';
  tag?: string;
}

export function useAudiences() {
  const csrf = useCsrf();

  async function list(appId: string): Promise<AudienceRow[]> {
    return $fetch<AudienceRow[]>(`/api/apps/${appId}/audiences`);
  }

  async function create(appId: string, body: AudienceBody): Promise<AudienceRow> {
    await csrf.fetchToken();
    return $fetch<AudienceRow>(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      headers: csrf.headers(),
      body,
    });
  }

  async function update(appId: string, aid: string, body: Partial<AudienceBody>): Promise<AudienceRow> {
    await csrf.fetchToken();
    return $fetch<AudienceRow>(`/api/apps/${appId}/audiences/${aid}`, {
      method: 'PATCH',
      headers: csrf.headers(),
      body,
    });
  }

  async function remove(appId: string, aid: string): Promise<void> {
    await csrf.fetchToken();
    await $fetch(`/api/apps/${appId}/audiences/${aid}`, {
      method: 'DELETE',
      headers: csrf.headers(),
    });
  }

  async function previewCount(appId: string, filter: AudienceFilter): Promise<number> {
    const query = new URLSearchParams();
    if (filter.platform) query.set('platform', filter.platform);
    if (filter.provider) query.set('provider', filter.provider);
    if (filter.tag) query.set('tag', filter.tag);
    const qs = query.toString();
    const res = await $fetch<{ count: number }>(`/api/apps/${appId}/audiences/count${qs ? `?${qs}` : ''}`);
    return res.count;
  }

  return { list, create, update, remove, previewCount };
}
