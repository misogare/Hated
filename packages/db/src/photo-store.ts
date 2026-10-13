/**
 * Where photo files live. The database records whose photo is whose and in
 * what order; the store holds the bytes, by key. Files sit in one directory on
 * disk for now; anything with put, get and delete (an S3-compatible bucket, for
 * one) can stand in for it later without the services changing.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PhotoStore {
  put(key: string, data: Buffer): Promise<void>;
  /** The bytes, or null when there is no such file. */
  get(key: string): Promise<Buffer | null>;
  /** Remove a file. Removing one that is not there is fine. */
  delete(key: string): Promise<void>;
}

/** Keys are file names: letters, digits, dots, dashes and underscores, never a path. */
const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/** `packages/db/data/photos`, which git ignores. */
export function defaultPhotoDir(): string {
  return fileURLToPath(new URL('../data/photos', import.meta.url));
}

/** Photos as files in `dir` (created on first write). */
export function createDiskPhotoStore(dir: string = defaultPhotoDir()): PhotoStore {
  let ready: Promise<unknown> | null = null;
  const file = (key: string) => {
    if (!SAFE_KEY.test(key)) throw new Error(`Not a photo key: ${JSON.stringify(key)}`);
    return path.join(dir, key);
  };

  return {
    async put(key, data) {
      const target = file(key);
      await (ready ??= mkdir(dir, { recursive: true }));
      // Write beside it, then rename, so nobody ever reads half a photo.
      const partial = `${target}.${process.pid}.${Date.now()}.part`;
      await writeFile(partial, data);
      await rename(partial, target);
    },
    async get(key) {
      try {
        return await readFile(file(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(file(key), { force: true });
    },
  };
}

/** Photos in memory, for tests. `keys()` lists what is stored. */
export function createMemoryPhotoStore(): PhotoStore & { keys(): string[] } {
  const files = new Map<string, Buffer>();
  return {
    async put(key, data) {
      if (!SAFE_KEY.test(key)) throw new Error(`Not a photo key: ${JSON.stringify(key)}`);
      files.set(key, Buffer.from(data));
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    keys: () => [...files.keys()].sort(),
  };
}
