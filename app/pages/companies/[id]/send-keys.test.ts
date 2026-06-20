// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick, h, Suspense } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';

// --- Nuxt composable / global stubs -----------------------------------------
const mockKeys = ref<{ id: string; keyPrefix: string; version: number; label: string | null; createdAt: string; revokedAt: string | null }[]>([]);

vi.stubGlobal('useFetch', (url: string) => {
  if (url.includes('/send-keys')) return { data: mockKeys, refresh: vi.fn() };
  return { data: ref(null), refresh: vi.fn() };
});

const fetchMock = vi.fn().mockResolvedValue({});
vi.stubGlobal('$fetch', fetchMock);

// useCsrf stub — auto-imported by Nuxt; stub as a global for Vitest.
const csrfHeaders = { 'x-csrf-token': 'test-token' };
vi.stubGlobal('useCsrf', () => ({
  token: ref('test-token'),
  fetchToken: vi.fn().mockResolvedValue(undefined),
  headers: () => csrfHeaders,
}));

// NuxtLink stub as a render-function component (no runtime template compiler needed).
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object] } },
  setup(props, { slots }) {
    return () => h('a', { href: String(props.to) }, slots.default?.());
  },
});

// Import AFTER globals are stubbed.
import SendKeysPage from './send-keys.vue';

// Build a memory router with a route that supplies the :id param.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/companies/:id/send-keys', component: SendKeysPage }],
  });
}

// Async setup requires a <Suspense> wrapper so the component fully resolves.
async function mountPage() {
  const router = makeRouter();
  await router.push('/companies/c1/send-keys');
  await router.isReady();

  const wrapper = mount(
    defineComponent({
      setup() { return () => h(Suspense, null, { default: () => h(SendKeysPage) }); },
    }),
    { global: { plugins: [router], components: { NuxtLink }, stubs: { NuxtLink } } },
  );
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  mockKeys.value = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({});
});

// Ensure any vi.stubGlobal() calls in individual tests are cleaned up after each
// test, so a thrown assertion cannot leak a modified stub into later tests.
afterEach(() => {
  vi.unstubAllGlobals();
  // Re-apply the module-level stubs that the rest of the suite depends on.
  vi.stubGlobal('useFetch', (url: string) => {
    if (url.includes('/send-keys')) return { data: mockKeys, refresh: vi.fn() };
    return { data: ref(null), refresh: vi.fn() };
  });
  vi.stubGlobal('$fetch', fetchMock);
  vi.stubGlobal('useCsrf', () => ({
    token: ref('test-token'),
    fetchToken: vi.fn().mockResolvedValue(undefined),
    headers: () => csrfHeaders,
  }));
});

