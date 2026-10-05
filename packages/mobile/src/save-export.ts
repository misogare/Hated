/**
 * Saving a data export on a phone: write it to a file in the app's cache, then
 * open the share sheet so the person can keep it in Files or Drive, or send it
 * on. The web build has its own version (`save-export.web.ts`).
 *
 * The file stays in the app's private cache; the next export overwrites it, and
 * the system clears the cache when it needs space.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Kept the same in both versions, since screens import whichever the platform picks. */
export type SaveResult = 'shared' | 'unavailable' | 'downloaded';

export async function saveExport(fileName: string, json: string): Promise<SaveResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Your HateD data' });
  return 'shared';
}
