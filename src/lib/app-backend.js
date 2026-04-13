export const DEFAULT_APP_BACKEND_URL = 'https://opencomet.onrender.com';
export const LOCAL_APP_BACKEND_URL = 'http://localhost:4100';
export const LOCAL_APP_BACKEND_LOOPBACK_URL = 'http://127.0.0.1:4100';

function isUnpackedExtensionRuntime() {
  try {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.getManifest) return false;
    const manifest = chrome.runtime.getManifest();
    return !manifest.update_url;
  } catch {
    return false;
  }
}

export function normalizeAppBackendUrl(value = '') {
  return String(value || DEFAULT_APP_BACKEND_URL).trim().replace(/\/+$/, '') || DEFAULT_APP_BACKEND_URL;
}

export function getDefaultAppBackendUrls() {
  if (isUnpackedExtensionRuntime()) {
    return [LOCAL_APP_BACKEND_LOOPBACK_URL, LOCAL_APP_BACKEND_URL, DEFAULT_APP_BACKEND_URL];
  }
  return [DEFAULT_APP_BACKEND_URL];
}

export function buildAppBackendUrl(path, baseUrl = DEFAULT_APP_BACKEND_URL) {
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${normalizeAppBackendUrl(baseUrl)}${cleanPath}`;
}
