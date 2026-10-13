/**
 * The demo only runs in the browser (images.web.ts); on a phone the API keeps
 * photos, so this stand-in just passes the file along.
 */

export interface KeptPhoto {
  full: string;
  blurred: string;
  width: number;
  height: number;
}

export async function keepPhoto(uri: string): Promise<KeptPhoto> {
  return { full: uri, blurred: uri, width: 1080, height: 1350 };
}
