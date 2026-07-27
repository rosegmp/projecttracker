package com.destinyhomes.projecthub;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DownloadsPlugin.class);
        registerPlugin(AndroidIntentsPlugin.class);
        registerPlugin(NotificationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
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
