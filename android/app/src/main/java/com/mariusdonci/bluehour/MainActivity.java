package com.mariusdonci.bluehour;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Edge-to-edge is mandatory at targetSdk 36, but the WebView only reports
 * non-zero env(safe-area-inset-*) when the decor view has stopped fitting system
 * windows. The game's HUD, ability bar and bottom nav are all positioned off
 * those insets (--safe-t/r/b/l in src/styles/tokens.css), so without this line
 * the status bar and the gesture bar sit on top of the two most-tapped surfaces.
 *
 * The game's own plugin (the screen kept on in runs) is registered before the
 * bridge starts, as Capacitor asks of local plugins.
 *
 * Orientation (plans/large-screens.md §10.1): a phone stays portrait; a
 * tablet or an unfolded foldable (smallest width ≥ 600 dp) turns freely and
 * the web side lays itself out for whichever way it's held. The rule is
 * applied again on every configuration change, so folding a foldable mid-run
 * locks it back to portrait and unfolding releases it. configChanges keeps
 * the WebView, and the run, alive through all of it.
 */
public class MainActivity extends BridgeActivity {
    /** Android's own large-screen line, and the web side's (FORM_MIN_SHORT in src/app/formFactor.ts). */
    static final int LARGE_SCREEN_DP = 600;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenAwakePlugin.class);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applyOrientation(getResources().getConfiguration());
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyOrientation(newConfig);
    }

    /** Portrait below 600 dp, the user's choice of any orientation at or above it. */
    private void applyOrientation(Configuration config) {
        int want = config.smallestScreenWidthDp < LARGE_SCREEN_DP
            ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
        // Only on a change: the smallest width doesn't depend on orientation, so this settles at once.
        if (getRequestedOrientation() != want) setRequestedOrientation(want);
    }
}
