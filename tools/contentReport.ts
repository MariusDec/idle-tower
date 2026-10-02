import { CONTENT } from '../src/content';
import { sharedIcons } from '../src/content/lint';

/**
 * Icons shared by unrelated content (T3b): a list for an artist to look
 * over, not a failing rule. `npm run content-report`.
 */
const shared = sharedIcons(CONTENT);
console.log(`${shared.length} icons are shared by unrelated entries:\n`);
for (const s of shared) console.log(`${s.icon.padEnd(22)} ${s.entries.join(', ')}`);
