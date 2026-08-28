// Quick check: load game at mobile size, open talents tab, inspect badge DOM.
import { chromium } from 'playwright';

const url = 'http://localhost:5173/';

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

// Patch the save BEFORE the page loads. Need to use init script to set localStorage
await ctx.addInitScript(() => {
  // Inject a save that has unspent talent points
  const k = 'the-tower-save';
  const cur = localStorage.getItem(k);
  let data = cur ? JSON.parse(cur) : { version: 19 };
  data.version = 19;
  data.towerXp = { xp: 5000, level: 5, unspentTalentPoints: 7, totalXpEarned: 5000 };
  localStorage.setItem(k, JSON.stringify(data));
});

await page.goto(url, { waitUntil: 'networkidle' });

// Give game time to initialise and to start the talent points flow
await page.waitForTimeout(2000);

// Force mobile mode explicitly
await page.evaluate(() => window.dispatchEvent(new Event('resize')));

// Inspect desktop sub-strip
const desktopInfo = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.tab-btn'));
  return btns.map(b => {
    const badge = b.querySelector('.tab-badge');
    return {
      tab: b.dataset.tab,
      hasBadgeEl: !!badge,
      isVisible: badge ? badge.classList.contains('is-visible') : false,
      text: badge ? badge.textContent : null,
    };
  });
});
console.log('DESKTOP:', JSON.stringify(desktopInfo, null, 2));

// Try to open the mobile sheet on the research group (which contains talents)
await page.evaluate(() => {
  const root = document.getElementById('bottom-nav-root');
  if (!root) { console.log('NO BOTTOM NAV'); return; }
  const buttons = Array.from(root.querySelectorAll('button'));
  const research = buttons.find(b => b.dataset.navId === 'research') ?? buttons[0];
  research.click();
});
await page.waitForTimeout(800);

const sheetOpen = await page.evaluate(() => {
  const sheet = document.querySelector('.mobile-sheet');
  return sheet ? sheet.classList.contains('is-open') : false;
});
console.log('SHEET OPEN:', sheetOpen);
const navLabels = await page.evaluate(() => {
  const root = document.getElementById('bottom-nav-root');
  if (!root) return null;
  return Array.from(root.querySelectorAll('button')).map(b => ({
    navId: b.dataset.navId,
    group: b.dataset.group,
    text: b.textContent?.trim().slice(0, 30),
  }));
});
console.log('NAV BUTTONS:', JSON.stringify(navLabels));

const mobileInfo = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.mobile-sheet-segmented-btn'));
  return btns.map(b => {
    const badge = b.querySelector('.mobile-sheet-segmented-btn-badge');
    const cs = badge ? getComputedStyle(badge) : null;
    return {
      tab: b.dataset.tabId,
      hasBadgeEl: !!badge,
      isVisible: badge ? badge.classList.contains('is-visible') : false,
      text: badge ? badge.textContent : null,
      badgeClass: badge ? badge.className : null,
      computedDisplay: cs ? cs.display : null,
      computedPosition: cs ? cs.position : null,
      computedTop: cs ? cs.top : null,
      computedRight: cs ? cs.right : null,
      parentPosition: badge && badge.parentElement ? getComputedStyle(badge.parentElement).position : null,
      // Also get the rect
      rect: badge ? badge.getBoundingClientRect().toJSON() : null,
      parentRect: badge && badge.parentElement ? badge.parentElement.getBoundingClientRect().toJSON() : null,
    };
  });
});
console.log('MOBILE:', JSON.stringify(mobileInfo, null, 2));

// Now check the group badge in the bottom nav
const navBadges = await page.evaluate(() => {
  const root = document.getElementById('bottom-nav-root');
  if (!root) return null;
  return Array.from(root.querySelectorAll('button')).map(b => {
    const badge = b.querySelector('.bottom-nav-btn-badge');
    return {
      group: b.dataset.navId ?? b.dataset.group,
      hasBadgeEl: !!badge,
      visible: badge ? badge.classList.contains('is-visible') : false,
      text: badge ? badge.textContent : null,
    };
  });
});
console.log('NAV BADGES:', JSON.stringify(navBadges, null, 2));

// Force one badge to visible and screenshot
await page.evaluate(() => {
  const btns = document.querySelectorAll('.mobile-sheet-segmented-btn');
  for (const b of btns) {
    const badge = b.querySelector('.mobile-sheet-segmented-btn-badge');
    if (badge) {
      badge.classList.add('is-visible');
      badge.textContent = '7';
    }
  }
});
await page.waitForTimeout(300);

// Check the rect after forcing is-visible
const visibleRect = await page.evaluate(() => {
  const btns = document.querySelectorAll('.mobile-sheet-segmented-btn');
  return Array.from(btns).map(b => {
    const badge = b.querySelector('.mobile-sheet-segmented-btn-badge');
    if (!badge) return null;
    const cs = getComputedStyle(badge);
    const rect = badge.getBoundingClientRect();
    return {
      tab: b.dataset.tabId,
      visible: badge.classList.contains('is-visible'),
      computedDisplay: cs.display,
      rect: rect.toJSON(),
      parentRect: b.getBoundingClientRect().toJSON(),
      isOnScreen: rect.width > 0 && rect.height > 0,
    };
  });
});
console.log('FORCED VISIBLE:', JSON.stringify(visibleRect, null, 2));

// Take a screenshot for inspection
await page.screenshot({ path: '/tmp/mobile-sheet.png', fullPage: true });

if (logs.length) console.log('LOGS:', logs.join('\n'));

await browser.close();
