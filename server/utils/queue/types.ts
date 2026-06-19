export const JOB_TYPE_SEND = 'send_chunk';

export interface SendChunkPayload {
  campaignId: string;
  provider: 'fcm' | 'huawei';
  platform: 'android' | 'ios' | 'huawei' | 'web';
  deviceIds: string[];
  chunkIndex: number;
}

export const VENDOR_CHUNK_LIMIT = { fcm: 500, huawei: 1000 } as const;
