// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const FAKE_CSRF = 'test-csrf-token-dev';

beforeEach(() => {
  vi.stubGlobal('useRoute', () => ({ params: { id: 'app1' } }));
  vi.stubGlobal('useCsrf', () => ({
    token: { value: FAKE_CSRF },
    fetchToken: vi.fn(async () => {}),
    headers: vi.fn(() => ({ 'x-csrf-token': FAKE_CSRF })),
  }));
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url.includes('/devices') && !url.includes('imports')) return { devices: [], total: 0 };
    if (url.includes('/imports')) return { importId: 'imp1', total: 3, inserted: 2, updated: 0, failed: 1 };
    return {};
  }));
});

// Import AFTER globals are stubbed.
const { default: DevicesPage } = await import('~/app/pages/apps/[id]/devices.vue');

describe('devices import wizard', () => {
  it('starts on the upload step', async () => {
    const w = mount(DevicesPage);
    await flushPromises();
    expect(w.find('[data-testid="step-upload"]').exists()).toBe(true);
    expect(w.find('[data-testid="step-map"]').exists()).toBe(false);
  });

  it('advances to the mapping step after a file is chosen', async () => {
    const w = mount(DevicesPage);
    await flushPromises();

    const file = new File(['tok,prov,plat\nT1,fcm,android\n'], 'a.csv', { type: 'text/csv' });
    const input = w.get('[data-testid="file-input"]');
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await flushPromises();

    expect(w.find('[data-testid="step-map"]').exists()).toBe(true);
    expect(w.find('[data-testid="step-upload"]').exists()).toBe(false);
  });

  it('shows the failed count on the results step after submit', async () => {
    const w = mount(DevicesPage);
    await flushPromises();

    const file = new File(['tok,prov,plat\nT1,fcm,android\n'], 'a.csv', { type: 'text/csv' });
    const input = w.get('[data-testid="file-input"]');
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await flushPromises();

    await w.get('[data-testid="run-import"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="result-failed"]').text()).toContain('1');
    expect(w.find('[data-testid="result-inserted"]').text()).toContain('2');
  });
});
