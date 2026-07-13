import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export function isNativeAndroidApp() {
  if (typeof window === 'undefined') return false;
  const isNativePlatform = window.Capacitor?.isNativePlatform?.() === true;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return isNativePlatform && /Android/i.test(userAgent);
}

export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('Unable to prepare download.');
  return response.blob();
}

export function isShareDismissed(error) {
  if (!error) return false;
  const message = String(error?.message || error || '').toLowerCase();
  return error?.name === 'AbortError' || message.includes('abort') || message.includes('cancel');
}

export async function downloadBlobForCurrentPlatform(blob, fileName = 'download') {
  const safeName = String(fileName || 'download').trim() || 'download';
  if (isNativeAndroidApp()) {
    const androidSafeName = safeName.replace(/[\\/:*?"<>|]+/g, '-');
    const path = `downloads/${androidSafeName}`;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not prepare the file for download.'));
      reader.readAsDataURL(blob);
    });
    const base64Data = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
    await Filesystem.writeFile({ path, data: base64Data, directory: Directory.Cache, recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: androidSafeName, url: uri, dialogTitle: `Save or share ${androidSafeName}` });
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageFile(file) {
  if (!file) return false;
  if (String(file.type || '').toLowerCase().startsWith('image/')) return true;
  const name = String(file.originalName || file.name || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
}
