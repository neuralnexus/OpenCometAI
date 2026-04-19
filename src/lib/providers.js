// ─────────────────────────────────────────────────────────────────────────────
// src/lib/providers.js
// One function per AI provider. All return parsed JSON objects.
// ─────────────────────────────────────────────────────────────────────────────

import { parseJSON } from './utils.js';
import { SYSTEM_PROMPT } from './prompts.js';

// ── Capability registry ────────────────────────────────────────────────────────
export function getProviderCapabilities(settings = {}) {
  const provider = String(settings.provider || 'openai').toLowerCase();
  const model    = String(settings.model    || '').trim();
  const ollamaTextModel = resolveOllamaTextModel(settings);
  const ollamaVisionModel = resolveOllamaVisionModel(settings);
  const customVision = Boolean(settings.providerSupportsVision);

  const registry = {
    openai:    { vision: true,  json: true, attachments: true,  browserAgentSafe: true,  defaultModel: 'gpt-5.4' },
    anthropic: { vision: true,  json: true, attachments: true,  browserAgentSafe: true,  defaultModel: 'claude-opus-4-7' },
    gemini:    { vision: true,  json: true, attachments: true,  browserAgentSafe: true,  defaultModel: 'gemini-3.1-flash-lite-preview' },
    groq:      { vision: false, json: true, attachments: false, browserAgentSafe: false, defaultModel: 'llama-3.3-70b-versatile' },
    mistral:   {
      vision:           supportsMistralVision(model || 'devstral-2512'),
      json:             true,
      attachments:      true,
      browserAgentSafe: supportsMistralVision(model || 'devstral-2512'),
      defaultModel:     'devstral-2512',
    },
    ollama: {
      vision:           supportsOllamaVision(ollamaVisionModel || 'llava:7b'),
      json:             true,
      attachments:      true,
      browserAgentSafe: supportsOllamaVision(ollamaVisionModel || ollamaTextModel || 'llama3.2:3b'),
      defaultModel:     ollamaTextModel || 'llama3.2:3b',
    },
    deepseek: {
      vision:           false,
      json:             true,
      attachments:      false,
      browserAgentSafe: false,
      defaultModel:     'deepseek-chat',
    },
    kimi: {
      vision:           supportsModelVision(model || 'kimi-k2.5'),
      json:             true,
      attachments:      supportsModelVision(model || 'kimi-k2.5'),
      browserAgentSafe: supportsModelVision(model || 'kimi-k2.5'),
      defaultModel:     'kimi-k2.5',
    },
    glm: {
      vision:           supportsModelVision(model || 'glm-4.7'),
      json:             true,
      attachments:      supportsModelVision(model || 'glm-4.7'),
      browserAgentSafe: supportsModelVision(model || 'glm-4.7'),
      defaultModel:     'glm-4.7',
    },
    custom: {
      vision:           customVision || supportsModelVision(model || ''),
      json:             true,
      attachments:      customVision || supportsModelVision(model || ''),
      browserAgentSafe: customVision || supportsModelVision(model || ''),
      defaultModel:     model || '',
    },
  };

  return registry[provider] ?? { vision: false, json: false, attachments: false, browserAgentSafe: false, defaultModel: '' };
}

export function isProviderConfigured(settings = {}) {
  const provider = String(settings.provider || 'openai').toLowerCase();
  const apiKey = resolveProviderApiKey(settings);
  if (provider === 'ollama') {
    return Boolean(resolveOllamaBaseUrl(settings));
  }
  if (['deepseek', 'kimi', 'glm', 'custom'].includes(provider)) {
    return Boolean(String(resolveCompatibleBaseUrl(settings)).trim()) && Boolean(String(apiKey || '').trim());
  }
  return Boolean(String(apiKey || '').trim());
}

