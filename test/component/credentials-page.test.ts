// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const list = [
  { id: 'c1', appId: 'a1', provider: 'fcm', platform: 'ios', label: 'iOS', configured: true,
    projectId: 'proj-1', huaweiAppId: null, ready: false, configuredAt: '2026-06-19T00:00:00Z', rotatedAt: null },
  { id: 'c2', appId: 'a1', provider: 'huawei', platform: 'huawei', label: null, configured: true,
    projectId: null, huaweiAppId: '10086', ready: true, configuredAt: '2026-06-19T00:00:00Z', rotatedAt: null },
];

beforeEach(() => {
  vi.stubGlobal('useRoute', () => ({ params: { id: 'a1' } }));
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/apps/a1/credentials') return list;
    return {};
  }));
});

// Import AFTER globals are stubbed.
const { default: CredentialsPage } = await import('~/app/pages/apps/[id]/credentials.vue');

describe('CredentialsPage', () => {
  it('renders one row per credential with a readiness badge, never a secret field value', async () => {
    const wrapper = mount(CredentialsPage);
    await flushPromises();
    expect(wrapper.text()).toContain('proj-1');
    expect(wrapper.text()).toContain('10086');
    expect(wrapper.text()).toMatch(/not ready/i);   // c1 ios not ready
    expect(wrapper.text()).toMatch(/ready/i);        // c2 ready
    // The write-only secret textarea must start empty (never hydrated from server).
    const secretField = wrapper.get('[data-test="secret-input"]');
    expect((secretField.element as HTMLTextAreaElement).value).toBe('');
  });

  it('POSTs a new credential and never shows the secret back after save', async () => {
    const wrapper = mount(CredentialsPage);
    await flushPromises();
    await wrapper.get('[data-test="provider-select"]').setValue('huawei');
    await wrapper.get('[data-test="platform-select"]').setValue('huawei');
    await wrapper.get('[data-test="secret-input"]').setValue('app-secret-123');
    await wrapper.get('[data-test="save-btn"]').trigger('click');
    await flushPromises();
    const fetchMock = globalThis.$fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/a1/credentials', expect.objectContaining({ method: 'POST' }));
    // secret input cleared after save (write-only)
    expect((wrapper.get('[data-test="secret-input"]').element as HTMLTextAreaElement).value).toBe('');
  });
});
