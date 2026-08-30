import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { SaveStore } from './SaveStore';

/**
 * The Android backend: one UTF-8 JSON file per key in `Directory.Data`, which is
 * the app's private files dir (`/data/data/<appId>/files`). Nothing else on the
 * device can read it, it is not WebView data, and it is included in the app's
 * backup set.
 *
 * **The write dance is the point.** `writeFile` truncates before it writes, so a
 * process death mid-write would leave half a file — and `SaveManager.load`
 * responds to unparseable JSON by *clearing the save*, which would turn a
 * badly-timed kill into a wiped account. So: write the full payload to a `.tmp`
 * sibling, delete the target, rename the tmp over it. The window where the real
 * file does not exist is microseconds long, and `get()` covers even that by
 * falling back to the `.tmp` — at every instant at least one complete file is on
 * disk.
 */
export class FilesystemSaveStore implements SaveStore {
  private file(key: string): string {
    return `${key}.json`;
  }
  private tmp(key: string): string {
    return `${key}.json.tmp`;
  }

  private async read(path: string): Promise<string | null> {
    try {
      const res = await Filesystem.readFile({
        path,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      // `data` is typed `string | Blob`; the Blob arm is web-only, and this
      // backend only ever runs on native.
      return typeof res.data === 'string' ? res.data : null;
    } catch {
      // The plugin throws rather than returning null when the file is absent.
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    return (await this.read(this.file(key))) ?? (await this.read(this.tmp(key)));
  }

  async set(key: string, value: string): Promise<void> {
    await Filesystem.writeFile({
      path: this.tmp(key),
      data: value,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    // Rename will not overwrite an existing destination on every platform, so
    // clear it first. Failure here means there was nothing to clear.
    try {
      await Filesystem.deleteFile({ path: this.file(key), directory: Directory.Data });
    } catch {
      /* first write */
    }
    await Filesystem.rename({
      from: this.tmp(key),
      to: this.file(key),
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }

  async remove(key: string): Promise<void> {
    for (const path of [this.file(key), this.tmp(key)]) {
      try {
        await Filesystem.deleteFile({ path, directory: Directory.Data });
      } catch {
        /* already gone */
      }
    }
  }
}
