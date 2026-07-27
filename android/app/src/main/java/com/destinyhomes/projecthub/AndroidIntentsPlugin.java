package com.destinyhomes.projecthub;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "AndroidIntents")
public class AndroidIntentsPlugin extends Plugin {
    public static final String ACTION_CREATE_TASK = "com.destinyhomes.projecthub.CREATE_TASK";
    public static final String ACTION_CREATE_INSPECTION = "com.destinyhomes.projecthub.CREATE_INSPECTION";
    public static final String ACTION_CREATE_DAILY_LOG = "com.destinyhomes.projecthub.CREATE_DAILY_LOG";

    private JSObject pendingAction;

    @Override
    public void load() {
        handleIntent(getActivity().getIntent());
    }

    public void handleIntent(Intent intent) {
        if (intent == null) return;
        JSObject payload = null;
        String action = intent.getAction();
        try {
            if (ACTION_CREATE_TASK.equals(action)) {
                payload = actionPayload("create-task");
            } else if (ACTION_CREATE_INSPECTION.equals(action)) {
                payload = actionPayload("create-inspection");
            } else if (ACTION_CREATE_DAILY_LOG.equals(action)) {
                payload = actionPayload("create-daily-log");
            } else if (Intent.ACTION_SEND.equals(action) && intent.getType() != null && intent.getType().startsWith("image/")) {
                Uri sharedUri = sharedStream(intent);
                if (sharedUri != null) payload = cacheSharedPhoto(sharedUri, intent.getType());
            }
        } catch (Exception error) {
            payload = actionPayload("error");
            payload.put("message", "Android could not import the shared photo.");
        }

        if (payload == null) return;
        pendingAction = payload;
        notifyListeners("actionReceived", payload);
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_STREAM);
    }

    @PluginMethod
    public void consumePendingAction(PluginCall call) {
        JSObject result = new JSObject();
        result.put("action", pendingAction == null ? JSObject.NULL : pendingAction);
        pendingAction = null;
        call.resolve(result);
    }

    @PluginMethod
    public void removeSharedFile(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath != null && !filePath.trim().isEmpty()) {
            File sharedDirectory = new File(getContext().getCacheDir(), "shared");
            File target = new File(filePath);
            try {
                if (target.getCanonicalPath().startsWith(sharedDirectory.getCanonicalPath() + File.separator)) {
                    target.delete();
                }
            } catch (Exception ignored) {
                // Cache cleanup is best effort.
            }
        }
        call.resolve();
    }

    private JSObject actionPayload(String type) {
        JSObject payload = new JSObject();
        payload.put("type", type);
        payload.put("token", System.currentTimeMillis());
        return payload;
    }

    private JSObject cacheSharedPhoto(Uri sourceUri, String suppliedMimeType) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String mimeType = resolver.getType(sourceUri);
        if (mimeType == null || mimeType.trim().isEmpty()) mimeType = suppliedMimeType;
        if (mimeType == null || !mimeType.startsWith("image/")) {
            throw new IllegalArgumentException("Only images can be shared to this app.");
        }

        String displayName = queryDisplayName(resolver, sourceUri);
        if (displayName == null || displayName.trim().isEmpty()) {
            String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            displayName = "shared-photo-" + System.currentTimeMillis() + (extension == null ? "" : "." + extension);
        }
        displayName = displayName.replaceAll("[\\\\/:*?\"<>|]+", "-");

        File directory = new File(getContext().getCacheDir(), "shared");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Android could not prepare shared-photo storage.");
        }
        File destination = new File(directory, System.currentTimeMillis() + "-" + displayName);
        try (
            InputStream input = resolver.openInputStream(sourceUri);
            FileOutputStream output = new FileOutputStream(destination)
        ) {
            if (input == null) throw new IllegalStateException("Android could not read the shared photo.");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }

        JSObject payload = actionPayload("share-photo");
        payload.put("filePath", destination.getAbsolutePath());
        payload.put("fileName", displayName);
        payload.put("mimeType", mimeType);
        payload.put("size", destination.length());
        return payload;
    }

    @SuppressWarnings("deprecation")
    private Uri sharedStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Fall back to a generated name.
        }
        return null;
    }
}
