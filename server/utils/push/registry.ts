import type { Provider, PushProvider } from './types';
import { fcmAdapter } from './fcm-adapter';
import { huaweiAdapter } from './huawei-adapter';

const adapters: Record<Provider, PushProvider> = {
  fcm: fcmAdapter,
  huawei: huaweiAdapter,
};

export function getAdapter(provider: Provider): PushProvider {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`unknown provider: ${provider}`);
  return adapter;
}
