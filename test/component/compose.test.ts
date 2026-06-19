// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, flushPromises } from '@nuxt/test-utils/runtime';

const FAKE_CSRF = 'test-csrf-token-compose';

const previewOk = {
  byGroup: [
    { provider: 'fcm', platform: 'android', count: 3, ready: true },
    { provider: 'huawei', platform: 'huawei', count: 2, ready: false },
  ],
  totalBytes: 120,
  withinLimit: true,
};

const previewTooLarge = {
  byGroup: [{ provider: 'fcm', platform: 'android', count: 1, ready: true }],
  totalBytes: 5000,
  withinLimit: false,
};

beforeEach(() => {
  vi.stubGlobal('useRoute', () => ({ params: { id: 'app-1' } }));
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
  vi.stubGlobal('useCsrf', () => ({
    token: { value: FAKE_CSRF },
    fetchToken: vi.fn(async () => {}),
    headers: vi.fn(() => ({ 'x-csrf-token': FAKE_CSRF })),
  }));
  // Default $fetch: preview returns ok
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/campaigns/preview') return previewOk;
    if (url === '/api/campaigns') return { campaignId: 'camp-1' };
    return {};
  }));
});

// Import AFTER globals are stubbed.
const { default: Compose } = await import('~/app/pages/apps/[id]/compose.vue');

describe('compose.vue', () => {
  it('renders per-(provider,platform) recipient preview and flags not-ready groups', async () => {
    const wrapper = await mountSuspended(Compose);
    await wrapper.find('[data-test="preview-btn"]').trigger('click');
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain('fcm');
    expect(html).toContain('android');
    expect(html).toContain('huawei');
    // not-ready flag visible for huawei group
    expect(wrapper.find('[data-test="group-huawei-huawei"]').classes()).toContain('not-ready');
    // within-limit shown
    expect(wrapper.find('[data-test="within-limit"]').text()).toContain('OK');
  });

  it('disables send when preview reports withinLimit=false', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/campaigns/preview') return previewTooLarge;
      return {};
    }));
    const wrapper = await mountSuspended(Compose);
    await wrapper.find('[data-test="preview-btn"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="send-btn"]').attributes('disabled')).toBeDefined();
  });
});
