import type { ParsedRow } from './parse';

export type Provider = 'fcm' | 'huawei';
export type DevicePlatform = 'android' | 'ios' | 'huawei' | 'web';

export interface ValidRow {
  rowNumber: number;
  token: string;
  provider: Provider;
  platform: DevicePlatform;
  externalUserId: string | null;
  attributes: Record<string, string>;
}

export interface RejectedRow {
  rowNumber: number;
  reason: 'TOKEN_MISSING' | 'PROVIDER_UNRECOGNIZED' | 'PLATFORM_MISSING' | 'PLATFORM_INCONSISTENT';
}

export interface ValidationResult {
  valid: ValidRow[];
  rejected: RejectedRow[];
}

const PROVIDERS = new Set<Provider>(['fcm', 'huawei']);
const FCM_PLATFORMS = new Set<DevicePlatform>(['ios', 'android', 'web']);

export function validateRows(rows: ParsedRow[]): ValidationResult {
  const valid: ValidRow[] = [];
  const rejected: RejectedRow[] = [];

  for (const row of rows) {
    if (!row.token) {
      rejected.push({ rowNumber: row.rowNumber, reason: 'TOKEN_MISSING' });
      continue;
    }

    if (!row.provider || !PROVIDERS.has(row.provider as Provider)) {
      rejected.push({ rowNumber: row.rowNumber, reason: 'PROVIDER_UNRECOGNIZED' });
      continue;
    }

    if (!row.platform) {
      rejected.push({ rowNumber: row.rowNumber, reason: 'PLATFORM_MISSING' });
      continue;
    }

    const provider = row.provider as Provider;
    const platform = row.platform as DevicePlatform;

    // Consistency check: huawei provider must use huawei platform;
    // fcm provider must use ios/android/web (not huawei).
    const consistent = provider === 'huawei'
      ? platform === 'huawei'
      : FCM_PLATFORMS.has(platform);

    if (!consistent) {
      rejected.push({ rowNumber: row.rowNumber, reason: 'PLATFORM_INCONSISTENT' });
      continue;
    }

    valid.push({
      rowNumber: row.rowNumber,
      token: row.token,
      provider,
      platform,
      externalUserId: row.externalUserId,
      attributes: row.attributes,
    });
  }

  return { valid, rejected };
}
