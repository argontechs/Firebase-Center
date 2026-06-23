// @vitest-environment happy-dom
/**
 * Task G5: History page component test.
 *
 * Stubs /api/campaigns list; asserts the data-test hooks
 * specified in the task spec (G5).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';

// --- stub campaigns data ---------------------------------------------------
const now = new Date().toISOString();
const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const campaignsData = ref([
  {
    id: 'camp-1',
    title: 'Welcome Push',
    appId: 'app-1',
    appName: 'App Alpha',
    status: 'done',
    createdAt: now,
    scheduledAt: null,
    broadcastId: null,
    counts: { sent: 10, failed: 1, invalid: 0, gave_up: 0, not_ready: 0 },
  },
  {
    id: 'camp-2',
    title: 'Scheduled Push',
    appId: 'app-1',
    appName: 'App Alpha',
    status: 'scheduled',
    createdAt: now,
    scheduledAt: futureDate,
    broadcastId: null,
    counts: { sent: 0, failed: 0, invalid: 0, gave_up: 0, not_ready: 0 },
  },
  {
    id: 'camp-3',
    title: 'Canceled Push',
    appId: 'app-2',
    appName: 'App Beta',
    status: 'canceled',
    createdAt: now,
    scheduledAt: null,
    broadcastId: null,
    counts: { sent: 0, failed: 0, invalid: 0, gave_up: 0, not_ready: 0 },
  },
]);

// useFetch stub
const refreshMock = vi.fn();
vi.stubGlobal('useFetch', (_url: string, _opts?: unknown) => ({
  data: campaignsData,
  refresh: refreshMock,
}));

// $fetch stub
vi.stubGlobal(
  '$fetch',
  vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/auth/csrf') return { token: 'csrf-tok' };
    if (url && url.includes('/cancel')) return { ok: true };
    return {};
  }),
);

// useRoute stub
vi.stubGlobal('useRoute', () => ({
  query: {},
}));

// navigateTo stub
vi.stubGlobal('navigateTo', vi.fn());

// NuxtLink stub
const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to) }, slots.default?.());
  },
});

// Import AFTER globals are stubbed.
import HistoryPage from './index.vue';

async function mountPage() {
  const wrapper = mount(
    defineComponent({
      setup() {
        return () => h(Suspense, null, { default: () => h(HistoryPage) });
      },
    }),
    {
      global: {
        components: { NuxtLink },
        stubs: { NuxtLink },
      },
    },
  );
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  campaignsData.value = [
    {
      id: 'camp-1',
      title: 'Welcome Push',
      appId: 'app-1',
      appName: 'App Alpha',
      status: 'done',
      createdAt: now,
      scheduledAt: null,
      broadcastId: null,
      counts: { sent: 10, failed: 1, invalid: 0, gave_up: 0, not_ready: 0 },
    },
    {
      id: 'camp-2',
      title: 'Scheduled Push',
      appId: 'app-1',
      appName: 'App Alpha',
      status: 'scheduled',
      createdAt: now,
      scheduledAt: futureDate,
      broadcastId: null,
      counts: { sent: 0, failed: 0, invalid: 0, gave_up: 0, not_ready: 0 },
    },
    {
      id: 'camp-3',
      title: 'Canceled Push',
      appId: 'app-2',
      appName: 'App Beta',
      status: 'canceled',
      createdAt: now,
      scheduledAt: null,
      broadcastId: null,
      counts: { sent: 0, failed: 0, invalid: 0, gave_up: 0, not_ready: 0 },
    },
  ];
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
    if (url === '/api/auth/csrf') return { token: 'csrf-tok' };
    if (url && url.includes('/cancel')) return { ok: true };
    return {};
  });
});

describe('history page', () => {
  it('renders the page title as "History"', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="history-title"]').text()).toBe('History');
  });

  it('renders a table row for each campaign', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="campaign-row"]');
    expect(rows).toHaveLength(3);
  });

  it('shows title in each campaign row', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="campaign-row"]');
    expect(rows[0]!.text()).toContain('Welcome Push');
    expect(rows[1]!.text()).toContain('Scheduled Push');
  });

  it('shows a status badge in each row', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="campaign-row"]');
    // First row should have a done/ok badge
    expect(rows[0]!.find('[data-test="status-badge"]').exists()).toBe(true);
  });

  it('shows "Scheduled for" text for scheduled campaigns', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="campaign-row"]');
    // Second row is scheduled
    expect(rows[1]!.text()).toContain('Scheduled for');
  });

  it('shows delivery counts as small badges', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="campaign-row"]');
    // First row (done) has sent=10, failed=1
    const firstRow = rows[0]!;
    const countBadges = firstRow.findAll('[data-test="count-badge"]');
    expect(countBadges.length).toBeGreaterThan(0);
  });

  it('shows a Cancel button only for scheduled campaigns', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('[data-test="campaign-row"]');
    // First row (done) should NOT have cancel button
    expect(rows[0]!.find('[data-test="cancel-campaign"]').exists()).toBe(false);
    // Second row (scheduled) SHOULD have cancel button
    expect(rows[1]!.find('[data-test="cancel-campaign"]').exists()).toBe(true);
    // Third row (canceled) should NOT have cancel button
    expect(rows[2]!.find('[data-test="cancel-campaign"]').exists()).toBe(false);
  });

  it('shows an app filter element', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="app-filter"]').exists()).toBe(true);
  });

  it('calls cancel endpoint when Cancel button is clicked', async () => {
    const wrapper = await mountPage();
    const scheduledRow = wrapper.findAll('[data-test="campaign-row"]')[1]!;
    const cancelBtn = scheduledRow.find('[data-test="cancel-campaign"]');
    expect(cancelBtn.exists()).toBe(true);

    await cancelBtn.trigger('click');
    await flushPromises();
    await nextTick();

    // $fetch should have been called (CSRF + cancel)
    expect(globalThis.$fetch).toHaveBeenCalled();
  });

  it('shows empty state when no campaigns', async () => {
    campaignsData.value = [];
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="empty-history"]').exists()).toBe(true);
  });
});
