// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, flushPromises } from '@nuxt/test-utils/runtime';

const FAKE_CSRF = 'test-csrf-token-history';

const campaigns = [
  {
    id: 'c1',
    title: 'Promo',
    status: 'done',
    createdAt: '2026-06-19T00:00:00Z',
    counts: { sent: 5, failed: 2, invalid: 1, gave_up: 1, not_ready: 1 },
  },
];

const campaignDetail = {
  id: 'c1',
  title: 'Promo',
  status: 'done',
  createdAt: '2026-06-19T00:00:00Z',
  counts: { sent: 5, failed: 2, invalid: 1, gave_up: 1, not_ready: 1 },
  deliveries: [
    {
      id: 'd1',
      token: 'tok-abc',
      provider: 'fcm',
      platform: 'android',
      status: 'done',
      disposition: 'delivered',
      errorCode: null,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('useRoute', () => ({ params: { id: 'app-1' }, query: {} }));
  vi.stubGlobal('useCsrf', () => ({
    token: { value: FAKE_CSRF },
    fetchToken: vi.fn(async () => {}),
    headers: vi.fn(() => ({ 'x-csrf-token': FAKE_CSRF })),
  }));
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/campaigns/')) return campaignDetail;
    if (url.startsWith('/api/campaigns')) return campaigns;
    return {};
  }));
});

// Import AFTER globals are stubbed.
const { default: History } = await import('~/app/pages/apps/[id]/history.vue');

describe('history.vue', () => {
  it('lists campaigns with sent/failed/invalid/gave_up/not_ready counts', async () => {
    const wrapper = await mountSuspended(History);
    await flushPromises();

    const row = wrapper.find('[data-test="campaign-c1"]');
    expect(row.text()).toContain('Promo');
    expect(row.find('[data-test="count-sent"]').text()).toContain('5');
    expect(row.find('[data-test="count-failed"]').text()).toContain('2');
    expect(row.find('[data-test="count-invalid"]').text()).toContain('1');
    expect(row.find('[data-test="count-gave_up"]').text()).toContain('1');
    expect(row.find('[data-test="count-not_ready"]').text()).toContain('1');
  });

  it('shows per-device deliveries when a campaign row is clicked', async () => {
    const wrapper = await mountSuspended(History);
    await flushPromises();

    expect(wrapper.find('[data-test="detail"]').exists()).toBe(false);

    await wrapper.find('[data-test="campaign-c1"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="detail"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="delivery-d1"]').text()).toContain('tok-abc');
    expect(wrapper.find('[data-test="delivery-d1"]').text()).toContain('delivered');
  });
});
