import { describe, it, expectTypeOf } from 'vitest';
import type {
  Provider, DevicePlatform, Disposition, NeutralMessage, WireMessage,
  AccessToken, Recipient, DeliveryResult, ResolvedCredential, PushProvider,
} from './types';

describe('push/types surface', () => {
  it('Provider is the fcm|huawei union', () => {
    expectTypeOf<Provider>().toEqualTypeOf<'fcm' | 'huawei'>();
  });

  it('Disposition includes all six normalized outcomes', () => {
    expectTypeOf<Disposition>().toEqualTypeOf<
      | 'DELETE_TOKEN' | 'RETRY_BACKOFF' | 'FIX_REQUEST'
      | 'REAUTH' | 'FIX_CREDENTIALS' | 'CREDENTIAL_NOT_READY'
    >();
  });

  it('DeliveryResult.status is sent|failed|invalid', () => {
    expectTypeOf<DeliveryResult['status']>().toEqualTypeOf<'sent' | 'failed' | 'invalid'>();
  });

  it('NeutralMessage.data is a flat string->string map', () => {
    expectTypeOf<NeutralMessage['data']>().toEqualTypeOf<Record<string, string>>();
  });

  it('ResolvedCredential.platform allows the credential-side "any"', () => {
    expectTypeOf<ResolvedCredential['platform']>().toEqualTypeOf<
      'ios' | 'android' | 'huawei' | 'web' | 'any'
    >();
  });

  it('PushProvider exposes mintToken/render/send', () => {
    expectTypeOf<PushProvider['mintToken']>().toBeFunction();
    expectTypeOf<PushProvider['render']>().toBeFunction();
    expectTypeOf<PushProvider['send']>().toBeFunction();
  });
});
