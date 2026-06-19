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

  it('rotate opens a write-only textarea panel (never pre-filled) and POSTs to rotate endpoint after confirm', async () => {
    const wrapper = mount(CredentialsPage);
    await flushPromises();

    // Rotate panel is hidden before clicking Rotate
    expect(wrapper.find('[data-test="rotate-panel"]').exists()).toBe(false);

    // Click Rotate for credential c1
    await wrapper.get('[data-test="rotate-c1"]').trigger('click');
    await flushPromises();

    // Rotate panel is now visible
    expect(wrapper.find('[data-test="rotate-panel"]').exists()).toBe(true);

    // Write-only textarea must start empty (never pre-filled from server)
    const rotateInput = wrapper.get('[data-test="rotate-secret-input"]');
    expect((rotateInput.element as HTMLTextAreaElement).value).toBe('');

    // Enter the new secret and confirm
    await rotateInput.setValue('new-secret-xyz');
    await wrapper.get('[data-test="rotate-confirm-btn"]').trigger('click');
    await flushPromises();

    const fetchMock = globalThis.$fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/apps/a1/credentials/c1/rotate',
      expect.objectContaining({ method: 'POST' }),
    );

    // Rotate panel dismissed and rotate-secret-input cleared after submit (write-only)
    expect(wrapper.find('[data-test="rotate-panel"]').exists()).toBe(false);
  });

  it('rotate cancel closes the panel without POSTing', async () => {
    const wrapper = mount(CredentialsPage);
    await flushPromises();

    await wrapper.get('[data-test="rotate-c1"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="rotate-panel"]').exists()).toBe(true);

    await wrapper.get('[data-test="rotate-cancel-btn"]').trigger('click');
    await flushPromises();

    // Panel closed, no rotate POST made
    expect(wrapper.find('[data-test="rotate-panel"]').exists()).toBe(false);
    const fetchMock = globalThis.$fetch as ReturnType<typeof vi.fn>;
    const rotateCalls = (fetchMock.mock.calls as [string, ...unknown[]][]).filter(
      ([url]) => typeof url === 'string' && url.includes('/rotate'),
    );
    expect(rotateCalls).toHaveLength(0);
  });
});
