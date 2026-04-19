const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '..');
let context;
let extensionId;
let sidepanelPage;

async function getSettingsFromStorage(page) {
  return page.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.get('opencometSettings', (data) => resolve(data.opencometSettings || null));
  }));
}

async function setSettingsInStorage(page, partial) {
  await page.evaluate((incoming) => new Promise((resolve) => {
    chrome.storage.local.get('opencometSettings', (data) => {
      const current = data.opencometSettings || {};
      chrome.storage.local.set({ opencometSettings: { ...current, ...incoming } }, () => resolve());
    });
  }), partial);
}

test.beforeAll(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencometai-pw-'));

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  }

  extensionId = serviceWorker.url().split('/')[2];
  sidepanelPage = await context.newPage();
  await sidepanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
});

test.afterAll(async () => {
  await context?.close();
});

test('extension loads and sidepanel is reachable', async () => {
  await expect(sidepanelPage.locator('#view-agent')).toBeVisible();
  await expect(sidepanelPage.locator('.app-name')).toHaveText('Open Comet');

  const bottomNavDisplay = await sidepanelPage.locator('#bottomNav').evaluate((el) => getComputedStyle(el).display);
  expect(bottomNavDisplay).toBe('flex');
});

test('settings save persists to chrome.storage.local', async () => {
  await sidepanelPage.locator('#navSettings').click();
  await sidepanelPage.locator('[data-settings-target="ai"]').click();

  const apiKeyInput = sidepanelPage.locator('#apiKeyInput');
  await apiKeyInput.fill('ci-test-key');
  await sidepanelPage.locator('#saveSettingsBtn').click();

  await expect(sidepanelPage.locator('#saveSettingsBtn')).toContainText('Saved');

  const saved = await getSettingsFromStorage(sidepanelPage);
  expect(saved).toBeTruthy();
  expect(saved.provider).toBe('openai');
  expect(saved.apiKey).toBe('ci-test-key');
});

test('agent run redirects to settings when provider is not configured', async () => {
  await setSettingsInStorage(sidepanelPage, { provider: 'openai', apiKey: '' });

  await sidepanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
  await sidepanelPage.locator('#navAgent').click();
  await sidepanelPage.locator('#taskInput').fill('Open example.com');
  await sidepanelPage.locator('#sendBtn').click();

  await expect(sidepanelPage.locator('#view-settings.active')).toBeVisible();

  const focusedId = await sidepanelPage.evaluate(() => document.activeElement?.id || '');
  expect(focusedId).toBe('apiKeyInput');
});

test('local-access page shows no account/license requirement', async () => {
  await sidepanelPage.locator('#navSettings').click();
  await sidepanelPage.locator('[data-settings-target="license"]').click();

  await expect(sidepanelPage.locator('#licenseStatusBadge')).toHaveText('LOCAL');
  await expect(sidepanelPage.locator('#licenseStatusText')).toContainText('No account or license is required');
  await expect(sidepanelPage.locator('text=Local-first mode is active')).toBeVisible();
});
