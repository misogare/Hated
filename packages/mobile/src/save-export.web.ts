/** Saving a data export in the browser: an ordinary file download. */

/** Kept the same in both versions, since screens import whichever the platform picks. */
export type SaveResult = 'shared' | 'unavailable' | 'downloaded';

export async function saveExport(fileName: string, json: string): Promise<SaveResult> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the download a moment to start before letting go of the data.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
