import { downloadProjectFileFromStorage } from '../services/trackerData.js';
import { beginDownloadProgress, showAppAlert, showAppChoice } from '../components/AppDialogs.jsx';
import { dataUrlToBlob } from './fileUi.js';
import { deliverBlob, isNativeAndroidApp, isShareDismissed } from '../platform/platformAdapter.js';

export async function downloadFileWithUi(file, options = {}) {
  if (!file) return null;
  const fileName = String(
    options.fileName || file.originalName || file.name || 'download',
  ).trim() || 'download';
  let androidAction = 'share';

  if (isNativeAndroidApp()) {
    androidAction = await showAppChoice(`Choose what to do with "${fileName}".`, {
      title: 'Download file',
      options: [
        { value: 'save', label: 'Save to Downloads', tone: 'primary' },
        { value: 'share', label: 'Share' },
      ],
    });
    if (!androidAction) return null;
  }

  const progress = beginDownloadProgress(`Downloading ${fileName}`);
  try {
    let blob = null;
    if (file.storagePath && file.storageBucket) {
      blob = await downloadProjectFileFromStorage(file, {
        onProgress: (loaded, total) => progress.update(loaded, total),
      });
    } else if (file.dataUrl) {
      blob = await dataUrlToBlob(file.dataUrl);
      progress.update(blob.size, blob.size);
    }
    if (!blob) {
      progress.close();
      return null;
    }

    const result = await deliverBlob(blob, fileName, { action: androidAction });
    progress.complete(
      result?.action === 'saved'
        ? 'Saved to Downloads'
        : result?.action === 'shared'
          ? 'Ready to share'
          : 'Download complete',
    );
    return result;
  } catch (error) {
    progress.close();
    if (isShareDismissed(error)) return null;
    await showAppAlert(
      error instanceof Error ? error.message : options.failureMessage || 'Unable to download the file.',
      options.failureTitle || 'Download failed',
    );
    return null;
  }
}
