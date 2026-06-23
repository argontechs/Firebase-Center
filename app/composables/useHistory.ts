import { useCsrf } from '~/composables/useCsrf';

export interface CampaignCounts {
  sent: number;
  failed: number;
  invalid: number;
  gave_up: number;
  not_ready: number;
}

export interface CampaignRow {
  id: string;
  title: string;
  status: string;
  scheduledAt: string | null;
  broadcastId: string | null;
  createdAt: string;
  counts: CampaignCounts;
  appId?: string;
  appName?: string;
}

export interface HistoryListParams {
  appId?: string;
}

export function useHistory() {
  const csrf = useCsrf();

  async function list(params: HistoryListParams = {}): Promise<CampaignRow[]> {
    const query = new URLSearchParams();
    if (params.appId) query.set('appId', params.appId);
    const qs = query.toString();
    return $fetch<CampaignRow[]>(`/api/campaigns${qs ? `?${qs}` : ''}`);
  }

  async function cancel(id: string): Promise<{ ok: boolean }> {
    await csrf.fetchToken();
    return $fetch<{ ok: boolean }>(`/api/campaigns/${id}/cancel`, {
      method: 'POST',
      headers: csrf.headers(),
    });
  }

  return { list, cancel };
}
