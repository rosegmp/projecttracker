package com.destinyhomes.projecthub;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DownloadsPlugin.class);
        registerPlugin(AndroidIntentsPlugin.class);
        registerPlugin(NotificationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        configurePinchZoom();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }

    private void configurePinchZoom() {
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PluginHandle handle = bridge == null ? null : bridge.getPlugin("AndroidIntents");
        if (handle != null && handle.getInstance() instanceof AndroidIntentsPlugin) {
            ((AndroidIntentsPlugin) handle.getInstance()).handleIntent(intent);
        }
    }
}