// ── Unified entry point ────────────────────────────────────────────────────────
export async function callAI(settings, prompt, screenshotBase64 = null, options = {}) {
  const { provider, model } = settings;
  const apiKey = resolveProviderApiKey(settings);
  const caps   = getProviderCapabilities(settings);
  const hasImageIntent = Boolean(screenshotBase64) || Boolean((options.images || []).length);
  const targetModel = provider === 'ollama'
    ? resolveOllamaModel(settings, hasImageIntent)
    : (model || caps.defaultModel);
  const images = caps.vision
    ? await buildImageInputs(screenshotBase64, options.images || [], { provider, model: targetModel || caps.defaultModel })
    : [];

  switch (provider) {
    case 'anthropic': return callAnthropic(apiKey, targetModel || caps.defaultModel, prompt, images, options);
    case 'openai':    return callOpenAI   (apiKey, targetModel || caps.defaultModel, prompt, images, options);
    case 'gemini':    return callGemini   (apiKey, targetModel || caps.defaultModel, prompt, images, options);
    case 'groq':      return callGroq     (apiKey, targetModel || caps.defaultModel, prompt, options);
    case 'mistral':   return callMistral  (apiKey, targetModel || caps.defaultModel, prompt, selectMistralImages(images), options);
    case 'deepseek':
    case 'kimi':
    case 'glm':
    case 'custom':    return callOpenAICompatible(settings, targetModel || caps.defaultModel, prompt, images, options);
    case 'ollama':    return callOllama   (settings, targetModel || caps.defaultModel, prompt, images, options);
    default:          throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Raw text variant — returns the AI's response as a plain string instead of
 * parsed JSON. Used for prose responses (e.g. research report synthesis).
 */
export async function callAIRaw(settings, prompt, options = {}) {
  const { provider, model } = settings;
  const apiKey = resolveProviderApiKey(settings);
  const caps = getProviderCapabilities(settings);
  const m    = provider === 'ollama'
    ? resolveOllamaTextModel(settings)
    : (model || caps.defaultModel);

  switch (provider) {
    case 'openai':
    case 'groq': {
      const url = provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      await assertOk(res, provider);
      const data = await res.json();
      if (options.onUsage && data.usage) {
        options.onUsage({
          model: m,
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
      }
      return data.choices?.[0]?.message?.content || '';
    }
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4000,
        }),
      });
      await assertOk(res, 'Anthropic');
      const data = await res.json();
      if (options.onUsage && data.usage) {
        options.onUsage({
          model: m,
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        });
      }
      return data.content?.[0]?.text || '';
    }
    case 'gemini': {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
          }),
        }
      );
      await assertOk(res, 'Gemini');
      const data = await res.json();
      if (options.onUsage && data.usageMetadata) {
        options.onUsage({
          model: m,
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        });
      }
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    case 'mistral': {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      await assertOk(res, 'Mistral');
      const data = await res.json();
      if (options.onUsage && data.usage) {
        options.onUsage({
          model: m,
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
      }
      return data.choices?.[0]?.message?.content || '';
    }
    case 'deepseek':
    case 'kimi':
    case 'glm':
    case 'custom': {
      const res = await fetch(resolveCompatibleBaseUrl(settings) + '/chat/completions', {
        method: 'POST',
        headers: buildCompatibleHeaders(settings),
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      await assertOk(res, providerLabel(provider));
      const data = await res.json();
      if (options.onUsage && data.usage) {
        options.onUsage({
          model: m,
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
      }
      return data.choices?.[0]?.message?.content || '';
    }
    case 'ollama': {
      const res = await fetch(resolveOllamaBaseUrl(settings) + '/v1/chat/completions', {
        method: 'POST',
        headers: buildOllamaHeaders(settings),
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      await assertOk(res, 'Ollama');
      const data = await res.json();
      if (options.onUsage && data.prompt_eval_count) {
        options.onUsage({
          model: m,
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: data.prompt_eval_count + (data.eval_count || 0),
        });
      }
      return data.choices?.[0]?.message?.content || '';
    }
    default:
      throw new Error('Unknown provider: ' + provider);
  }
}


// ── Anthropic ──────────────────────────────────────────────────────────────────
async function callAnthropic(apiKey, model, prompt, images, options = {}) {
  const content = [
    ...images.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: normalizeMime(img.mimeType), data: sanitizeB64(img.imageBase64) },
    })),
    { type: 'text', text: prompt },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      system:    SYSTEM_PROMPT,
      messages:  [{ role: 'user', content }],
      max_tokens: 2500,
    }),
  });
  await assertOk(res, 'Anthropic');
  const data = await res.json();
  if (options.onUsage && data.usage) {
    options.onUsage({
      model,
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    });
  }
  return parseJSON(data.content?.[0]?.text);
}

