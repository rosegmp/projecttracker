let nativeFileModulesPromise = null;
let notificationSettingsPluginPromise = null;

async function loadNativeFileModules() {
  if (!nativeFileModulesPromise) {
    nativeFileModulesPromise = Promise.all([
      import('@capacitor/core'),
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]).then(([core, filesystem, share]) => ({
      Downloads: core.registerPlugin('Downloads'),
      Directory: filesystem.Directory,
      Filesystem: filesystem.Filesystem,
      Share: share.Share,
    }));
  }
  return nativeFileModulesPromise;
}

export function isNativeAndroidApp() {
  if (typeof window === 'undefined') return false;
  const isNativePlatform = window.Capacitor?.isNativePlatform?.() === true;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return isNativePlatform && /Android/i.test(userAgent);
}

export async function openAndroidNotificationSettings() {
  if (!isNativeAndroidApp()) return false;
  if (!notificationSettingsPluginPromise) {
    notificationSettingsPluginPromise = import('@capacitor/core').then(({ registerPlugin }) =>
      registerPlugin('NotificationSettings'),
    );
  }
  const plugin = await notificationSettingsPluginPromise;
  await plugin.open();
  return true;
}

export function isShareDismissed(error) {
  if (!error) return false;
  const message = String(error?.message || error || '').toLowerCase();
  return error?.name === 'AbortError' || message.includes('abort') || message.includes('cancel');
}

function safeFileName(fileName) {
  return (String(fileName || 'download').trim() || 'download').replace(/[\\/:*?"<>|]+/g, '-');
}

async function blobToBase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not prepare the file.'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
}

export async function deliverBlob(blob, fileName = 'download', options = {}) {
  const name = safeFileName(fileName);
  if (isNativeAndroidApp()) {
    const { Downloads, Directory, Filesystem, Share } = await loadNativeFileModules();
    const path = `downloads/${Date.now()}-${name}`;
    await Filesystem.writeFile({
      path,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    let deleteCachedFile = true;
    try {
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      if (options.action === 'open') {
        await Downloads.openFile({
          sourceUri: uri,
          fileName: name,
          mimeType: blob.type || 'application/octet-stream',
        });
        deleteCachedFile = false;
        return { action: 'opened' };
      }
      if (options.action === 'save') {
        await Downloads.saveFile({
          sourceUri: uri,
          fileName: name,
          mimeType: blob.type || 'application/octet-stream',
        });
        return { action: 'saved' };
      }
      await Share.share({ title: name, url: uri, dialogTitle: `Share ${name}` });
      return { action: 'shared' };
    } finally {
      if (deleteCachedFile) {
        await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
      }
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return { action: 'downloaded' };
}

export function openPreview(source, options = {}) {
  if (!source || typeof window === 'undefined') return false;
  const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : String(source);
  const previewWindow = window.open(objectUrl, '_blank', options.features || 'noopener,noreferrer');
  if (source instanceof Blob) {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), options.revokeAfterMs || 60_000);
  }
  return !!previewWindow;
}

export function openMailComposer(email, subject = '', body = '') {
  if (typeof window === 'undefined') return;
  window.location.href = `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function getCurrentUrl() {
  if (typeof window === 'undefined') return null;
  return new URL(window.location.href);
}

export function getSearchParam(name) {
  return getCurrentUrl()?.searchParams.get(name) || '';
}

export function updateCurrentUrl(update, { push = false } = {}) {
  if (typeof window === 'undefined') return;
  const url = getCurrentUrl();
  if (!url) return;
  update(url);
  window.history[push ? 'pushState' : 'replaceState'](null, '', url);
}

export function getAppRedirectUrl() {
  const url = getCurrentUrl();
  return url ? `${url.origin}${url.pathname}` : '';
}
