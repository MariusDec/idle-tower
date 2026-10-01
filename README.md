# idle-tower

**The Tower** — an incremental roguelite tower defence. TypeScript + Vite,
canvas renderer, no runtime network. Two acts: six regions to the Blight's
fall, then pacts, the Constellations and the Abyss. See `plans/rebuild.md`.

## Web

```bash
npm install
npm run dev        # dev server on :5173
npm run build      # typecheck + bundle to dist/
npm run typecheck
npm test
npm run inspect    # one seeded run, headless
npm run pacing     # a fresh profile played by the bot; the invariants
npm run arsenal    # the bot's weapon picks per region (I4)
```

## Android

The Capacitor project is committed at `android/`. Requires JDK 21 and the
Android SDK (platform 36, build-tools 36.0.0).

```bash
npm run android:apk      # debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:dev      # sync and run on a device or emulator
npm run android:release  # release APK (signed if android/keystore.properties exists, see below)
npm run android:bundle   # AAB for the Play Store
npm run android:open     # open in Android Studio
```

Always go through these scripts rather than `gradlew` directly — each one runs
`npm run cap:sync` first, which rebuilds `dist/` and copies it into the native
project.

The shipped app is fully offline: it is built without the `INTERNET`
permission.

### Signing a release build

Without a keystore, `android:release` writes an unsigned
`app-release-unsigned.apk`, which Android won't install. To sideload a
release build, make a keystore once and keep it safe (an update must be
signed with the same key):

```bash
keytool -genkeypair -v -keystore ~/the-tower-release.jks -alias the-tower -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android/keystore.properties` (git-ignored, like every
`*.jks`):

```properties
storeFile=/home/you/the-tower-release.jks
storePassword=…
keyAlias=the-tower
keyPassword=…
```

and `npm run android:release` writes a signed
`android/app/build/outputs/apk/release/app-release.apk`.

## Docs

`docs/` has one file per system ([docs/README.md](docs/README.md)), and
`AGENTS.md` the short version for agents. The design is `plans/rebuild.md`;
older plans are in `plans/archive/`. The old game is the tag
`legacy-final`.
