import { useCsrf } from '~/composables/useCsrf';

export interface AudienceFilter {
  platform?: 'android' | 'ios' | 'huawei' | 'web';
  provider?: 'fcm' | 'huawei';
  tag?: string;
}

export interface Recipients {
  type: 'all' | 'tokens' | 'segment';
  device_ids?: string[];
  audience_id?: string;
  filter?: AudienceFilter;
}

export interface Message {
  title: string;
  body: string;
  data?: Record<string, string>;
  mode?: 'notification' | 'data';
  priority?: 'high' | 'normal';
  image?: string;
}

export interface PreviewGroup {
  provider: string;
  platform: string;
  count: number;
  credentialReady: boolean;
}

export interface PreviewResult {
  byGroup: PreviewGroup[];
  totalBytes: number;
  withinLimit: boolean;
}

export interface SendPayload {
  appId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  mode?: 'notification' | 'data';
  priority?: 'high' | 'normal';
  targetType: 'all' | 'tokens' | 'segment';
  targetValue: {
    device_ids?: string[];
    audience_id?: string;
    filter?: AudienceFilter;
  };
  providerScope?: 'fcm' | 'huawei' | 'both';
  image?: string;
  scheduledAt?: string;
}

export interface BroadcastPayload {
  appIds: string[];
  message: Message;
  recipients: Recipients;
  providerScope?: 'fcm' | 'huawei' | 'both';
  scheduledAt?: string;
}

export function useSend() {
  const csrf = useCsrf();

  async function preview(
    appId: string,
    recipients: Recipients,
    message: Message,
    providerScope: 'fcm' | 'huawei' | 'both' = 'both',
  ): Promise<PreviewResult> {
    await csrf.fetchToken();
    const targetValue: SendPayload['targetValue'] = {};
    if (recipients.device_ids) targetValue.device_ids = recipients.device_ids;
    if (recipients.audience_id) targetValue.audience_id = recipients.audience_id;
    if (recipients.filter) targetValue.filter = recipients.filter;

    return $fetch<PreviewResult>('/api/campaigns/preview', {
      method: 'POST',
      headers: csrf.headers(),
      body: {
        appId,
        targetType: recipients.type,
        targetValue,
        providerScope,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        mode: message.mode ?? 'notification',
        priority: message.priority ?? 'high',
        ...(message.image ? { image: message.image } : {}),
      },
    });
  }

  async function send(payload: SendPayload): Promise<{ campaignId: string; jobsCreated?: number; scheduled?: boolean }> {
    await csrf.fetchToken();
    return $fetch('/api/campaigns', {
      method: 'POST',
      headers: csrf.headers(),
      body: payload,
    });
  }

  async function broadcast(payload: BroadcastPayload): Promise<{ broadcastId: string; campaignIds: string[] }> {
    await csrf.fetchToken();
    return $fetch('/api/campaigns/broadcast', {
      method: 'POST',
      headers: csrf.headers(),
      body: payload,
    });
  }

  return { preview, send, broadcast };
}
