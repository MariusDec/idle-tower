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
