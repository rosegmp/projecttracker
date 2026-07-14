package com.destinyhomes.projecthub;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "Downloads",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class DownloadsPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }
        saveFileInternal(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("Storage permission is required to save to Downloads on this Android version.");
            return;
        }
        saveFileInternal(call);
    }

    private void saveFileInternal(PluginCall call) {
        String sourceUriValue = call.getString("sourceUri");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (sourceUriValue == null || sourceUriValue.trim().isEmpty() || fileName == null || fileName.trim().isEmpty()) {
            call.reject("The downloaded file is missing its source or name.");
            return;
        }

        try {
            JSObject result = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveWithMediaStore(sourceUriValue, fileName, mimeType)
                : saveToLegacyDownloads(sourceUriValue, fileName, mimeType);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to save the file to Downloads.", error);
        }
    }

    private JSObject saveWithMediaStore(String sourceUriValue, String fileName, String mimeType) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri destinationUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (destinationUri == null) throw new IllegalStateException("Android could not create the Downloads file.");

        try {
            copySourceToOutput(sourceUriValue, resolver.openOutputStream(destinationUri));
            ContentValues completedValues = new ContentValues();
            completedValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(destinationUri, completedValues, null, null);
            return buildResult(destinationUri, fileName);
        } catch (Exception error) {
            resolver.delete(destinationUri, null, null);
            throw error;
        }
    }

    @SuppressWarnings("deprecation")
    private JSObject saveToLegacyDownloads(String sourceUriValue, String fileName, String mimeType) throws Exception {
        File downloadsDirectory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!downloadsDirectory.exists() && !downloadsDirectory.mkdirs()) {
            throw new IllegalStateException("Android could not open the Downloads folder.");
        }
        File destinationFile = uniqueDestination(downloadsDirectory, fileName);
        try {
            copySourceToOutput(sourceUriValue, new FileOutputStream(destinationFile));
            MediaScannerConnection.scanFile(
                getContext(),
                new String[] { destinationFile.getAbsolutePath() },
                new String[] { mimeType },
                null
            );
            return buildResult(Uri.fromFile(destinationFile), destinationFile.getName());
        } catch (Exception error) {
            destinationFile.delete();
            throw error;
        }
    }

    private void copySourceToOutput(String sourceUriValue, OutputStream output) throws Exception {
        Uri sourceUri = Uri.parse(sourceUriValue);
        ContentResolver resolver = getContext().getContentResolver();
        try (
            InputStream input = "file".equalsIgnoreCase(sourceUri.getScheme())
                ? new FileInputStream(new File(sourceUri.getPath()))
                : resolver.openInputStream(sourceUri);
            OutputStream destination = output
        ) {
            if (input == null || destination == null) throw new IllegalStateException("Android could not open the downloaded file.");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) destination.write(buffer, 0, count);
            destination.flush();
        }
    }

    private File uniqueDestination(File directory, String fileName) {
        File candidate = new File(directory, fileName);
        if (!candidate.exists()) return candidate;
        int dotIndex = fileName.lastIndexOf('.');
        String baseName = dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
        String extension = dotIndex > 0 ? fileName.substring(dotIndex) : "";
        int copyNumber = 2;
        while (candidate.exists()) {
            candidate = new File(directory, baseName + " (" + copyNumber + ")" + extension);
            copyNumber += 1;
        }
        return candidate;
    }

    private JSObject buildResult(Uri uri, String fileName) {
        JSObject result = new JSObject();
        result.put("uri", uri.toString());
        result.put("fileName", fileName);
        return result;
    }
}
