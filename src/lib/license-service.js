import {
  DEFAULT_APP_BACKEND_URL,
  buildAppBackendUrl,
  getDefaultAppBackendUrls,
  normalizeAppBackendUrl,
} from './app-backend.js';

function normalizeUrl(value) {
  return normalizeAppBackendUrl(value || DEFAULT_APP_BACKEND_URL);
}

function attachQuery(url, query) {
  if (!query) return url;
  const built = new URL(url);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      built.searchParams.set(key, String(value));
    }
  });
  return built.toString();
}

async function licenseFetch(path, { method = 'POST', body, query, baseUrl } = {}) {
  const headers = {};
  const payload = body && method !== 'GET' ? JSON.stringify(body) : undefined;
  if (payload) headers['Content-Type'] = 'application/json';

  const baseUrls = baseUrl
    ? [normalizeUrl(baseUrl)]
    : getDefaultAppBackendUrls().map(normalizeUrl);

  let lastError = null;
  const attempts = [];

  for (const candidateBaseUrl of baseUrls) {
    const url = attachQuery(buildAppBackendUrl(path, candidateBaseUrl), query);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: payload,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        return { ok: true, data, status: response.status };
      }

      lastError = {
        ok: false,
        error: data?.error || data?.message || `License server replied ${response.status} (${url})`,
        status: response.status,
      };

      // If the server provided extra context (like the 404 method/path we added), append it
      if (data?.path && data?.method) {
        lastError.error = `${lastError.error}: ${data.method} ${data.path}`;
      }

      attempts.push(`${response.status} ${url}`);

      if (response.status !== 404 && response.status < 500) {
        lastError.error = `${lastError.error} | Attempts: ${attempts.join(' -> ')}`;
        return lastError;
      }
    } catch (err) {
      lastError = {
        ok: false,
        error: `${err?.message || 'Network error while contacting license server.'} (${url})`,
      };
      attempts.push(`ERR ${url}`);
    }
  }

  if (lastError && attempts.length) {
    lastError.error = `${lastError.error} | Attempts: ${attempts.join(' -> ')}`;
  }
  return lastError || { ok: false, error: 'Unable to reach the license server.' };
}

export async function requestTrialLicense(email, options = {}) {
  if (!email) {
    return { ok: false, error: 'Email is required to request a trial license.' };
  }
  return licenseFetch('/api/licenses/trial', { method: 'POST', body: { email }, ...options });
}

export async function requestPremiumLicense(email, options = {}) {
  if (!email) {
    return { ok: false, error: 'Email is required to request a premium license.' };
  }
  return licenseFetch('/api/licenses/premium', { method: 'POST', body: { email }, ...options });
}

export async function requestDailyChallenge(email, options = {}) {
  if (!email) {
    return { ok: false, error: 'Email is required to request the daily challenge.' };
  }
  return licenseFetch('/api/licenses/daily/challenge', { method: 'GET', query: { email }, ...options });
}

export async function claimDailyLicense(payload, options = {}) {
  if (!payload || !payload.email || !payload.challenge || !payload.signature) {
    return { ok: false, error: 'Email, challenge, and signature are required to claim a daily license.' };
  }
  return licenseFetch('/api/licenses/daily', { method: 'POST', body: payload, ...options });
}

export async function validateLicenseKey(key, options = {}) {
  if (!key) {
    return { ok: false, error: 'License key is required for validation.' };
  }
  const result = await licenseFetch('/api/licenses/validate', { method: 'POST', body: { key }, ...options });
  if (!result.ok) return result;
  return { ok: true, ...result.data };
}

export { DEFAULT_APP_BACKEND_URL as DEFAULT_LICENSE_SERVER_URL };
