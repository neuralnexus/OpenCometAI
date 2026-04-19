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
  await expect(sidepanelPage.locator('#settingsTitle')).toHaveText('Settings');
  await expect(sidepanelPage.locator('[data-settings-target="ai"]')).toBeVisible();
});

test('local-access page shows no account/license requirement', async () => {
  await sidepanelPage.locator('#navSettings').click();
  await sidepanelPage.locator('[data-settings-target="license"]').click();

  await expect(sidepanelPage.locator('#licenseStatusBadge')).toHaveText('LOCAL');
  await expect(sidepanelPage.locator('#licenseStatusText')).toContainText('No account or license is required');
  await expect(sidepanelPage.locator('text=Local-first mode is active')).toBeVisible();
});

test('utility helpers normalize hostnames and parse fenced JSON payloads', async () => {
  const result = await sidepanelPage.evaluate(async () => {
    const utils = await import(chrome.runtime.getURL('src/lib/utils.js'));
    return {
      host: utils.getHostFromUrl('https://WWW.Example.com/path?q=1'),
      badHost: utils.getHostFromUrl('not-a-url'),
      emptyHost: utils.getHostFromUrl(''),
      normalizedHost: utils.normalizeHost('WWW.EXAMPLE.com/docs'),
      escaped: utils.escapeAttr('a"b\\c'),
      stripped: utils.stripStepPrefix('✅ Completed step'),
      parsed: utils.parseJSON('```json\n{"ok":true,"n":3}\n```'),
    };
  });

  expect(result.host).toBe('example.com');
  expect(result.badHost).toBe('');
  expect(result.emptyHost).toBe('');
  expect(result.normalizedHost).toBe('example.com');
  expect(result.escaped).toBe('a\\"b\\\\c');
  expect(result.stripped).toBe('Completed step');
  expect(result.parsed).toEqual({ ok: true, n: 3 });
});

test('skill matcher auto-detects relevant skills and skips already active ones', async () => {
  const selectedIds = await sidepanelPage.evaluate(async () => {
    const { detectSkillsForTask } = await import(chrome.runtime.getURL('src/lib/skill-matcher.js'));

    const allSkills = [
      {
        id: 'builtin_research_deep',
        name: 'Deep research',
        description: 'Investigate and compare information',
        builtIn: true,
        allowedHosts: ['wikipedia.org'],
      },
      {
        id: 'builtin_price_check',
        name: 'Price checker',
        description: 'Find deals and compare prices',
        builtIn: true,
        allowedHosts: ['amazon.com'],
      },
      {
        id: 'custom_form_helper',
        name: 'Form helper',
        description: 'Fill forms quickly',
        builtIn: false,
        allowedHosts: [],
      },
    ];

    const selected = detectSkillsForTask(
      'Research and compare OpenAI versus Anthropic pricing',
      'https://www.wikipedia.org/wiki/Artificial_intelligence',
      allSkills,
      ['builtin_price_check']
    );

    return selected.map(skill => skill.id);
  });

  expect(selectedIds).toContain('builtin_research_deep');
  expect(selectedIds).not.toContain('builtin_price_check');
});

test('source code contains no telemetry SDK domains', async () => {
  const disallowedMatches = await sidepanelPage.evaluate(async () => {
    const root = await new Promise((resolve, reject) => {
      chrome.runtime.getPackageDirectoryEntry((entry) => {
        if (!entry) {
          reject(new Error('Failed to access extension package directory.'));
          return;
        }
        resolve(entry);
      });
    });
    const blocked = [
      'sentry.io',
      'segment.io',
      'posthog',
      'mixpanel',
      'amplitude.com',
      'plausible.io',
      'google-analytics.com',
      'googletagmanager.com',
      'telemetry',
    ];
    const allowedTelemetryPhrase = 'Usage is tracked locally on this device';
    const matches = [];

    async function readFile(entry) {
      return new Promise((resolve, reject) => {
        entry.file((file) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        }, reject);
      });
    }

    async function walk(dirEntry, prefix = '') {
      const reader = dirEntry.createReader();
      const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      for (const entry of entries) {
        const relPath = `${prefix}${entry.name}`;
        if (entry.isDirectory) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          await walk(entry, `${relPath}/`);
          continue;
        }
        if (!entry.isFile || !relPath.endsWith('.js')) continue;
        const text = (await readFile(entry)).toLowerCase();
        for (const token of blocked) {
          if (!text.includes(token)) continue;
          if (token === 'telemetry' && text.includes(allowedTelemetryPhrase.toLowerCase())) continue;
          matches.push({ file: relPath, token });
        }
      }
    }

    const srcDir = await new Promise((resolve, reject) => {
      root.getDirectory('src', {}, resolve, () => reject(new Error('Unable to access src directory in extension package.')));
    });
    await walk(srcDir, 'src/');
    return matches;
  });

  expect(disallowedMatches).toEqual([]);
});