describe('send-keys page', () => {
  // -----------------------------------------------------------------------
  // List: prefix-only display
  // -----------------------------------------------------------------------
  it('renders the heading', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Send keys');
  });

  it('shows an "Issue key" button', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="issue-key"]').exists()).toBe(true);
  });

  it('lists keys with prefix-only (no full key shown in the table)', async () => {
    mockKeys.value = [
      { id: 'k1', keyPrefix: 'bo_sk_abc', version: 1, label: 'primary', createdAt: '2026-01-01T00:00:00Z', revokedAt: null },
    ];
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="key-row-k1"]').exists()).toBe(true);
    // Prefix is shown with ellipsis — never the full key
    expect(wrapper.find('[data-testid="key-row-k1"]').text()).toContain('bo_sk_abc');
    // The full key is never in the DOM at list time
    expect(wrapper.html()).not.toContain('bo_sk_FULLKEY');
  });

  it('shows revoked badge for revoked keys', async () => {
    mockKeys.value = [
      { id: 'k2', keyPrefix: 'bo_sk_xyz', version: 1, label: null, createdAt: '2026-01-01T00:00:00Z', revokedAt: '2026-02-01T00:00:00Z' },
    ];
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="key-row-k2"]').text()).toContain('revoked');
  });

  it('hides revoke button for already-revoked keys', async () => {
    mockKeys.value = [
      { id: 'k2', keyPrefix: 'bo_sk_xyz', version: 1, label: null, createdAt: '2026-01-01T00:00:00Z', revokedAt: '2026-02-01T00:00:00Z' },
    ];
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="revoke-k2"]').exists()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Issue key: show-once
  // -----------------------------------------------------------------------
  it('shows the full key ONCE after issuing, with a "you won\'t see this again" warning', async () => {
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'POST' && url.includes('/send-keys') && !url.includes('/revoke') && !url.includes('/rotate')) {
        return { id: 'k-new', fullKey: 'bo_sk_FULLKEY123', keyPrefix: 'bo_sk_FUL', version: 1 };
      }
      return {};
    });

    const wrapper = await mountPage();
    await wrapper.find('[data-testid="issue-key"]').trigger('click');
    await nextTick();
    await nextTick();

    const showOnce = wrapper.find('[data-testid="show-once-key"]');
    expect(showOnce.exists()).toBe(true);
    expect(showOnce.text()).toContain('bo_sk_FULLKEY123');
    // Warning text
    expect(showOnce.text().toLowerCase()).toMatch(/won.?t see|not.+shown again|copy.+now|copy this key/);
  });

  it('dismisses the show-once panel when "I\'ve copied it" is clicked', async () => {
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'POST' && url.includes('/send-keys') && !url.includes('/revoke') && !url.includes('/rotate')) {
        return { id: 'k-new', fullKey: 'bo_sk_FULLKEY123', keyPrefix: 'bo_sk_FUL', version: 1 };
      }
      return {};
    });

    const wrapper = await mountPage();
    await wrapper.find('[data-testid="issue-key"]').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('[data-testid="show-once-key"]').exists()).toBe(true);
    await wrapper.find('[data-testid="dismiss-show-once"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="show-once-key"]').exists()).toBe(false);
  });

  it('calls fetchToken() before issuing (CSRF guard)', async () => {
    const fetchTokenSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('useCsrf', () => ({
      token: ref('test-token'),
      fetchToken: fetchTokenSpy,
      headers: () => csrfHeaders,
    }));

    // Re-mount after updating stub
    fetchMock.mockResolvedValue({ id: 'k-new', fullKey: 'bo_sk_X', keyPrefix: 'bo_sk_', version: 1 });
    const wrapper = await mountPage();
    await wrapper.find('[data-testid="issue-key"]').trigger('click');
    await nextTick();
    await nextTick();
    expect(fetchTokenSpy).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Revoke
  // -----------------------------------------------------------------------
  it('revoke button calls fetchToken() then the revoke endpoint with CSRF headers', async () => {
    mockKeys.value = [
      { id: 'k1', keyPrefix: 'bo_sk_abc', version: 1, label: null, createdAt: '2026-01-01T00:00:00Z', revokedAt: null },
    ];
    fetchMock.mockResolvedValue(undefined);

    const fetchTokenSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('useCsrf', () => ({
      token: ref('test-token'),
      fetchToken: fetchTokenSpy,
      headers: () => csrfHeaders,
    }));

    const wrapper = await mountPage();
    await wrapper.find('[data-testid="revoke-k1"]').trigger('click');
    await nextTick();
    await nextTick();

    // Must have called fetchToken() before sending the request (CSRF contract).
    expect(fetchTokenSpy).toHaveBeenCalled();

    // Must have called the revoke endpoint with CSRF headers.
    const revokeCalls = fetchMock.mock.calls.filter(([url, opts]) =>
      url.includes('/revoke') && opts?.method === 'POST'
    );
    expect(revokeCalls.length).toBeGreaterThanOrEqual(1);
    expect(revokeCalls[0][0]).toMatch(/send-keys\/k1\/revoke/);
    expect(revokeCalls[0][1].headers).toEqual(csrfHeaders);
  });
});
