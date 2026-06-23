// @vitest-environment happy-dom
/**
 * Task G4: Send page component test.
 *
 * Stubs apps list + /api/campaigns/preview; asserts the data-test hooks
 * specified in the task spec.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';

// --- stub data ---------------------------------------------------------------
const appsData = ref([
  { id: 'app-1', name: 'App Alpha', companyId: 'c1' },
  { id: 'app-2', name: 'App Beta', companyId: 'c1' },
]);

const audiencesData = [
  {
    id: 'aud-1',
    appId: 'app-1',
    name: 'VIP Android',
    platform: 'android',
    provider: 'fcm',
    tag: 'vip',
    count: 1,
    createdBy: null,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'aud-2',
    appId: 'app-1',
    name: 'All iOS',
    platform: 'ios',
    provider: 'fcm',
    tag: null,
    count: 42,
    createdBy: null,
    createdAt: '2024-01-01T00:00:00Z',
  },
];

const previewResult = ref({
  byGroup: [
    { provider: 'fcm', platform: 'android', count: 5, credentialReady: true },
    { provider: 'fcm', platform: 'ios', count: 3, credentialReady: true },
  ],
  totalBytes: 512,
  withinLimit: true,
});

// useFetch stub — returns appsData for /api/apps queries; empty otherwise.
const refreshMock = vi.fn();
vi.stubGlobal('useFetch', (url: string | (() => string), _opts?: unknown) => {
  const resolved = typeof url === 'function' ? url() : url;
  if (resolved && String(resolved).includes('/api/apps')) {
    return { data: appsData, refresh: refreshMock };
  }
  return { data: ref(null), refresh: vi.fn() };
});

// $fetch stub — used for preview, send mutations, audiences list, and CSRF.
vi.stubGlobal(
  '$fetch',
  vi.fn().mockImplementation(async (url: string, _opts?: unknown) => {
    if (url === '/api/auth/csrf') return { token: 'csrf-tok' };
    if (url === '/api/campaigns/preview') return previewResult.value;
    if (url === '/api/campaigns') return { campaignId: 'new-camp-1', jobsCreated: 8 };
    if (url === '/api/campaigns/broadcast') return { broadcastId: 'bcast-1', campaignIds: ['c1'] };
    if (typeof url === 'string' && url.includes('/audiences')) return audiencesData;
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
import SendPage from './index.vue';

async function mountPage() {
  const wrapper = mount(
    defineComponent({
      setup() {
        return () => h(Suspense, null, { default: () => h(SendPage) });
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
  appsData.value = [
    { id: 'app-1', name: 'App Alpha', companyId: 'c1' },
    { id: 'app-2', name: 'App Beta', companyId: 'c1' },
  ];
  previewResult.value = {
    byGroup: [
      { provider: 'fcm', platform: 'android', count: 5, credentialReady: true },
      { provider: 'fcm', platform: 'ios', count: 3, credentialReady: true },
    ],
    totalBytes: 512,
    withinLimit: true,
  };
  refreshMock.mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockReset();
  (globalThis.$fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
    if (url === '/api/auth/csrf') return { token: 'csrf-tok' };
    if (url === '/api/campaigns/preview') return previewResult.value;
    if (url === '/api/campaigns') return { campaignId: 'new-camp-1', jobsCreated: 8 };
    if (url === '/api/campaigns/broadcast') return { broadcastId: 'bcast-1', campaignIds: ['c1'] };
    if (typeof url === 'string' && url.includes('/audiences')) return audiencesData;
    return {};
  });
});

describe('send page', () => {
  it('renders an app select element', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="app-select"]').exists()).toBe(true);
  });

  it('renders a broadcast toggle', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="broadcast-toggle"]').exists()).toBe(true);
  });

  it('renders recipients mode selector', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="recipients-mode"]').exists()).toBe(true);
  });

  it('renders message fields: title, body, data, mode, priority', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="send-title"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="send-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="send-data"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="send-mode"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="send-priority"]').exists()).toBe(true);
  });

  it('renders a timing/when-mode selector', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="when-mode"]').exists()).toBe(true);
  });

  it('does not show schedule-at input when "now" is selected', async () => {
    const wrapper = await mountPage();
    // By default "now" is selected — schedule-at should be hidden
    expect(wrapper.find('[data-test="schedule-at"]').exists()).toBe(false);
  });

  it('reveals schedule-at datetime input when "schedule" timing is selected', async () => {
    const wrapper = await mountPage();
    const whenMode = wrapper.find('[data-test="when-mode"]');
    await whenMode.setValue('schedule');
    await nextTick();
    expect(wrapper.find('[data-test="schedule-at"]').exists()).toBe(true);
  });

  it('renders a Preview button', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="preview-btn"]').exists()).toBe(true);
  });

  it('renders a Send button that is initially disabled (not yet previewed)', async () => {
    const wrapper = await mountPage();
    const sendBtn = wrapper.find('[data-test="send-submit"]');
    expect(sendBtn.exists()).toBe(true);
    expect(sendBtn.attributes('disabled') !== undefined || (sendBtn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls $fetch for preview when Preview is clicked, then shows preview-breakdown', async () => {
    const wrapper = await mountPage();

    // Fill required fields so preview can run
    await wrapper.find('[data-test="send-title"]').setValue('Hello World');
    await wrapper.find('[data-test="send-body"]').setValue('Test body');
    await nextTick();

    // Click preview and flush all pending promises/microtasks
    await wrapper.find('[data-test="preview-btn"]').trigger('click');
    await flushPromises();
    await nextTick();

    // $fetch should have been called (CSRF + preview)
    expect(globalThis.$fetch).toHaveBeenCalled();

    // Preview breakdown should now be visible
    expect(wrapper.find('[data-test="preview-breakdown"]').exists()).toBe(true);
  });

  it('enables send button after preview', async () => {
    const wrapper = await mountPage();

    await wrapper.find('[data-test="send-title"]').setValue('Hello World');
    await wrapper.find('[data-test="send-body"]').setValue('Test body');
    await nextTick();

    await wrapper.find('[data-test="preview-btn"]').trigger('click');
    await flushPromises();
    await nextTick();

    const sendBtn = wrapper.find('[data-test="send-submit"]');
    expect((sendBtn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows "Schedule" as the send button label when schedule timing is chosen', async () => {
    const wrapper = await mountPage();

    const whenMode = wrapper.find('[data-test="when-mode"]');
    await whenMode.setValue('schedule');
    await nextTick();

    // Set a schedule-at value
    const scheduleAt = wrapper.find('[data-test="schedule-at"]');
    await scheduleAt.setValue('2030-12-31T10:00');
    await nextTick();

    // Run preview to enable the submit button
    await wrapper.find('[data-test="send-title"]').setValue('Hello World');
    await wrapper.find('[data-test="send-body"]').setValue('Test body');
    await wrapper.find('[data-test="preview-btn"]').trigger('click');
    await flushPromises();
    await nextTick();

    const sendBtn = wrapper.find('[data-test="send-submit"]');
    expect(sendBtn.text()).toContain('Schedule');
  });

  it('shows audience-select dropdown (not UUID text input) when recipients=audience is chosen', async () => {
    const wrapper = await mountPage();

    // Select an app first
    await wrapper.find('[data-test="app-select"]').setValue('app-1');
    await nextTick();

    // Switch to audience mode
    await wrapper.find('[data-test="recipients-mode"]').setValue('audience');
    await nextTick();
    await flushPromises();
    await nextTick();

    // Should render the select, not the UUID text input
    expect(wrapper.find('[data-test="audience-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="audience-id-input"]').exists()).toBe(false);
  });

  it('audience-select has one option per stubbed audience with name label', async () => {
    const wrapper = await mountPage();

    await wrapper.find('[data-test="app-select"]').setValue('app-1');
    await nextTick();
    await wrapper.find('[data-test="recipients-mode"]').setValue('audience');
    await nextTick();
    await flushPromises();
    await nextTick();

    const select = wrapper.find('[data-test="audience-select"]');
    const options = select.findAll('option');
    // First option is the placeholder, then one per stubbed audience
    const audienceOptions = options.filter((o) => o.attributes('value') && o.attributes('value') !== '');
    expect(audienceOptions).toHaveLength(audiencesData.length);
    expect(audienceOptions[0].text()).toContain('VIP Android');
    expect(audienceOptions[1].text()).toContain('All iOS');
  });

  it('selecting an audience drives a segment send with that audience_id', async () => {
    const wrapper = await mountPage();

    await wrapper.find('[data-test="app-select"]').setValue('app-1');
    await nextTick();
    await wrapper.find('[data-test="recipients-mode"]').setValue('audience');
    await nextTick();
    await flushPromises();
    await nextTick();

    // Pick the first audience
    await wrapper.find('[data-test="audience-select"]').setValue('aud-1');
    await nextTick();

    // Fill message and preview
    await wrapper.find('[data-test="send-title"]').setValue('Segment Test');
    await wrapper.find('[data-test="send-body"]').setValue('Body text');
    await wrapper.find('[data-test="preview-btn"]').trigger('click');
    await flushPromises();
    await nextTick();

    // Submit via form (button is type="submit"; trigger on the form element)
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await nextTick();

    // Assert $fetch was called with the campaign endpoint and audience_id
    const calls = (globalThis.$fetch as ReturnType<typeof vi.fn>).mock.calls;
    // The send composable passes the full SendPayload as body; targetType is a top-level field
    const sendCall = calls.find(
      ([url, opts]: [string, { body?: Record<string, unknown> }]) =>
        url === '/api/campaigns' && opts?.body?.targetType === 'segment',
    );
    expect(sendCall).toBeDefined();
    expect(sendCall[1].body.targetValue).toMatchObject({ audience_id: 'aud-1' });
  });
});
