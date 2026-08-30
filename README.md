# idle-tower

**The Tower** — an idle tower-defence game. TypeScript + Vite, canvas renderer,
no runtime network.

## Web

```bash
npm install
npm run dev        # dev server on :5173
npm run build      # typecheck + bundle to dist/
npm run typecheck
npm test
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
permission. See `docs/ui-system.md` § Capacitor and `plans/capacitor.md`.

## Docs

`AGENTS.md` indexes `docs/`. Design plans live in `plans/`.
