# Capacitor Android build — implementation plan

**Status:** plan, not yet implemented.

**Scope:** add Capacitor to this repo and produce a working, fully offline Android app
("The Tower") with a proper launcher icon, splash screen, app name, edge-to-edge layout,
hardware back button, lifecycle-safe saving, and both a debug APK and a signable release
APK/AAB.

**Nothing here changes game logic, balance, the save *format*, or the renderer.** If you find
yourself editing `src/data/`, or editing an existing method in `src/game/Game.ts`, stop — you
have gone out of scope. The web-side source changes are exactly:

- four new files under `src/systems/storage/` and a contained rewrite of `SaveManager`'s four
  IO methods (§8) — the save moves off `localStorage` to IndexedDB on the web and a private
  file on Android, at the same `SAVE_VERSION` 21 and the same JSON;
- one new file `src/platform/native.ts` (§9);
- two **additive** methods on `Game` (`hydrateSave`, `flushSave`) and ~14 lines in
  `src/main.ts`.

---

## 0. What "done" means

1. `npm run android:apk` produces `android/app/build/outputs/apk/debug/app-debug.apk`.
2. Installed on a device the app is called **The Tower**, has the tower launcher icon (adaptive,
   dark ink background + gold roof), and opens on a dark splash that hands over to the game with
   no white flash.
3. **Airplane mode changes nothing.** The app makes zero network requests at runtime. It is
   built without the `INTERNET` permission, so it *cannot* make one.
4. The status bar and gesture bar do not cover the HUD or the ability bar (safe-area insets are
   non-zero and honoured).
5. The hardware back button closes an open overlay; with nothing open it backgrounds the app
   (it does not kill the run).
6. Backgrounding the app writes a save; returning applies offline progress (the existing
   `visibilitychange` path, plus a native `pause` belt-and-braces).
7. Saves live in **IndexedDB** on the web and in a **private file** on Android — never
   `localStorage` — and an existing `localStorage` save is adopted on first launch with no
   loss.
8. `npm test` and `npm run typecheck` still pass, with one new test file guarding the offline
   and identity invariants and the existing save suite green against the new backend.

---

## 1. What already exists — do not redo it

The repo was written with this build in mind (UI plan §9.E). Verify each of these still holds
before you start; **none of them needs changing**:

| Fact | Where | Why it matters |
|---|---|---|
| `base: './'` — the bundle is path-agnostic | `vite.config.ts:12` | `dist/` resolves from `https://localhost` with no re-bundle |
| `<meta name="theme-color" content="#0a0d14">` | `index.html` | matches `--surface-0`; splash/status-bar ground |
| `viewport-fit=cover` in the viewport meta | `index.html` | required for `env(safe-area-inset-*)` to be non-zero |
| Fonts self-hosted | `public/fonts/*.woff2` | no web-font fetch |
| Icon sprite self-hosted, relative path | `public/icons/sprite.svg`, `src/ui/Icon.ts:28` | the app's only `fetch()`, and it is local |
| Safe-area tokens applied throughout | `src/styles/tokens.css:440-443` (`--safe-t/r/b/l`) | notch/gesture-bar handling already done |
| Touch targets ≥44px, `touch-action`, `overscroll-behavior: none` | mobile CSS, `tests/touch-targets.test.ts` | mobile input already hardened |
| Quality tiers with a first-run probe | `src/game/Game.ts` (`setQuality`, `startQualityProbe`) | mid-range Android already handled |
| Save key `the-tower-save`, `SAVE_VERSION` 21 | `src/systems/SaveManager.ts:47` | §8 moves the *bytes* off `localStorage`; the key, the format and the migration ladder are unchanged |
| Audio lazily starts on first gesture and resumes | `src/systems/AudioManager.ts:56,75` | WebView autoplay policy already satisfied |
| No `http(s)` URL in `index.html` / `src/styles/*.css` | `tests/palette.test.ts` "no runtime network" | guards regressions |

---

## 2. Decisions — fixed, do not deviate

