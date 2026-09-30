# idle-tower

**The Tower** — an incremental roguelite tower defence. TypeScript + Vite,
canvas renderer, no runtime network. Being rebuilt; see `plans/rebuild.md`.

## Web

```bash
npm install
npm run dev        # dev server on :5173
npm run build      # typecheck + bundle to dist/
npm run typecheck
npm test
npm run inspect    # one seeded run, headless
```

## Android

The Capacitor project is committed at `android/`. Requires JDK 21 and the
Android SDK (platform 36, build-tools 36.0.0).

```bash
npm run android:apk      # debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:dev      # sync and run on a device or emulator
npm run android:release  # release APK (signed if android/keystore.properties exists)
npm run android:bundle   # AAB for the Play Store
npm run android:open     # open in Android Studio
```

Always go through these scripts rather than `gradlew` directly — each one runs
`npm run cap:sync` first, which rebuilds `dist/` and copies it into the native
project.

The shipped app is fully offline: it is built without the `INTERNET`
permission.

## Docs

`AGENTS.md` describes the source layout. The design is `plans/rebuild.md`;
older plans are in `plans/archive/`, and the old game is in `legacy/`.
