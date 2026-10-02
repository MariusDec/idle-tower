import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { isNative } from './native';

/**
 * Save text as a file the player can find and carry (U12): in the shell, to
 * the device's Documents folder; in a browser, as a download. Returns where
 * it went, in words.
 */
export async function saveTextFile(name: string, text: string): Promise<string> {
  if (isNative()) {
    const path = `TheTower/${name}`;
    await Filesystem.writeFile({ path, data: text, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return `Documents/${path}`;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return `your downloads, as ${name}`;
}

/** Ask the player for a file, and read it as text; null if they chose none. */
export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.txt';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) resolve(null);
      else file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Copy text to the clipboard. False if the platform refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