// ── OpenAI ─────────────────────────────────────────────────────────────────────
async function callOpenAI(apiKey, model, prompt, images, options = {}) {
  const userContent = [
    ...images.map(img => ({
      type: 'image_url',
      image_url: { url: `data:${normalizeMime(img.mimeType)};base64,${sanitizeB64(img.imageBase64)}`, detail: 'high' },
    })),
    { type: 'text', text: prompt },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      temperature:     0.1,
      max_tokens:      2500,
      response_format: { type: 'json_object' },
    }),
  });
  await assertOk(res, 'OpenAI');
  const data = await res.json();
  if (options.onUsage && data.usage) {
    options.onUsage({
      model,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    });
  }
  return parseJSON(data.choices?.[0]?.message?.content);
}

// ── Gemini ─────────────────────────────────────────────────────────────────────
async function callGemini(apiKey, model, prompt, images, options = {}) {
  const parts = [
    ...images.map(img => ({
      inlineData: { mimeType: normalizeMime(img.mimeType), data: sanitizeB64(img.imageBase64) },
    })),
    { text: prompt },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents:          [{ role: 'user', parts }],
        generationConfig:  { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 2500 },
      }),
    }
  );
  await assertOk(res, 'Gemini');
  const data = await res.json();
  if (options.onUsage && data.usageMetadata) {
    options.onUsage({
      model,
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount,
    });
  }
  return parseJSON(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

// ── Groq ───────────────────────────────────────────────────────────────────────
async function callGroq(apiKey, model, prompt, options = {}) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
      temperature:     0.1,
      max_tokens:      2500,
      response_format: { type: 'json_object' },
    }),
  });
  await assertOk(res, 'Groq');
  const data = await res.json();
  if (options.onUsage && data.usage) {
    options.onUsage({
      model,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    });
  }
  return parseJSON(data.choices?.[0]?.message?.content);
}

// ── Mistral ────────────────────────────────────────────────────────────────────
async function callMistral(apiKey, model, prompt, images, options = {}) {
  // Attempt with images first; fall back to text-only if the provider rejects images
  const attempts = dedupeMistralAttempts([
    { label: 'vision', images: supportsMistralVision(model) ? images : [] },
    { label: 'text',   images: [] },
  ]);

  let lastError;
  for (const attempt of attempts) {
    try {
      const content = buildMistralContent(prompt, attempt.images);
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content },
          ],
          temperature:     0.1,
          max_tokens:      2500,
          response_format: { type: 'json_object' },
        }),
      });
      await assertOk(res, 'Mistral');
      const data = await res.json();
      if (options.onUsage && data.usage) {
        options.onUsage({
          model,
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
      }
      return parseJSON(data.choices?.[0]?.message?.content);
    } catch (err) {
      lastError = err;
      // If the error looks related to vision/images and we have other attempts remaining, continue.
      if (attempt.label === 'vision' && isRecoverableMistralImageError(err)) {
        console.warn(`[Open Comet] Mistral vision attempt failed, falling back to ${attempts[attempts.indexOf(attempt) + 1]?.label || 'next'}:`, err.message);
        continue;
      }
      break; 
    }
  }
  throw lastError || new Error('Mistral request failed completely');
}

