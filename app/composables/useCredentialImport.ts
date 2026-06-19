import type { CredImportResult } from '~~/server/utils/import/credentials';

export function useCredentialImport() {
  const csrf = useCsrf();

  async function submit(manifest: File, jsonFiles: File[]): Promise<CredImportResult> {
    await csrf.fetchToken();
    const fd = new FormData();
    fd.set('manifest', manifest, manifest.name);
    for (const f of jsonFiles) fd.append(f.name, f, f.name);
    return $fetch<CredImportResult>('/api/imports/credentials', {
      method: 'POST',
      headers: csrf.headers(),
      body: fd,
    });
  }
  return { submit };
}
