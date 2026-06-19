// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, flushPromises } from '@nuxt/test-utils/runtime';

const FAKE_CSRF = 'test-csrf-token-ik';

let issued = false;

beforeEach(() => {
  issued = false;
  vi.stubGlobal('useRoute', () => ({ params: { id: 'app1' } }));
  vi.stubGlobal('useCsrf', () => ({
    token: { value: FAKE_CSRF },
    fetchToken: vi.fn(async () => {}),
    headers: vi.fn(() => ({ 'x-csrf-token': FAKE_CSRF })),
  }));
  vi.stubGlobal('$fetch', vi.fn(async (url: string, opts?: any) => {
    if (opts?.method === 'POST' && url.endsWith('/ingest-keys')) {
      issued = true;
      return { key: 'bo_ik_SECRET', id: 'k1', prefix: 'bo_ik_AB', version: 1 };
    }
    if (opts?.method === 'POST' && url.endsWith('/revoke')) return null;
    if (opts?.method === 'POST' && url.endsWith('/rotate')) {
      return { key: 'bo_ik_NEWSECRET', id: 'k1', prefix: 'bo_ik_AB', version: 2 };
    }
    // GET list
    return issued
      ? [{ id: 'k1', keyPrefix: 'bo_ik_AB', version: 1, label: null, createdAt: '2026-06-19', revokedAt: null }]
      : [];
  }));
});

// Import AFTER globals are stubbed.
const { default: IngestKeysPage } = await import('~/app/pages/apps/[id]/ingest-keys.vue');

describe('ingest keys page', () => {
  it('shows the full key exactly once after issuing', async () => {
    const w = await mountSuspended(IngestKeysPage);
    await flushPromises();

    await w.get('[data-testid="issue-key"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="show-once-key"]').text()).toContain('bo_ik_SECRET');
  });

  it('lists issued keys by prefix only (never the full secret)', async () => {
    const w = await mountSuspended(IngestKeysPage);
    await flushPromises();

    await w.get('[data-testid="issue-key"]').trigger('click');
    await flushPromises();

    const html = w.html();
    expect(html).toContain('bo_ik_AB');
    expect(w.find('[data-testid="key-row-k1"]').exists()).toBe(true);
  });
});