async function callOllama(settings, model, prompt, images, options = {}) {
  const jsonHint = `${prompt}\n\nReturn only a valid JSON object.`;
  const attempts = dedupeOllamaAttempts([
    {
      label: 'json-mode',
      body: {
        model,
        messages: buildOllamaMessages(prompt, images),
        temperature: 0.1,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
      },
    },
    {
      label: 'prompt-json',
      body: {
        model,
        messages: buildOllamaMessages(jsonHint, images),
        temperature: 0.1,
        max_tokens: 2500,
      },
    },
    (images || []).length ? {
      label: 'text-only-json',
      body: {
        model,
        messages: buildOllamaMessages(jsonHint, []),
        temperature: 0.1,
        max_tokens: 2500,
      },
    } : null,
  ]);

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetch(resolveOllamaBaseUrl(settings) + '/v1/chat/completions', {
        method: 'POST',
        headers: buildOllamaHeaders(settings),
        body: JSON.stringify(attempt.body),
      });
      await assertOk(res, 'Ollama');
      const data = await res.json();
      if (options.onUsage && data.prompt_eval_count) {
        options.onUsage({
          model,
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: data.prompt_eval_count + (data.eval_count || 0),
        });
      }
      return parseJSON(data.choices?.[0]?.message?.content);
    } catch (err) {
      lastError = err;
      if (isRecoverableOllamaCompatError(err)) continue;
      break;
    }
  }

  throw lastError ?? new Error('Ollama request failed');
}

async function callOpenAICompatible(settings, model, prompt, images, options = {}) {
  const res = await fetch(resolveCompatibleBaseUrl(settings) + '/chat/completions', {
    method: 'POST',
    headers: buildCompatibleHeaders(settings),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: images?.length
            ? [
                ...images.map(img => ({
                  type: 'image_url',
                  image_url: { url: `data:${normalizeMime(img.mimeType)};base64,${sanitizeB64(img.imageBase64)}` },
                })),
                { type: 'text', text: prompt },
              ]
            : prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    }),
  });
  await assertOk(res, providerLabel(settings.provider));
  const data = await res.json();
  if (options.onUsage && data.usage) {
    options.onUsage({
      model,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    });
  }
  return parseJSON(data.choices?.[0]?.message?.content);
}

// ── Image helpers ──────────────────────────────────────────────────────────────
async function buildImageInputs(screenshotBase64, extraImages = [], options = {}) {
  const list = [];
  if (screenshotBase64) {
    list.push({ mimeType: 'image/jpeg', imageBase64: sanitizeB64(screenshotBase64), name: 'browser-screenshot' });
  }
  for (const img of (extraImages || []).slice(0, 3)) {
    if (img?.imageBase64) {
      list.push({ mimeType: normalizeMime(img.mimeType), imageBase64: sanitizeB64(img.imageBase64), name: img.name || 'attachment' });
    }
  }
  const filtered = list.filter(img => img.imageBase64);
  if (String(options.provider || '').toLowerCase() !== 'mistral') return filtered;
  return await optimizeMistralImages(filtered);
}

function selectMistralImages(images) {
  const list = (images || []).filter(img => img?.imageBase64);
  if (!list.length) return [];
  const selected = list.find(img => img.name === 'browser-screenshot') ?? list[0];
  if (!selected?.imageBase64 || selected.imageBase64.length > MAX_MISTRAL_IMAGE_B64) return [];
  return [selected];
}

function buildMistralContent(prompt, images) {
  if (!(images || []).length) return prompt;
  return [
    ...(images || []).map(img => ({
      type: 'image_url',
      image_url: `data:${normalizeMime(img.mimeType)};base64,${sanitizeB64(img.imageBase64)}`,
    })),
    { type: 'text', text: prompt },
  ];
}

