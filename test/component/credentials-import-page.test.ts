// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

beforeEach(() => {
  vi.stubGlobal('$fetch', vi.fn(async () => ({
    created: 2,
    updated: 1,
    failed: 1,
    errors: [{ rowNumber: 4, reason: 'SA_FILE_MISSING' }],
  })));
});

// Import AFTER globals are stubbed.
const { default: CredentialsImportPage } = await import('~/app/pages/imports/credentials.vue');

describe('CredentialsImportPage', () => {
  it('uploads manifest + json files and renders the result summary including errors', async () => {
    const wrapper = mount(CredentialsImportPage);
    const manifest = new File(
      ['company,app,provider,platform,sa_json_file\nAcme,Shopper,fcm,android,acme.json\n'],
      'manifest.csv',
      { type: 'text/csv' },
    );
    const json = new File(['{}'], 'acme.json', { type: 'application/json' });

    Object.defineProperty(wrapper.get('[data-test="manifest-input"]').element, 'files', {
      value: [manifest],
      configurable: true,
    });
    await wrapper.get('[data-test="manifest-input"]').trigger('change');

    Object.defineProperty(wrapper.get('[data-test="json-input"]').element, 'files', {
      value: [json],
      configurable: true,
    });
    await wrapper.get('[data-test="json-input"]').trigger('change');

    await wrapper.get('[data-test="import-btn"]').trigger('click');
    await flushPromises();

    expect(globalThis.$fetch).toHaveBeenCalledWith(
      '/api/imports/credentials',
      expect.objectContaining({ method: 'POST' }),
    );

    const summary = wrapper.get('[data-test="import-summary"]').text();
    expect(summary).toContain('2');   // created
    expect(summary).toContain('1');   // updated / failed

    expect(wrapper.get('[data-test="import-errors"]').text()).toMatch(/SA_FILE_MISSING/);
  });
});
