import type { CredImportResult } from '~~/server/utils/import/credentials';

export function useCredentialImport() {
  function submit(manifest: File, jsonFiles: File[]): Promise<CredImportResult> {
    const fd = new FormData();
    fd.set('manifest', manifest, manifest.name);
    for (const f of jsonFiles) fd.append(f.name, f, f.name);
    return $fetch<CredImportResult>('/api/imports/credentials', { method: 'POST', body: fd });
  }
  return { submit };
}