function dedupeMistralAttempts(attempts) {
  const seen = new Set();
  return attempts.filter(attempt => {
    const sig = JSON.stringify((attempt.images || []).map(img => `${img.name}:${img.imageBase64?.slice(0, 32) || ''}`));
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

function buildOllamaMessages(prompt, images = []) {
  const validImages = (images || []).filter(img => img?.imageBase64);
  const userContent = validImages.length
    ? [
        ...validImages.map(img => ({
          type: 'image_url',
          image_url: { url: `data:${normalizeMime(img.mimeType)};base64,${sanitizeB64(img.imageBase64)}` },
        })),
        { type: 'text', text: prompt },
      ]
    : prompt;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

function dedupeOllamaAttempts(attempts) {
  const seen = new Set();
  return (attempts || []).filter(Boolean).filter(attempt => {
    const sig = JSON.stringify(attempt.body);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ── Misc helpers ───────────────────────────────────────────────────────────────
function supportsMistralVision(model) {
  const lower = String(model || '').toLowerCase();
  return ['mistral-large', 'mistral-medium', 'mistral-small', 'ministral', 'pixtral', 'vision', 'mistral-vibe', 'devstral']
    .some(kw => lower.includes(kw));
}

function supportsOllamaVision(model) {
  const lower = String(model || '').toLowerCase();
  return ['llava', 'bakllava', 'vision', 'qwen2.5vl', 'qwen2-vl', 'gemma3', 'minicpm-v', 'moondream']
    .some(kw => lower.includes(kw));
}

function supportsModelVision(model) {
  const lower = String(model || '').toLowerCase();
  return ['vision', 'vl', '4o', 'omni', 'gemini', 'pixtral', 'llava', 'qwen2.5vl', 'qwen2-vl', 'gemma3', 'glm-4.5v', 'glm-4.1v', 'moonshot-v']
    .some(kw => lower.includes(kw));
}

function resolveOllamaTextModel(settings = {}) {
  return String(settings.ollamaTextModel || settings.model || 'llama3.2:3b').trim();
}

function resolveOllamaVisionModel(settings = {}) {
  return String(settings.ollamaVisionModel || settings.model || '').trim();
}

function resolveOllamaModel(settings = {}, wantsVision = false) {
  const visionModel = resolveOllamaVisionModel(settings);
  const textModel = resolveOllamaTextModel(settings);
  if (wantsVision) return visionModel || textModel;
  return textModel || visionModel;
}

function resolveOllamaBaseUrl(settings = {}) {
  return String(settings.ollamaBaseUrl || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
}

function buildOllamaHeaders(settings = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = resolveProviderApiKey(settings);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function resolveCompatibleBaseUrl(settings = {}) {
  const provider = String(settings.provider || '').toLowerCase();
  let custom = String(settings.providerBaseUrl || '').trim().replace(/\/+$/, '');

  if (custom) {
    // Handle cases where the user pasted a full endpoint
    custom = custom.replace(/\/+(chat\/)?completions$/, '');
    
    // If it doesn't end in /v1 or /v4 and it's just a base domain/port, 
    // it's usually safer to append /v1 for "compatible" mode, 
    // as most local or specialty providers expect it.
    if (!custom.toLowerCase().endsWith('/v1') && 
        !custom.toLowerCase().endsWith('/v4') && 
        !custom.toLowerCase().includes('/api/')) {
      custom = `${custom}/v1`;
    }
    return custom;
  }

  switch (provider) {
    case 'deepseek': return 'https://api.deepseek.com/v1';
    case 'kimi':     return 'https://api.moonshot.ai/v1';
    case 'glm':      return 'https://open.bigmodel.cn/api/paas/v4';
    default:         return '';
  }
}

function buildCompatibleHeaders(settings = {}) {
  const apiKey = resolveProviderApiKey(settings);
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  return headers;
}

function resolveProviderApiKey(settings = {}) {
  const provider = String(settings.provider || '').toLowerCase();
  const map = settings.providerApiKeys;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const scoped = String(map[provider] || '').trim();
    if (scoped) return scoped;
  }
  return String(settings.apiKey || '').trim();
}

function providerLabel(provider) {
  const key = String(provider || '').toLowerCase();
  return ({
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    glm: 'GLM',
    custom: 'OpenAI Compatible',
    ollama: 'Ollama',
    mistral: 'Mistral',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    groq: 'Groq',
  })[key] || String(provider || 'Provider');
}

function isRecoverableMistralImageError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('unable to download all specified images') || 
         msg.includes('prompt contains') ||
         msg.includes('context length') ||
         msg.includes('image') || 
         msg.includes('400'); // Often vision-rejections are 400s
}

function isRecoverableOllamaCompatError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('response_format') ||
         msg.includes('json_object') ||
         msg.includes('image_url') ||
         msg.includes('content') ||
         msg.includes('vision') ||
         msg.includes('multimodal') ||
         msg.includes('unsupported') ||
         msg.includes('invalid format') ||
         msg.includes('400');
}

const MAX_MISTRAL_IMAGE_B64 = 32000;

async function optimizeMistralImages(images) {
  const out = [];
  for (const image of (images || [])) {
    const optimized = await optimizeMistralImage(image);
    if (optimized?.imageBase64) out.push(optimized);
  }
  return out;
}

async function optimizeMistralImage(image) {
  if (!image?.imageBase64) return image;
  const clean = sanitizeB64(image.imageBase64);
  if (clean.length <= MAX_MISTRAL_IMAGE_B64) {
    return { ...image, imageBase64: clean };
  }

  if (!globalThis.fetch || !globalThis.createImageBitmap || !globalThis.OffscreenCanvas) {
    return { ...image, imageBase64: clean };
  }

  try {
    const inputUrl  = `data:${normalizeMime(image.mimeType)};base64,${clean}`;
    const inputBlob = await fetch(inputUrl).then(res => res.blob());
    const bitmap    = await createImageBitmap(inputBlob);

    const dimensionSteps = [768, 640, 512, 448, 384, 320];
    const qualitySteps   = [0.4, 0.3, 0.22, 0.16];
    let bestBase64 = clean;

    for (const maxDim of dimensionSteps) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width || 1, bitmap.height || 1));
      const width = Math.max(1, Math.round((bitmap.width || 1) * scale));
      const height = Math.max(1, Math.round((bitmap.height || 1) * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) continue;

      ctx.drawImage(bitmap, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        const base64 = await blobToBase64(blob);
        if (base64.length < bestBase64.length) bestBase64 = base64;
        if (base64.length <= MAX_MISTRAL_IMAGE_B64) {
          bitmap.close?.();
          return { ...image, mimeType: 'image/jpeg', imageBase64: base64 };
        }
      }
    }

    bitmap.close?.();
    return { ...image, mimeType: 'image/jpeg', imageBase64: bestBase64 };
  } catch {
    return { ...image, imageBase64: clean };
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeMime(mimeType) {
  const v = String(mimeType || '').toLowerCase();
  if (v.includes('png'))  return 'image/png';
  if (v.includes('webp')) return 'image/webp';
  if (v.includes('gif'))  return 'image/gif';
  if (v.includes('jpg') || v.includes('jpeg')) return 'image/jpeg';
  return 'image/jpeg';
}

function sanitizeB64(value) {
  let s = String(value || '').replace(/\s+/g, '');
  // Strip any existing data URL prefix to prevent nesting (e.g. data:data:...)
  if (s.startsWith('data:image')) {
    const commaIndex = s.indexOf(',');
    if (commaIndex !== -1) s = s.substring(commaIndex + 1);
  }
  return s;
}

async function assertOk(res, label) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${body.substring(0, 300)}`);
  }
}
