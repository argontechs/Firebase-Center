export type Provider = 'fcm' | 'huawei';
export type DevicePlatform = 'android' | 'ios' | 'huawei' | 'web';

export type Disposition =
  | 'DELETE_TOKEN'
  | 'RETRY_BACKOFF'
  | 'FIX_REQUEST'
  | 'REAUTH'
  | 'FIX_CREDENTIALS'
  | 'CREDENTIAL_NOT_READY';

export interface NeutralMessage {
  title: string;
  body: string;
  image?: string;
  data: Record<string, string>;
  mode: 'notification' | 'data';
  priority: 'high' | 'normal';
}

export interface WireMessage {
  readonly provider: Provider;
  readonly raw: unknown;
}

export interface AccessToken {
  token: string;
  expiresAt: number;
}

export interface Recipient {
  deviceId: string | null;
  token: string;
  platform: DevicePlatform;
}

export interface DeliveryResult {
  token: string;
  deviceId: string | null;
  status: 'sent' | 'failed' | 'invalid';
  disposition?: Disposition;
  errorCode?: string;
  responseMeta?: Record<string, unknown>;
}

export interface ResolvedCredential {
  id: string;
  appId: string;
  provider: Provider;
  platform: 'ios' | 'android' | 'huawei' | 'web' | 'any';
  secret: unknown;
  meta: Record<string, unknown>;
}

export interface PushProvider {
  mintToken(credential: ResolvedCredential): Promise<AccessToken>;
  render(message: NeutralMessage): WireMessage;
  send(
    credential: ResolvedCredential,
    message: WireMessage,
    recipients: Recipient[],
  ): Promise<DeliveryResult[]>;
}