| Thing | Value | Note |
|---|---|---|
| Capacitor | **8.5.0** (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`) | current major |
| Plugins | `@capacitor/app` 8.1.1, `@capacitor/splash-screen` 8.0.2, `@capacitor/status-bar` 8.0.3, `@capacitor/filesystem` 8.1.3 | nothing else |
| Web storage | `idb` 8.0.3 over IndexedDB, db `the-tower`, store `kv` | §8 |
| Native storage | one JSON file in `Directory.Data` (`/data/data/<appId>/files/the-tower-save.json`) | §8 |
| Asset tool | `@capacitor/assets` 3.0.5 (devDependency) | icon/splash generation |
| `appId` | **`com.mariusdonci.thetower`** | this is the Play Store identity and **can never be changed** after a first publish; it also becomes the Java package and the WebView `custom_url_scheme` |
| `appName` | **`The Tower`** | shown under the launcher icon |
| `webDir` | `dist` | matches `vite.config.ts` `build.outDir` |
| `versionName` / `versionCode` | `0.1.0` / `1` | keep `versionName` in step with `package.json` `version` |
| `minSdkVersion` | 24 (Android 7.0) | Capacitor 8 default |
| `compileSdkVersion` / `targetSdkVersion` | 36 | Capacitor 8 default; installed locally |
| AGP / Gradle | 8.13.0 / 8.14.3 | shipped by the Capacitor template; do not bump |
| JDK | 21 | already installed |
| Orientation | **unlocked** (portrait + landscape) | the portrait layout is implemented (UI plan §9.1); locking it would throw that work away |
| Android scheme / hostname | `https` / `localhost` (Capacitor default, pinned explicitly) | see §5.2; still origin-scoped for IndexedDB and for the legacy `localStorage` read |
| Native project in git | **committed** (`android/` is tracked, build output is not) | it carries hand-written native edits from §6 |

---

## 3. Preflight — verify the toolchain

Run these and confirm the output before touching anything. If a check fails, fix it first;
do not work around it later.

```bash
node -v && npm -v && java -version && echo "SDK=$ANDROID_HOME" && ls "$ANDROID_HOME/platforms"
```

Expected on this machine: Node ≥ 20 (26.7.0), npm ≥ 10 (12.0.2), OpenJDK **21**,
`ANDROID_HOME=/opt/android-sdk`, `platforms/` containing `android-36`.

The Capacitor 8 template compiles against SDK 36 with AGP 8.13, which needs build-tools 36.
Install what is missing (the SDK dir is group-writable by `android-sdk`, no `sudo` needed):

```bash
sdkmanager --install "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

If it prints a licence prompt, run `sdkmanager --licenses` and accept. `gradle` is **not**
needed on `PATH` — the template ships a wrapper (`android/gradlew`).

> **Build-time network.** "Fully offline" is a property of the *shipped app*, not of the build.
> The first Gradle run downloads the Gradle 8.14.3 distribution, AGP and the AndroidX
> artifacts from `services.gradle.org`, `dl.google.com` and Maven Central. That is a one-time,
> build-machine-only cost. Nothing downloaded ends up making a request at runtime.

---

## 4. Step 1 — dependencies and `capacitor.config.ts`

### 4.1 Install

```bash
npm i @capacitor/core@8.5.0 @capacitor/android@8.5.0 @capacitor/app@8.1.1 @capacitor/splash-screen@8.0.2 @capacitor/status-bar@8.0.3 @capacitor/filesystem@8.1.3 idb@8.0.3
npm i -D @capacitor/cli@8.5.0 @capacitor/assets@3.0.5
```

`@capacitor/core`, the four plugins and `idb` are **runtime** dependencies (they are imported
by `src/platform/native.ts` and `src/systems/storage/`, and bundled by Vite). The CLI and the
asset generator are dev-only. `idb` and `@capacitor/filesystem` are used only by §8 — if you
are doing §8 separately, install them there instead.

### 4.2 Create `capacitor.config.ts` at the repo root

Do **not** run `npx cap init` — it writes a config with less than we want. Write the file
directly:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell's configuration. See `plans/capacitor.md`.
 *
 * `appId` is the Play Store identity and the Java package; it is effectively
 * permanent once published. `server.androidScheme` is pinned rather than left to
 * default because it decides the WebView's *origin* — and the origin is what
 * `localStorage` is keyed by. Changing `https`/`localhost` here would orphan every
 * player's save (`the-tower-save`, `src/systems/SaveManager.ts`).
 */
const config: CapacitorConfig = {
  appId: 'com.mariusdonci.thetower',
  appName: 'The Tower',
  webDir: 'dist',
  // Matches --surface-0 / the theme-color meta. This is what shows for the
  // frame between the native splash going away and the first canvas paint.
  backgroundColor: '#0a0d14',
  android: {
    backgroundColor: '#0a0d14',
    // The canvas owns its own pinch/zoom semantics; the WebView must not add any.
    zoomEnabled: false,
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  plugins: {
    SplashScreen: {
      // The game hides it itself once the icon sprite is injected and the UI has
      // mounted (src/platform/native.ts), so there is no white gap.
      launchAutoHide: false,
      backgroundColor: '#0a0d14',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      // Dark ground, light glyphs.
      style: 'DARK',
      backgroundColor: '#0a0d14',
      overlaysWebView: true,
    },
  },
};

export default config;
```

**Never add `server.url` or `server.cleartext`.** A `server.url` points the shipped app at a
dev machine over the network — it is the one setting that would break the offline guarantee.
§14.2 adds a test that fails if either appears.

### 4.3 Make `tsc` ignore the config

`tsconfig.json` has `"include": ["src"]`, so `capacitor.config.ts` is outside the typecheck
program and `npm run typecheck` will not see it. **Leave `tsconfig.json` alone.** (The
Capacitor CLI type-checks the config itself when it loads it.)

---

## 5. Step 2 — add the Android platform, then harden it for offline

### 5.1 Add the platform

```bash
npm run build
npx cap add android
npx cap sync android
```

This creates `android/` from the Capacitor template and copies `dist/` into
`android/app/src/main/assets/public/`. Because `appId`/`appName` were already correct in the
config, the template comes out with the right identity — **verify, do not re-edit**:

| File | Expected |
|---|---|
| `android/app/build.gradle` | `namespace = "com.mariusdonci.thetower"`, `applicationId "com.mariusdonci.thetower"` |
| `android/app/src/main/java/com/mariusdonci/thetower/MainActivity.java` | exists |
| `android/app/src/main/res/values/strings.xml` | `app_name` and `title_activity_main` both `The Tower` |
| `android/variables.gradle` | `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36` |
| `android/gradle/wrapper/gradle-wrapper.properties` | `gradle-8.14.3-all.zip` |

If `strings.xml` came out as `My App`, fix it there **and** check `capacitor.config.ts` — the
config is the source of truth and `cap sync` re-reads it.

### 5.2 Set the version in `android/app/build.gradle`

In `defaultConfig`, change:

```gradle
        versionCode 1
        versionName "0.1.0"
```

Keep `versionName` equal to `package.json`'s `version`. `versionCode` must be incremented by
hand for every store upload; it is not derived.

### 5.3 Remove the `INTERNET` permission

This is the step that makes "fully offline" a *guarantee* rather than a claim: with the
permission absent, the OS refuses any socket the app could open, so no future dependency can
quietly phone home.

In `android/app/src/main/AndroidManifest.xml`, delete:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
```

and add `android:usesCleartextTraffic="false"` to the `<application>` element.

Capacitor serves the app through `WebViewAssetLoader`, which intercepts the
`https://localhost/...` request inside the WebView *before* it reaches the network stack, so
this is expected to work.

> **Verify and be ready to roll back.** After §12, if the app opens to a blank/white screen,
> run `adb logcat | grep -i -E "chromium|capacitor|ERR_"`. If you see
> `ERR_ACCESS_DENIED`, `ERR_CACHE_MISS` or a `SecurityException` naming the internet
> permission, **restore the `<uses-permission>` line and rebuild**, then note in
> `docs/ui-system.md` that the permission is required by the WebView loader. Do not leave the
> app broken for the sake of the permission. Everything else in §0.3 (no remote assets, no
> `server.url`, no web fonts, guarded by tests) holds either way.

### 5.4 Confirm there is nothing else to fetch

```bash
grep -rn "https\?://" dist/assets/*.js dist/index.html | grep -v "sourceMappingURL\|www.w3.org\|schemas\|//#" | head
```

Hits against `w3.org` (SVG/XML namespaces) are inert identifiers, not requests. Anything else
is a real dependency and must be removed before shipping.

---

## 6. Step 3 — native shell: edge-to-edge, theme, colors, back-navigation

Android 15+ enforces edge-to-edge for `targetSdk` 35+, and there is no opt-out at 36. That is
*good* here — the CSS already reads `env(safe-area-inset-*)` — but the WebView only reports
non-zero insets when the window is genuinely edge-to-edge. Make it so explicitly.

### 6.1 `android/app/src/main/java/com/mariusdonci/thetower/MainActivity.java`

Replace the whole file:

```java
package com.mariusdonci.thetower;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Edge-to-edge is mandatory at targetSdk 36, but the WebView only reports
 * non-zero env(safe-area-inset-*) when the decor view has stopped fitting system
 * windows. The game's HUD, ability bar and bottom nav are all positioned off
 * those insets (--safe-t/r/b/l in src/styles/tokens.css), so without this line
 * the status bar and the gesture bar sit on top of the two most-tapped surfaces.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
    }
}
```

`WindowCompat` comes from `androidx.core`, which `appcompat` already exposes — **no new gradle
dependency is needed.**

### 6.2 `android/app/src/main/res/values/colors.xml` — new file

The stock template's `AppTheme` references `@color/colorPrimary`, `@color/colorPrimaryDark`
and `@color/colorAccent` without defining them. Define them from the game's palette
(`src/data/palette.ts`, `src/styles/tokens.css`) so the native chrome and the web app agree:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- --surface-0 / --ink-900. Same value as the theme-color meta in index.html
         and backgroundColor in capacitor.config.ts. Change all four together. -->
    <color name="colorPrimary">#0a0d14</color>
    <color name="colorPrimaryDark">#0a0d14</color>
    <!-- --accent / FX.gold -->
    <color name="colorAccent">#f0b23c</color>
    <color name="splashBackground">#0a0d14</color>
</resources>
```

### 6.3 `android/app/src/main/res/values/styles.xml` — replace

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>

    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <!-- The theme the activity actually runs under. Transparent bars are what
         make the WebView report real safe-area insets (see MainActivity). -->
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@color/splashBackground</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <!-- Dark ground: the system draws its glyphs light. -->
        <item name="android:windowLightStatusBar">false</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">@color/splashBackground</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
```

Two deliberate changes from the template: `android:background` on `AppTheme.NoActionBar` is
`@color/splashBackground` instead of `@null` (a `@null` window background is what produces the
white flash between splash and first paint), and `postSplashScreenTheme` is set so the
Android 12+ splash hands over to the real theme.

> Do **not** add `android:enforceStatusBarContrast` / `enforceNavigationBarContrast` — they are
> API 29 attributes and will trip the `NewApi` lint at `minSdk 24` unless further annotated.
> They buy nothing here.

### 6.4 Manifest — orientation and configuration changes

The template `<activity>` already lists `orientation|screenSize|screenLayout|density|uiMode` in
`android:configChanges`, so a rotation does **not** recreate the activity and the run survives
it. Leave that alone. Do not add `android:screenOrientation` — both orientations are supported.

Confirm `android:hardwareAccelerated` is not set to `false` anywhere (it defaults to true; the
canvas renderer depends on it).

---

## 7. Step 4 — launcher icon and splash

### 7.1 Author the source art

Create `assets/` at the repo root (this is `@capacitor/assets`' default input dir; it does not
collide with `dist/assets/`). Write four SVGs, then rasterise them.

The mark is the `public/favicon.svg` tower re-cut for icon sizes: at 32px a circle-plus-triangle
reads as a tower, at 1024 it reads as a balloon. This version gives it a battlemented crown, a
tapered body, an arrow slit and a pennant, in the game's own palette — `--surface-0 #0a0d14`
ground, `FX.gold #f0b23c` roof, ink stone `#5b6b7a` / `#3d4753` with the `#2a2f38` outline the
renderer uses for masonry, and one `FX.arcane #a95cff` pennant.

Every glyph carries `translate(512 512) scale(0.8) translate(-512 -491)`. That is not
decoration: an adaptive icon's outer third is cropped by whatever mask the launcher uses, and
the transform is what keeps the base corners inside the 66% safe zone on a squircle **and**
inside the inscribed circle on a round launcher. **Do not remove it or raise the scale.**

`assets/icon-foreground.svg` — the adaptive-icon foreground layer (transparent ground):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512 512) scale(0.8) translate(-512 -491)">
    <g stroke="#2a2f38" stroke-width="26" stroke-linejoin="round" stroke-linecap="round">
      <!-- roof -->
      <path d="M512 210 L706 400 L318 400 Z" fill="#f0b23c"/>
      <!-- battlements -->
      <path d="M348 400 h328 v96 h-52 v-48 h-56 v48 h-56 v-48 h-56 v48 h-52 Z" fill="#5b6b7a"/>
      <!-- body -->
      <path d="M372 496 L652 496 L688 796 L336 796 Z" fill="#5b6b7a"/>
      <!-- base -->
      <path d="M312 796 h400 v56 h-400 Z" fill="#3d4753"/>
    </g>
    <!-- arrow slit -->
    <path d="M512 560 a30 30 0 0 1 30 30 v110 a30 30 0 0 1 -60 0 v-110 a30 30 0 0 1 30 -30 Z"
          fill="#0a0d14"/>
    <!-- pennant -->
    <rect x="502" y="130" width="20" height="100" fill="#c0c4cc"/>
    <path d="M522 140 L612 168 L522 196 Z" fill="#a95cff"/>
  </g>
</svg>
```

`assets/icon-background.svg` — the adaptive-icon background layer:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="ground" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#1a2030"/>
      <stop offset="100%" stop-color="#0a0d14"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#ground)"/>
</svg>
```

`assets/icon.svg` — the flattened legacy/round icon: the background rect and gradient from
`icon-background.svg`, then the identical `<g transform="translate(512 512) scale(0.8)
translate(-512 -491)">…</g>` from `icon-foreground.svg`, in that order, in one file. Copy both
blocks verbatim so the two never drift.

`assets/splash.svg` — 2732×2732. The splash is centre-cropped to wildly different aspect
ratios, so the mark sits small and dead centre on flat ink and nothing goes near an edge:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732" width="2732" height="2732">
  <rect width="2732" height="2732" fill="#0a0d14"/>
  <g transform="translate(1366 1366) scale(0.6) translate(-512 -491)">
    <g stroke="#2a2f38" stroke-width="26" stroke-linejoin="round" stroke-linecap="round">
      <path d="M512 210 L706 400 L318 400 Z" fill="#f0b23c"/>
      <path d="M348 400 h328 v96 h-52 v-48 h-56 v48 h-56 v-48 h-56 v48 h-52 Z" fill="#5b6b7a"/>
      <path d="M372 496 L652 496 L688 796 L336 796 Z" fill="#5b6b7a"/>
      <path d="M312 796 h400 v56 h-400 Z" fill="#3d4753"/>
    </g>
    <path d="M512 560 a30 30 0 0 1 30 30 v110 a30 30 0 0 1 -60 0 v-110 a30 30 0 0 1 30 -30 Z"
          fill="#0a0d14"/>
    <rect x="502" y="130" width="20" height="100" fill="#c0c4cc"/>
    <path d="M522 140 L612 168 L522 196 Z" fill="#a95cff"/>
  </g>
</svg>
```

> `public/favicon.svg` keeps its own simpler cut — it is drawn at 16–32px, where this much
> detail turns to mud. Re-cutting the favicon from this mark is a separate, optional change and
> is **not** part of this plan.

### 7.2 Rasterise

`rsvg-convert` and ImageMagick are both installed on this machine.

```bash
rsvg-convert -w 1024 -h 1024 assets/icon.svg            -o assets/icon.png
rsvg-convert -w 1024 -h 1024 assets/icon-foreground.svg -o assets/icon-foreground.png
rsvg-convert -w 1024 -h 1024 assets/icon-background.svg -o assets/icon-background.png
rsvg-convert -w 2732 -h 2732 assets/splash.svg          -o assets/splash.png
cp assets/splash.png assets/splash-dark.png
```

Then check the four PNGs are the exact sizes `@capacitor/assets` demands (it fails loudly, but
an early check is cheaper):

```bash
identify assets/*.png
```

Expect `1024x1024` for the three icons and `2732x2732` for both splashes. Commit the SVGs
**and** the PNGs — the PNGs are the tool's input, and a checkout must be able to regenerate the
native resources without a rasteriser installed.

### 7.3 Generate the Android resources

```bash
npx @capacitor/assets generate --android \
  --iconBackgroundColor '#0a0d14' \
  --iconBackgroundColorDark '#0a0d14' \
  --splashBackgroundColor '#0a0d14' \
  --splashBackgroundColorDark '#0a0d14'
```

This overwrites, under `android/app/src/main/res/`:
`mipmap-*/ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png`,
`mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml`,
`values/ic_launcher_background.xml`, and the `drawable*/splash.png` set (portrait, landscape
and `-night`).

**It may also rewrite `values/styles.xml`.** After running it, re-check §6.3 and restore the
file if the tool flattened it. Run the generator *before* §6.3 if you prefer — but the last
word must be §6.3's content.

### 7.4 Sanity-check the result

```bash
ls android/app/src/main/res/mipmap-xxxhdpi/
cat android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
cat android/app/src/main/res/values/ic_launcher_background.xml
```

`ic_launcher.xml` must be an `<adaptive-icon>` with `@color/ic_launcher_background` and
`@mipmap/ic_launcher_foreground`; the background colour must be `#0a0d14`, not the template's
`#FFFFFF`.

---

## 8. Step 5 — Storage: `idb` on the web, `@capacitor/filesystem` on Android

### 8.1 Why, and the one decision that keeps this small

Today the whole save lives in `localStorage` under `the-tower-save`
(`src/systems/SaveManager.ts:47`), reached through exactly four methods — `save`, `load`,
`clear`, `hasSave` — plus the `isStorageAvailable` probe.

`localStorage` is the wrong home for it in a native shell. It is WebView data: it shares one
~5 MB origin quota with everything else the WebView keeps, Android is free to evict it under
storage pressure, and a "clear cache"-style cleanup can take it. A file in the app's private
data directory is none of those things — it is backed up and restored with the app, it has no
5 MB ceiling, and it is not something the system reclaims behind the player's back. On the web,
IndexedDB is the same argument minus the file: no small shared quota, real transactions.

> ### ⚠️ Risk warning — read before touching `SaveManager`
>
> `impact({target: "save", direction: "upstream", file_path: "src/systems/SaveManager.ts"})`
> reports **CRITICAL**: 8 direct callers, 15 impacted symbols, 7 execution flows
> (`frameUpdate`, `Game` constructor, `tryLoadSave`, `bindVisibilityEvents`, `transcend`,
> `clearSave`, `bootstrap`) across 3 modules. `load` reports **HIGH**.
>
> That is the price of the *naive* version of this change. `localStorage` is **synchronous**
> and both replacements are **asynchronous**, so turning `save()`/`load()` into
> `Promise`-returning methods pushes `await` into all 8 call sites — including the frame loop,
> where an `await` per autosave is a stutter, and including `visibilitychange`, where nobody
> can await anything.

**So do not make them async.** The design that collapses that blast radius to two one-line
delegations:

- `save()`, `load()`, `clear()` and `hasSave()` keep their **exact current signatures and
  synchronous semantics**, served from an in-memory cache of the serialized snapshot.
- A new async `hydrate()` fills that cache **once, at boot, before `Game.tryLoadSave()` runs**.
- `save()` updates the cache synchronously and schedules a coalesced async flush to the backend.
- The backend is an injectable `SaveStore`: `idb` in a browser, `@capacitor/filesystem` in the
  shell, memory in node and tests.

Every one of those 8 call sites is then **untouched**. Outside `SaveManager` the change is:
two new one-line delegations on `Game` (`hydrateSave`, `flushSave` — §9.2c), ~4 lines in
`src/main.ts`, and the test harness (§8.8). Confirm it with `detect_changes()` when you are
done: if it reports a *modified* existing method anywhere in `Game.ts`, you have implemented
the wrong design.

**The save format does not change.** `SAVE_VERSION` stays at **21**, the migration ladder is
untouched, and the JSON written to the new backends is byte-for-byte what `localStorage` held.
This is a change of *where* the bytes live, nothing else.

### 8.2 Dependencies

Add to the §4.1 install:

```bash
npm i idb@8.0.3 @capacitor/filesystem@8.1.3
```

`idb` is a ~1.5 kB promise wrapper over IndexedDB — it exists so the store code is ten readable
lines instead of an event-handler maze. Both are runtime dependencies.

### 8.3 New file: `src/systems/storage/SaveStore.ts`

```ts
/**
 * Where the save bytes live. See `plans/capacitor.md` §8.
 *
 * Three implementations, one interface: IndexedDB in a browser, a file in the
 * app's private data dir under Capacitor, memory in node and tests. The
 * interface is deliberately a string key/value store and not a "save" API —
 * `SaveManager` owns the format, this layer owns the bytes, and neither knows
 * anything about the other.
 */
export interface SaveStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The fallback: node (`sim/checks.ts`), tests, and any browser that denies both backends. */
export class MemorySaveStore implements SaveStore {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}
```

### 8.4 New file: `src/systems/storage/IdbStore.ts`

```ts
import { openDB, type IDBPDatabase } from 'idb';
import type { SaveStore } from './SaveStore';

const DB_NAME = 'the-tower';
const DB_VERSION = 1;
const STORE = 'kv';

/**
 * The web backend. One object store, string values, keyed by the same
 * `the-tower-save` string `localStorage` used — so the key survives the move and
 * the migration in §8.6 is a straight copy.
 *
 * IndexedDB writes are transactional, so unlike the file backend there is no
 * torn-write to defend against: a `put` either lands whole or not at all.
 */
export class IdbSaveStore implements SaveStore {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  private db(): Promise<IDBPDatabase> {
    // Opened lazily and exactly once. Constructing the store must stay free —
    // `sim/checks.ts` builds a SaveManager in node, where there is no indexedDB.
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        },
      });
    }
    return this.dbPromise;
  }

  async get(key: string): Promise<string | null> {
    const value = await (await this.db()).get(STORE, key);
    return typeof value === 'string' ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await (await this.db()).put(STORE, value, key);
  }

  async remove(key: string): Promise<void> {
    await (await this.db()).delete(STORE, key);
  }
}
```

### 8.5 New file: `src/systems/storage/FilesystemStore.ts`

```ts
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
```

### 8.6 New file: `src/systems/storage/index.ts` — selection and the localStorage migration

```ts
import { Capacitor } from '@capacitor/core';
import { MemorySaveStore, type SaveStore } from './SaveStore';
import { IdbSaveStore } from './IdbStore';
import { FilesystemSaveStore } from './FilesystemStore';

export type { SaveStore };
export { MemorySaveStore };

let active: SaveStore | null = null;

/**
 * Pick a backend once: the private data dir under Capacitor, IndexedDB in a
 * browser, memory anywhere else (node, and a browser that denies IndexedDB —
 * private-browsing modes do). A memory store means the session is not persisted,
 * which is the same thing the old `isStorageAvailable()` false branch meant.
 */
export function getSaveStore(): SaveStore {
  if (active) return active;
  try {
    if (Capacitor.isNativePlatform()) active = new FilesystemSaveStore();
    else if (typeof indexedDB !== 'undefined') active = new IdbSaveStore();
    else active = new MemorySaveStore();
  } catch {
    active = new MemorySaveStore();
  }
  return active;
}

/** Test seam (`tests/save.test.ts`). Pass `null` to fall back to auto-selection. */
export function setSaveStore(store: SaveStore | null): void {
  active = store;
}

/**
 * Read the pre-move save, if this device still has one.
 *
 * Returns the raw string so the caller can adopt it *and* write it forward in
 * one step. The old copy is deliberately **not** deleted: it costs a couple of
 * hundred KB and it is what makes rolling this release back non-destructive.
 * Removing it is a one-line change for a later release, once nobody is
 * downgrading.
 */
export function readLegacySave(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}
```

### 8.7 `SaveManager` changes

Run `impact` first and read the warning in §8.1. Then make exactly these changes — the file is
~1300 lines and everything not named here stays as it is.

**(a)** Add the imports and drop the probe. Delete `isStorageAvailable()`
(`src/systems/SaveManager.ts:180`) entirely; nothing else uses it.

```ts
import { getSaveStore, readLegacySave } from './storage';
```

**(b)** Add three fields next to the existing `saveTimer` / `savePending`:

```ts
  /**
   * The serialized snapshot, as it will be written. This — not the backend — is
   * what `load()`/`hasSave()` answer from, which is what lets those two stay
   * synchronous over an asynchronous store (§8.1).
   */
  private cached: string | null = null;
  /** False until `hydrate()` has run. Loading before then is a bug, not an empty save. */
  private hydrated = false;
  /** Serializes flushes so two writes can never interleave. */
  private flushQueue: Promise<void> = Promise.resolve();
```

**(c)** Add `hydrate()` and `flushNow()` as new public methods:

```ts
  /**
   * Fill the cache from the backend. Must be awaited once, before `load()`.
   *
   * Adopts a pre-move `localStorage` save when the backend has nothing — that is
   * the entire migration, and it runs exactly once because the adopted value is
   * written straight back to the new store.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const store = getSaveStore();
    let raw: string | null = null;
    try {
      raw = await store.get(STORAGE_KEY);
    } catch (err) {
      console.warn('[SaveManager] hydrate failed:', err);
    }
    if (raw === null) {
      const legacy = readLegacySave(STORAGE_KEY);
      if (legacy !== null) {
        raw = legacy;
        try {
          await store.set(STORAGE_KEY, legacy);
        } catch (err) {
          console.warn('[SaveManager] migrating the legacy save failed:', err);
        }
      }
    }
    this.cached = raw;
    this.hydrated = true;
  }

  /**
   * Resolves when every write issued so far has reached the backend. The native
   * `pause` handler awaits this; nothing in the frame loop does.
   */
  flushNow(): Promise<void> {
    return this.flushQueue;
  }

  /** Chain one write behind the last, newest payload wins. */
  private scheduleFlush(): void {
    const payload = this.cached;
    const store = getSaveStore();
    this.flushQueue = this.flushQueue
      .then(() => (payload === null ? store.remove(STORAGE_KEY) : store.set(STORAGE_KEY, payload)))
      .catch((err) => {
        console.warn('[SaveManager] flush failed:', err);
      });
  }
```

**(d)** Rewrite the four IO methods. **Signatures and return types do not change.**

```ts
  save(state: GameState): boolean {
    let serialized: string;
    try {
      serialized = JSON.stringify(this.snapshot(state));
    } catch (err) {
      console.warn('[SaveManager] save failed:', err);
      return false;
    }
    this.cached = serialized;
    this.saveTimer = 0;
    this.savePending = false;
    this.scheduleFlush();
    return true;
  }

  load(): PersistentState | null {
    // `hydrate()` is awaited by `bootstrap` before this can be reached. If it
    // has not run, the honest answer is "unknown", and returning null would be
    // read as "new player" — which would hand someone a fresh account.
    if (!this.hydrated) {
      console.warn('[SaveManager] load() before hydrate(); returning null');
      return null;
    }
    const raw = this.cached;
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn('[SaveManager] load failed (parse):', err);
      this.clear();
      return null;
    }
    if (!validate(parsed)) {
      console.warn('[SaveManager] save data invalid; clearing');
      this.clear();
      return null;
    }
    this.saveTimer = 0;
    return parsed;
  }

  clear(): void {
    this.cached = null;
    this.scheduleFlush();
  }

  hasSave(): boolean {
    return this.cached !== null;
  }
```

**(e)** One behaviour change to record in the docstring: `save()` used to return `false` when
storage was unavailable. It now returns `false` only when *serialization* fails; a backend
write that fails is reported through `console.warn` from the flush, because by then the caller
has long since returned. `Game.manualSave()` still returns a boolean and still means "the
snapshot was taken".

### 8.8 `tests/save.test.ts` — harness change

The suite currently stubs `localStorage` globally and drives a fresh `SaveManager` per case.
Three mechanical changes; **do not touch any assertion about save contents or the migration
ladder**.

**(a)** Replace the `MemoryStorage` class and the `vi.stubGlobal` in `beforeEach`:

```ts
import { MemorySaveStore, setSaveStore } from '../src/systems/storage';
import type { PersistentState } from '../src/systems/SaveManager';

let store: MemorySaveStore;

beforeEach(() => {
  store = new MemorySaveStore();
  setSaveStore(store);
});
```

**(b)** Add two helpers next to `stubBus`, and use them everywhere the old code did
`storage.setItem(STORAGE_KEY, raw)` or `new SaveManager(stubBus).load()`:

```ts
/** Seed the backend with a raw save, the way a previous version would have left it. */
async function seed(raw: string): Promise<void> {
  await store.set(STORAGE_KEY, raw);
}

/** A fresh manager that has read what is in the backend — the boot path, in one line. */
async function loadFresh(): Promise<PersistentState | null> {
  const mgr = new SaveManager(stubBus);
  await mgr.hydrate();
  return mgr.load();
}
```

Each `it(...)` that uses them becomes `it('…', async () => { … })`. A case that saves and reads
back through the *same* manager (`mgr.save(state); mgr.load()`) needs `await mgr.hydrate()`
after construction and nothing else — the cache serves the read.

**(c)** The corrupt-save case asserts the entry was removed. `clear()` is now flushed
asynchronously, so await it:

```ts
  it('discards a corrupt save rather than loading garbage', async () => {
    await seed('{not json');
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.load()).toBeNull();
    await mgr.flushNow();
    expect(await store.get(STORAGE_KEY)).toBeNull();
  });
```

**(d)** Add one new case for the migration, since it is the path every existing player takes:

```ts
  it('adopts a pre-move localStorage save exactly once', async () => {
    // Produce a genuine v21 payload rather than hand-rolling one: save through a
    // manager, take the bytes it wrote, then start over with an empty backend.
    const seedMgr = new SaveManager(stubBus);
    await seedMgr.hydrate();
    seedMgr.save(makeState());
    await seedMgr.flushNow();
    const legacy = (await store.get(STORAGE_KEY))!;

    store = new MemorySaveStore();
    setSaveStore(store);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === STORAGE_KEY ? legacy : null),
      setItem: () => {},
      removeItem: () => {},
    });

    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.load()).not.toBeNull();
    // Adopted *into* the new backend, so the next boot needs no localStorage.
    expect(await store.get(STORAGE_KEY)).toBe(legacy);
    vi.unstubAllGlobals();
  });
```

### 8.9 Verification

```bash
npm run typecheck && npm test
```

Then, per `CLAUDE.md`, `detect_changes()`. The changed-symbol set must be
`SaveManager.save`, `SaveManager.load`, `SaveManager.clear`, `SaveManager.hasSave`, the removed
`isStorageAvailable`, the new `hydrate`/`flushNow`/`scheduleFlush`, the new files under
`src/systems/storage/`, `bootstrap`/`start` in `main.ts`, and the two **new** additive methods
`Game.hydrateSave` / `Game.flushSave` from §9.2. **Any *modified* existing method in
`src/game/Game.ts` means the design in §8.1 was not followed** — go back and re-read it rather
than fixing up call sites.

## 9. Step 6 — web-side native glue

### 9.1 New file: `src/platform/native.ts`

One module, imported unconditionally. Everything in it no-ops in a browser, so `npm run dev`
and the test suite are unaffected.

```ts
/**
 * The Capacitor shell's only web-side surface. See `plans/capacitor.md` §9.
 *
 * Every entry point is guarded by `Capacitor.isNativePlatform()`, so importing
 * this module from a browser tab (dev server, `vite preview`) costs one branch
 * and nothing else. The plugin packages ship web fallbacks, but the fallbacks
 * still install listeners we do not want in a tab.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/** True inside the Android (or a future iOS) shell, false in any browser. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Called once, as early as the bundle runs — before the sprite fetch resolves.
 * The status bar has to be told to overlay the WebView *and* to draw light
 * glyphs; the config's `StatusBar` block covers a cold start, but a config-only
 * setup loses to any theme the OS re-applies on resume, so it is re-asserted here.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // A status-bar failure is cosmetic. Never let it cost the boot.
  }
}

/**
 * Called after the UI has mounted and the first frame is on screen. Hiding the
 * splash any earlier shows the player an empty canvas.
 */
export async function hideNativeSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch {
    /* nothing to hide */
  }
}

/**
 * Back button and lifecycle.
 *
 * `onBack` returns true when it consumed the press by closing something. When
 * nothing was open we **minimise** rather than exit: the game is an idle game,
 * a killed process is a lost session, and Android's own convention for a single
 * -activity app at the root of its stack is to go to the launcher.
 *
 * `onPause` exists next to the existing `visibilitychange` handler in
 * `Game.bindVisibilityEvents`, not instead of it. `visibilitychange` is the one
 * that stops the loop; this one is the last hook that reliably runs before the
 * OS is free to kill the process from the background. It returns a promise
 * because the save backend is asynchronous now (§8) — taking the snapshot is
 * synchronous, but getting it onto disk is not, and this is the one place in the
 * app where waiting for the write is both possible and worth it.
 */
export function bindNativeLifecycle(handlers: {
  onBack: () => boolean;
  onPause: () => Promise<void> | void;
}): void {
  if (!isNative()) return;

  void App.addListener('backButton', () => {
    if (!handlers.onBack()) void App.minimizeApp();
  });

  void App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void handlers.onPause();
  });

  void App.addListener('pause', () => { void handlers.onPause(); });
}
```

### 9.2 Wire it into `src/main.ts`

Three edits. Run `impact({target: "bootstrap", direction: "upstream"})` first — it reports
**LOW risk, 0 upstream dependents** (only `start()` calls it), which is what you should expect;
if it reports anything else, stop and re-read the file.

**(a)** Add the import beside the others at the top:

```ts
import { initNativeShell, hideNativeSplash, bindNativeLifecycle } from './platform/native';
```

**(b)** In `main.ts` there is an `Escape` branch in the keydown handler that does
`game.cancelPlacement()` then `ui.isKeybindsOpen()/ui.closeKeybinds()`. Extract that ladder
verbatim into a named function above `bootstrap` so the back button and the keyboard cannot
drift apart:

```ts
/**
 * The "get me out of here" ladder, shared by `Escape` and the Android hardware
 * back button. Returns true when something was actually dismissed — the back
 * button uses that to decide between consuming the press and backgrounding
 * the app (src/platform/native.ts).
 *
 * Order matters: placement mode is first because it is the state that changes
 * what the next tap does, and so the one the player most urgently needs out of
 * (UI plan §4.3).
 */
function dismissTopmost(game: Game, ui: UIManager): boolean {
  if (game.cancelPlacement()) return true;
  if (ui.isKeybindsOpen()) {
    ui.closeKeybinds();
    return true;
  }
  return false;
}
```

Then rewrite the `Escape` branch to `if (dismissTopmost(game, ui)) ev.preventDefault();`.
**Do not change the ladder's behaviour** — same calls, same order.

**(c)** `bootstrap` must let the save backend hydrate *before* it reads the save. Add the two
additive methods to `Game` — new methods, no existing one is touched:

```ts
  /** Fill the save cache from the backend. Awaited once, before `tryLoadSave`. */
  hydrateSave(): Promise<void> {
    return this.saveMgr.hydrate();
  }

  /** Resolves once every pending save write has reached the backend. */
  flushSave(): Promise<void> {
    return this.saveMgr.flushNow();
  }
```

Then make `bootstrap` async and await hydration immediately before the existing
`game.tryLoadSave()` call:

```ts
  await game.hydrateSave();
  game.tryLoadSave();
  game.start();
```

`bootstrap` is invoked as `loadIconSprite().then(bootstrap)`, so returning a promise is already
supported and no caller changes.

**(d)** At the end of `bootstrap`, after `game.start()` and the `__theTower` assignment:

```ts
  bindNativeLifecycle({
    onBack: () => dismissTopmost(game, ui),
    // Snapshot synchronously, then wait for the bytes to land — this is the last
    // moment before Android is free to kill the process (§8.1).
    onPause: async () => { game.manualSave(); await game.flushSave(); },
  });
  // The first frame is scheduled by `game.start()`; one rAF later it has painted,
  // and only then is it safe to take the splash away.
  requestAnimationFrame(() => { void hideNativeSplash(); });
```

**(e)** In `start()`, kick the shell init off before the sprite fetch, and add a hard backstop
so a boot failure can never strand the player on a splash screen forever:

```ts
function start(): void {
  void initNativeShell();
  // launchAutoHide is false, so if `bootstrap` throws, nothing else would ever
  // hide the splash. Five seconds is far longer than a cold start on a slow
  // device and far shorter than a player's patience.
  setTimeout(() => { void hideNativeSplash(); }, 5000);
  void loadIconSprite().then(bootstrap);
}
```

`game.manualSave()` is already public (`src/game/Game.ts:3352`); `cancelPlacement`,
`isKeybindsOpen` and `closeKeybinds` are all already used by `main.ts`'s keydown handler.
`hydrateSave` and `flushSave` from (c) are the **only** two additions to `Game`, and both are
one-line delegations to `SaveManager` — no existing method on `Game` is modified by this plan.

---

## 10. Step 7 — npm scripts

Add to `package.json` `scripts` (keep the existing ones untouched):

```json
    "cap:sync": "npm run build && npx cap sync android",
    "android:dev": "npm run cap:sync && npx cap run android",
    "android:apk": "npm run cap:sync && cd android && ./gradlew assembleDebug",
    "android:release": "npm run cap:sync && cd android && ./gradlew assembleRelease",
    "android:bundle": "npm run cap:sync && cd android && ./gradlew bundleRelease",
    "android:open": "npx cap open android"
```

`cap sync` = `cap copy` (web assets + config) + `cap update` (native plugin wiring). Always go
through `cap:sync`; running `gradlew` directly ships whatever `dist/` happened to be there
last, which during development is reliably the wrong thing.

---

## 11. Step 8 — `.gitignore`

`cap add` writes its own `android/.gitignore` and `android/app/.gitignore`. Append to the
**root** `.gitignore`, after the existing `dist` entry:

```gitignore
# Capacitor / Android
# The native project is committed (it carries hand-written edits); its build
# output, the copied web bundle and anything with a secret in it are not.
android/app/src/main/assets/public/
android/app/src/main/assets/capacitor.config.json
android/app/src/main/assets/capacitor.plugins.json
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/capacitor-cordova-android-plugins/
android/keystore.properties
*.keystore
*.jks
```

Then confirm nothing large or secret is staged:

```bash
git status --short android/ | head -40
git check-ignore -v android/app/src/main/assets/public/index.html
```

---

## 12. Step 9 — build, install, verify

### 12.1 Debug build

```bash
npm run android:apk
```

First run downloads Gradle and the AndroidX artifacts; expect several minutes. The APK lands
at `android/app/build/outputs/apk/debug/app-debug.apk`.

### 12.2 Install

With a device attached (USB debugging on) or an emulator running:

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

If there is no device, `npx cap open android` opens Android Studio, and
`sdkmanager --list | grep system-images` plus the AVD manager can create an emulator. An
emulator is enough for everything in §12.3 except the frame-rate check.

### 12.3 Verification — run every item

| # | Check | How |
|---|---|---|
| 1 | Launcher shows **The Tower** with the tower icon, correct on both circular and squircle masks | look at the launcher; long-press → App info |
| 2 | Splash is dark, no white flash into the game | cold start (`adb shell am force-stop com.mariusdonci.thetower` first) |
| 3 | **Offline.** Enable airplane mode, force-stop, relaunch: everything loads — icons, fonts, canvas | icons rendering is the tell; the sprite is the only `fetch()` |
| 4 | Zero network requests | `adb shell dumpsys package com.mariusdonci.thetower \| grep -i internet` returns nothing |
| 5 | Safe areas non-zero | see the snippet below |
| 6 | HUD and ability bar clear of the status bar and gesture bar, portrait **and** landscape | rotate the device |
| 7 | Back button closes an open overlay (press `?`-equivalent / open keybinds first), then backgrounds the app | press back twice |
| 8 | Backgrounding saves; returning applies offline progress | background for ~2 min, return, watch for the offline-progress path |
| 9 | Audio starts on the first tap and survives background/resume | tap to fire |
| 10 | No console errors | see below |
| 11 | Frame rate acceptable on a real mid-range device; quality tier auto-picked sensibly | `__theTower.bench({enemies: 250, seconds: 10})` in the console |

For 5, 10 and 11: with the debug build installed, open `chrome://inspect` in desktop Chrome,
click **inspect** under the app (Capacitor enables WebView debugging for debug builds by
default), and in that console run:

```js
getComputedStyle(document.documentElement).getPropertyValue('--safe-t')
```

It must be a non-zero `px` value on any device with a notch or a gesture bar. `0px` on such a
device means §6.1 or `viewport-fit=cover` is not in effect.

Also useful while testing:

```bash
adb logcat -s Capacitor:V Capacitor/Console:V chromium:E
```

---

## 13. Step 10 — release build and signing

> **The keystore is the user's to create.** It requires passwords, and passwords are not
> something an agent may generate, type or store. Print the commands below for the user and
> stop; resume once they confirm `~/keystores/the-tower.jks` and
> `android/keystore.properties` exist.

### 13.1 The user creates a keystore (one time, keep it forever)

Losing this file means never being able to update the app on Play again.

```bash
keytool -genkey -v -keystore ~/keystores/the-tower.jks -keyalg RSA -keysize 4096 -validity 10000 -alias the-tower
```

### 13.2 The user writes `android/keystore.properties` (gitignored by §11)

```properties
storeFile=/home/marius/keystores/the-tower.jks
storePassword=…
keyAlias=the-tower
keyPassword=…
```

### 13.3 Wire the signing config into `android/app/build.gradle`

At the very top of the file, above `apply plugin: 'com.android.application'`:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Inside `android { … }`, before `buildTypes`:

```gradle
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
```

And in `buildTypes.release`:

```gradle
        release {
            if (keystorePropertiesFile.exists()) {
                signingConfig signingConfigs.release
            }
            // Left off deliberately: the app *is* the JS bundle, so shrinking the
            // thin Java shell saves almost nothing, while R8 plus Capacitor's
            // reflective plugin registration is a real source of release-only
            // crashes. Revisit only if the APK size becomes a problem.
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
```

The `if (…exists())` guard is what keeps `assembleRelease` from failing on a machine without
the keystore — it produces an unsigned APK there instead of an error.

### 13.4 Build

```bash
npm run android:release   # APK  → android/app/build/outputs/apk/release/app-release.apk
npm run android:bundle    # AAB  → android/app/build/outputs/bundle/release/app-release.aab
```

Verify the signature and that the release build is still offline:

```bash
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/aapt2" dump permissions android/app/build/outputs/apk/release/app-release.apk
```

The permission dump must list **no** `android.permission.INTERNET`.

Install a release APK over a debug one only after uninstalling — the signatures differ:

```bash
adb uninstall com.mariusdonci.thetower && adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## 14. Step 11 — tests and docs

### 14.1 Extend the existing offline guard

`tests/palette.test.ts` has a `describe('no runtime network')` block with a `SOURCES` list of
`[label, relativePath]` pairs. **Leave that file alone** — the new invariants are about the
native shell, not the palette, and belong in their own file.

### 14.2 New file: `tests/capacitor.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');
const hasAndroid = existsSync(resolve(root, 'android/app/src/main/AndroidManifest.xml'));

/**
 * The native shell's invariants. See `plans/capacitor.md`.
 *
 * The Android platform is committed, but these skip rather than fail when it is
 * absent so a fresh checkout that has not run `npx cap add android` still has a
 * green suite.
 */
describe('capacitor config', () => {
  const cfg = read('capacitor.config.ts');

  it('keeps the app identity that the Play Store listing is keyed to', () => {
    expect(cfg).toContain("appId: 'com.mariusdonci.thetower'");
    expect(cfg).toContain("appName: 'The Tower'");
    expect(cfg).toContain("webDir: 'dist'");
  });

  it('pins the scheme that localStorage saves are keyed to', () => {
    // Changing either of these changes the WebView origin, which orphans every
    // player's `the-tower-save` (src/systems/SaveManager.ts).
    expect(cfg).toContain("androidScheme: 'https'");
    expect(cfg).toContain("hostname: 'localhost'");
  });

  it('never points the shipped app at a remote host', () => {
    // `server.url` is the live-reload footgun: it makes the app unusable offline
    // and, if it ever shipped, points players at a dev machine.
    expect(cfg).not.toMatch(/\burl:\s*['"]https?:/);
    expect(cfg).not.toMatch(/cleartext:\s*true/);
  });
});

describe.skipIf(!hasAndroid)('android shell', () => {
  it('ships without the INTERNET permission', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).not.toContain('android.permission.INTERNET');
  });

  it('is named The Tower', () => {
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('<string name="app_name">The Tower</string>');
  });

  it('goes edge-to-edge so the safe-area tokens resolve', () => {
    const activity = read(
      'android/app/src/main/java/com/mariusdonci/thetower/MainActivity.java',
    );
    expect(activity).toContain('setDecorFitsSystemWindows');
  });

  it('keeps the native ground colour in step with --surface-0', () => {
    const colors = read('android/app/src/main/res/values/colors.xml');
    expect(colors).toContain('#0a0d14');
  });
});
```

`describe.skipIf` is available in the pinned Vitest (4.1.11) — verified. If a future bump
removes it, `const d = hasAndroid ? describe : describe.skip;` is the equivalent.

### 14.3 Docs

- **`docs/ui-system.md` § "Capacitor"** — it currently says "nothing in this repo provisions the
  native project" and gives a four-line `cap add` recipe. Rewrite it to describe what now
  exists: the committed `android/`, the `npm run android:*` scripts, `capacitor.config.ts`, the
  removed `INTERNET` permission, the edge-to-edge `MainActivity`, and the four places `#0a0d14`
  is written (`tokens.css`, `index.html` `theme-color`, `capacitor.config.ts`,
  `android/.../values/colors.xml`) that must change together.
- **`docs/save-system.md`** — this is the one that goes stale hardest. Its summary line and
  its persistence section describe `localStorage`. Rewrite them for the §8 layout: the
  `SaveStore` interface and its three implementations, the sync-cache-over-async-backend design
  and *why* (the CRITICAL blast radius in §8.1), `hydrate()` in the boot order, the write-tmp-
  then-rename dance on Android, and the one-time `localStorage` adoption plus when to delete
  that fallback. The save format section does **not** change — it is still v21.
- **`AGENTS.md`** — the docs index row for `docs/save-system.md` reads "localStorage
  persistence, …". Update that phrase to name the two backends. Add a row if you create a new
  doc; otherwise leave the file alone.
- **`plans/ui-improvements.md` §9** — it says "Actually adding the Capacitor project is out of
  scope for this plan". Add a one-line pointer to `plans/capacitor.md`; do not rewrite §9.1.
- **`README.md`** — add the build commands.

### 14.4 Final checks before committing

```bash
npm run typecheck && npm test && npm run build
```

Then, per `CLAUDE.md`, `detect_changes()` to confirm the affected symbol set is only
`bootstrap`, `start`, the new `dismissTopmost`, and the new `src/platform/native.ts`.

---

## 15. Acceptance checklist

- [ ] `npm run typecheck`, `npm test`, `npm run build` all pass
- [ ] `npm run android:apk` produces a debug APK from a clean `android/` build dir
- [ ] Launcher entry reads **The Tower**; adaptive icon correct on circle and squircle masks
- [ ] Cold start: dark splash → game, no white flash
- [ ] Airplane mode: app fully functional, icons and fonts present
- [ ] `aapt2 dump permissions` on the APK lists no `INTERNET` (or §5.3's rollback is documented)
- [ ] `--safe-t` non-zero on a notched device; HUD/ability bar unobstructed in both orientations
- [ ] Back closes an overlay, then backgrounds; the run survives
- [ ] Background 2 min → return: save written, offline progress applied
- [ ] Web: after a save, `indexedDB` database `the-tower` → store `kv` holds `the-tower-save`,
      and nothing new is written to `localStorage`
- [ ] Web: a player with an existing `localStorage` save loads it once and is migrated
      (`await store.get(...)` non-null afterwards), with no visible loss of progress
- [ ] Android: `adb shell run-as com.mariusdonci.thetower ls -l files/` shows
      `the-tower-save.json`, and no stale `.tmp` beside it after a clean save
- [ ] Android: `adb shell am force-stop` mid-run, relaunch → progress up to the last autosave
      is intact and the save parses (no "save data invalid; clearing" in the console)
- [ ] `detect_changes()` reports no *modified* method in `src/game/Game.ts` (only the two new
      `hydrateSave` / `flushSave`)
- [ ] Audio works after the first tap
- [ ] `npm run android:release` produces a signed APK when `keystore.properties` exists and an
      unsigned one when it does not
- [ ] `git status` clean of build output, the copied web bundle, and any keystore
- [ ] `docs/ui-system.md` § Capacitor rewritten; `plans/ui-improvements.md` §9 points here

---

## 16. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank/white screen, `ERR_ACCESS_DENIED` in logcat | §5.3's missing `INTERNET` permission | restore the `<uses-permission>` line, rebuild, document it |
| Blank screen, `Unable to open asset URL` | `dist/` never copied | `npx cap sync android`; never run `gradlew` without `cap:sync` |
| AAPT: `resource color/colorPrimary not found` | §6.2 not done | create `values/colors.xml` |
| `SDK location not found` | `ANDROID_HOME` not visible to Gradle | `echo "sdk.dir=/opt/android-sdk" > android/local.properties` (gitignored) |
| `Failed to install the following SDK components` | build-tools 36 missing | `sdkmanager --install "build-tools;36.0.0"` |
| `Unsupported class file major version` / Gradle JVM error | wrong JDK | JDK 21 is required; `java -version` must say 21 |
| Splash never goes away | `bootstrap` threw before §9.2(d) | check the `chrome://inspect` console; the §9.2(e) 5s backstop should have fired |
| Icons missing, everything else fine | sprite fetch failed | `loadIconSprite` resolves on failure by design; check `assets/public/icons/sprite.svg` was copied |
| Safe areas all `0px` | §6.1 missing, or the launch theme still fits system windows | verify `setDecorFitsSystemWindows(…, false)` and §6.3 |
| Saves vanished after an update | the WebView origin changed | `androidScheme`/`hostname` were edited — revert them; §14.2 guards this |
| Every launch is a new account | `load()` ran before `hydrate()` | the console warns explicitly; §9.2(c)'s `await game.hydrateSave()` is missing |
| Android save never appears on disk | `Filesystem.writeFile` failed | `adb logcat \| grep -i filesystem`; confirm `Directory.Data` and `recursive: true` |
| Web saves do not persist, no error | IndexedDB denied (private browsing) → `MemorySaveStore` | expected fallback; the old `localStorage` path failed the same way |
| A pre-move save was not picked up | the legacy read is origin-scoped too | it only migrates within the same origin — a browser save cannot migrate into the app, and never could |
| Release APK crashes where debug does not | R8 vs Capacitor's reflective plugin registration | confirm `minifyEnabled false` (§13.3) |

---

## 17. Out of scope

Not part of this plan; do not start any of them:

- **iOS.** `npx cap add ios` needs macOS and Xcode. The web side is already portable; adding
  it later is a separate plan.
- **Play Store listing**, screenshots, content rating, privacy policy.
- **Live reload** (`cap run --live-reload`). It requires `server.url`, which §4.2 forbids.
- **Keeping the screen awake.** Tempting for an idle game, but it is a battery decision that
  belongs to the player, so it needs a Settings toggle — its own small plan.
- **Immersive/fullscreen mode** (hiding the system bars). The safe-area work already makes the
  bars harmless, and hiding them fights the OS's gesture navigation.
- **Any change to game logic, balance, the save format, or the renderer.**
