// ─────────────────────────────────────────────────────────────────────────────
// src/background/actions.js
// DOM action executors — each action type runs inside the target tab.
// Imported and called by the agent loop in sw.js.
// ─────────────────────────────────────────────────────────────────────────────

import { sleep } from '../lib/utils.js';

/**
 * Execute a single agent action in the given tab.
 * Returns a metadata object { ok, …outcome fields }.
 */
export async function executeAction(tabId, action, agentState) {
  switch (action.type) {

    // ── Navigate ───────────────────────────────────────────────────────────
    case 'navigate': {
      const tab = await chrome.tabs.update(tabId, { url: action.url });
      await sleep(800);
      return { ok: true, url: tab.url, tabId: tab.id };
    }

    // ── Click ──────────────────────────────────────────────────────────────
    case 'click': {
      const clickContext = {
        ...(getInteractiveContext(action, agentState) || {}),
        x: Number.isFinite(Number(action.x)) ? Number(action.x) : null,
        y: Number.isFinite(Number(action.y)) ? Number(action.y) : null,
      };
      const result = await inject(tabId, domClick, action.selector || action.text || '', clickContext);
      if (!result?.ok) throw new Error(result?.reason || `Click failed: ${action.selector}`);
      return result;
    }

    // ── Type / Fill ────────────────────────────────────────────────────────
    case 'type':
    case 'fill': {
      const fieldContext = getInteractiveContext(action, agentState);
      const result = await inject(tabId, domType, action.selector, action.text ?? action.value ?? '', fieldContext);
      if (!result?.ok) throw new Error(result?.reason || `Type failed: ${action.selector}`);
      return result;
    }

    // ── Key press ──────────────────────────────────────────────────────────
    case 'press_key':
    case 'key': {
      await inject(tabId, domKey, action.key || 'Return');
      return { ok: true, key: action.key };
    }

    // ── Submit form ────────────────────────────────────────────────────────
    case 'submit': {
      const result = await inject(tabId, domSubmit, action.selector || '');
      if (!result?.ok) throw new Error(result?.reason || 'Submit failed');
      return result;
    }

    // ── Scroll ─────────────────────────────────────────────────────────────
    case 'scroll': {
      const result = await inject(tabId, domScroll, action.direction || 'down', action.amount || 600);
      if (!result?.ok) throw new Error('Scroll failed');
      if ((action.direction === 'down' || action.direction === 'bottom') && result.atBottom && result.moved < 24) {
        throw new Error(`Scroll hit bottom of ${result.target}`);
      }
      if ((action.direction === 'up' || action.direction === 'top') && result.atTop && result.moved < 24) {
        throw new Error(`Scroll hit top of ${result.target}`);
      }
      return result;
    }

    // ── Scroll to UID ──────────────────────────────────────────────────────
    case 'scroll_to_uid': {
      const uid = String(action.uid || action.selector || '').replace(/^uid:/, '');
      const result = await inject(tabId, domScrollToUid, uid);
      if (!result?.ok) throw new Error(result?.reason || 'scroll_to_uid failed');
      return result;
    }

    // ── Scroll to text ─────────────────────────────────────────────────────
    case 'scroll_to_text': {
      const result = await inject(tabId, domScrollToText, action.text || action.selector || '');
      if (!result?.ok) throw new Error(result?.reason || 'scroll_to_text failed');
      return result;
    }

    // ── Wait ───────────────────────────────────────────────────────────────
    case 'wait':
      await sleep(action.ms || 2000);
      return { ok: true, waitedMs: action.ms || 2000 };

    // ── Extract (passive — next loop reads the result) ─────────────────────
    case 'extract':
      await inject(tabId, (sel) => {
        return [...document.querySelectorAll(sel || 'body')]
          .map(el => el.textContent.trim())
          .join('\n');
      }, action.selector || 'body');
      return { ok: true };

    // ── New tab ────────────────────────────────────────────────────────────
    case 'new_tab': {
      const tab = await chrome.tabs.create({ url: action.url || 'about:blank', active: true });
      agentState.agentTabId = tab.id;
      agentState.taskTabIds = [...new Set([...agentState.taskTabIds, tab.id])];
      await sleep(1000);
      return { ok: true, tabId: tab.id, url: tab.url };
    }

    // ── Switch tab ─────────────────────────────────────────────────────────
    case 'switch_tab': {
      const targetId = resolveTabId(action, agentState);
      if (!targetId) throw new Error('No task tab matched switch_tab target');
      const tab = await chrome.tabs.get(targetId);
      await chrome.tabs.update(targetId, { active: true });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
      agentState.agentTabId = targetId;
      return { ok: true, tabId: targetId, url: tab.url };
    }

    // ── Close tab ──────────────────────────────────────────────────────────
    case 'close_tab': {
      const closeId = resolveTabId(action, agentState) || tabId;
      if (agentState.taskTabIds.length <= 1 && closeId === agentState.agentTabId) {
        throw new Error('Cannot close the only active task tab');
      }
      await chrome.tabs.remove(closeId);
      agentState.taskTabIds = agentState.taskTabIds.filter(id => id !== closeId);
      delete agentState.taskTabGraph[closeId];
      agentState.agentTabId = agentState.taskTabIds.at(-1) ?? agentState.currentTabId;
      return { ok: true, tabId: closeId };
    }

    // ── Search ─────────────────────────────────────────────────────────────
    case 'search': {
      const result = await inject(tabId, domSearch, action.query || '', getSearchContext(agentState));
      if (!result?.ok) throw new Error(result?.reason || 'Search action failed');
      return result;
    }

    default:
      return { ok: true };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function inject(tabId, fn, ...args) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: fn, args });
    return results?.[0]?.result ?? null;
  } catch (e) {
    console.warn('[Open Comet] Injection failed:', e.message);
    return null;
  }
}

function resolveTabId(action, agentState) {
  if (Number.isInteger(action.tabId) && agentState.taskTabIds.includes(action.tabId)) return action.tabId;
  const graph = agentState.taskTabGraph;
  const wantHost  = String(action.host  || '').toLowerCase();
  const wantTitle = String(action.title || '').toLowerCase();
  const wantUrl   = String(action.url   || '').toLowerCase();
  return Object.values(graph).find(tab =>
    (wantHost  && tab.host?.includes(wantHost)) ||
    (wantTitle && tab.title?.toLowerCase().includes(wantTitle)) ||
    (wantUrl   && tab.url?.toLowerCase().includes(wantUrl))
  )?.id ?? null;
}

function getInteractiveContext(action, agentState) {
  const pageInfo = agentState?.lastPageInfo || {};
  const elements = pageInfo.interactiveElements || [];
  const selector = String(action.selector || action.text || action.uid || '');
  const uid = String(action.uid || selector).replace(/^uid:/, '');
  const textSelector = selector.startsWith('text:') ? selector.slice(5) : selector;

  const matched = elements.find(item =>
    item?.uid === uid ||
    item?.selector === selector ||
    (textSelector && item?.text && item.text.toLowerCase() === textSelector.toLowerCase())
  ) || null;

  if (!matched) return null;
  return {
    uid: matched.uid || '',
    text: matched.text || '',
    label: matched.label || '',
    axName: matched.axName || '',
    href: matched.href || '',
    placeholder: matched.placeholder || '',
    domPath: matched.domPath || '',
    ariaLabel: matched.ariaLabel || '',
    bounds: matched.bounds || null,
    editable: Boolean(matched.editable),
  };
}

function getSearchContext(agentState) {
  const pageInfo = agentState?.lastPageInfo || {};
  const elements = pageInfo.interactiveElements || [];
  const searchTerms = ['search', 'find', 'query', 'lookup'];
  const searchCandidates = elements
    .filter(item => item?.editable)
    .filter(item => {
      const haystack = [
        item.text,
        item.label,
        item.axName,
        item.placeholder,
        item.role,
        item.tag,
        item.type,
        item.name,
        item.id,
        item.className,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchTerms.some(term => haystack.includes(term)) || /\b(qs?|search-input|search-field)\b/.test(haystack);
    })
    .slice(0, 6)
    .map(item => ({
      selector: item.selector,
      uid: item.uid,
      text: item.text || '',
      label: item.label || item.axName || '',
      placeholder: item.placeholder || '',
      bounds: item.bounds || null,
    }));

  return { candidates: searchCandidates };
}

// ─── Page functions injected into tabs ──────────────────────────────────────
// These run inside the page context — no closures over outer scope.

function domClick(sel, context = null) {
  const escAttr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const norm    = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = el => norm(
    el?.innerText ||
    el?.textContent ||
    el?.getAttribute?.('aria-label') ||
    el?.getAttribute?.('title') ||
    el?.value
  );
  const clickableAncestor = el =>
    el?.closest?.('a, button, [role=button], [role=option], [role=menuitem], input[type=button], input[type=submit], label, summary') || el;

  const pools = [
    ...document.querySelectorAll('a, button, [role=button], input[type=button], input[type=submit], label, summary'),
    ...document.querySelectorAll('[role=option], [role=menuitem], [role=listitem], [role=row], [role=gridcell], [role=tab], [role=treeitem], li'),
  ];

  const byText = text => {
    const t = norm(text);
    if (!t) return null;
    const exact = pools.find(el => visible(el) && label(el) === t);
    if (exact) return exact;
    const partial = pools.find(el => visible(el) && label(el).includes(t));
    if (partial) return partial;
    return [...document.querySelectorAll('*')].find(el => {
      if (!visible(el)) return false;
      const kids = el.children.length;
      if (kids > 8) return false;
      const textLabel = label(el);
      return textLabel === t || textLabel.includes(t);
    }) || null;
  };

  const byHref = href => {
    const targetHref = String(href || '').trim();
    if (!targetHref) return null;
    return [...document.querySelectorAll('a[href]')].find(el => visible(el) && (el.href === targetHref || el.href.includes(targetHref))) || null;
  };
  const byDomPath = domPath => {
    const path = String(domPath || '').trim();
    if (!path) return null;
    try {
      const el = document.querySelector(path);
      return visible(el) ? el : null;
    } catch {
      return null;
    }
  };

  const byBounds = bounds => {
    if (!bounds) return null;
    const x = Math.max(1, Math.min(window.innerWidth - 1, Math.round(bounds.x + Math.max(4, bounds.w / 2))));
    const y = Math.max(1, Math.min(window.innerHeight - 1, Math.round(bounds.y + Math.max(4, bounds.h / 2))));
    const hit = document.elementFromPoint(x, y);
    return visible(hit) ? hit : null;
  };
  const byCoordinates = (x, y) => {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
    const hit = document.elementFromPoint(Number(x), Number(y));
    return visible(hit) ? hit : null;
  };

  let element = null;
  const uid = String(sel).match(/^uid:(.+)$/);
  if (uid) {
    element = document.querySelector('[data-opencomet-agent-uid="' + escAttr(uid[1]) + '"]');
  } else if (String(sel).startsWith('text:')) {
    element = byText(String(sel).slice(5));
  } else {
    try { element = document.querySelector(sel); } catch {}
    if (!element || !visible(element)) element = byText(sel) || null;
  }

  if ((!element || !visible(element)) && context) {
    if (context.uid) {
      element = document.querySelector('[data-opencomet-agent-uid="' + escAttr(context.uid) + '"]');
    }
    if ((!element || !visible(element)) && context.x != null && context.y != null) element = byCoordinates(context.x, context.y);
    if ((!element || !visible(element)) && context.href) element = byHref(context.href);
    if ((!element || !visible(element)) && context.domPath) element = byDomPath(context.domPath);
    if ((!element || !visible(element)) && context.label) element = byText(context.label);
    if ((!element || !visible(element)) && context.axName) element = byText(context.axName);
    if ((!element || !visible(element)) && context.text) element = byText(context.text);
    if ((!element || !visible(element)) && context.bounds) element = byBounds(context.bounds);
    if ((!element || !visible(element)) && context.placeholder) element = byText(context.placeholder);
  }

  if (!element || !visible(element)) {
    return { ok: false, reason: 'No clickable element matched: ' + sel };
  }

  element.scrollIntoView({ block: 'center', inline: 'center' });
  let target = clickableAncestor(element);
  if (!visible(target) && context?.bounds) {
    const fallback = byBounds(context.bounds);
    target = clickableAncestor(fallback);
  }

  const rect = target.getBoundingClientRect();
  const clientX = rect.left + Math.min(rect.width - 2, Math.max(2, rect.width / 2));
  const clientY = rect.top + Math.min(rect.height - 2, Math.max(2, rect.height / 2));
  ['pointerover', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX, clientY }))
  );
  if (typeof target.click === 'function') target.click();

  return {
    ok: true,
    matchedText: label(target).substring(0, 120),
    href: target.href || target.closest?.('a')?.href || '',
  };
}

// ─── domType: handles <input>, <textarea>, AND contenteditable divs ──────────
//
// KEY FIX: Gmail's compose body is a contenteditable div. Setting .value or
// .textContent on it breaks Gmail's internal React state and the type silently
// fails. The fix is to use document.execCommand('insertText') which routes
// through the browser's native editing pipeline, keeping editor state intact.
//
function domType(sel, val, context = null) {
  const norm    = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const queryDomPath = domPath => {
    const path = String(domPath || '').trim();
    if (!path) return null;
    try {
      const el = document.querySelector(path);
      return el && visible(el) ? el : null;
    } catch {
      return null;
    }
  };

  // ── Is this element something we can type into? ──────────────────────────
  const isEditable = el => {
    if (!el) return false;
    // contenteditable in any form
    if (el.isContentEditable) return true;
    const ce = el.getAttribute ? el.getAttribute('contenteditable') : null;
    if (ce === 'true' || ce === '') return true;
    // textarea
    if (el.tagName === 'TEXTAREA') return true;
    // input (exclude non-typeable types)
    if (el.tagName !== 'INPUT') return false;
    return !['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'range', 'color']
      .includes((el.type || '').toLowerCase());
  };

  // All visible editable elements on the page
  const editables = [
    ...document.querySelectorAll(
      'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable]'
    )
  ].filter(el => isEditable(el) && visible(el));

  // ── Resolve the target element ────────────────────────────────────────────
  let element = null;
  const escAttr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const uidM = String(sel).match(/^uid:(.+)$/);
  if (uidM) {
    // Primary: the element with that UID
    const byUid = document.querySelector('[data-opencomet-agent-uid="' + escAttr(uidM[1]) + '"]');
    if (byUid && isEditable(byUid) && visible(byUid)) {
      element = byUid;
    } else if (byUid) {
      // If the UID element is a container (e.g. a wrapper div), look for an
      // editable child inside it (common in rich-text editors).
      const child = byUid.querySelector(
        'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable]'
      );
      if (child && isEditable(child) && visible(child)) element = child;
    }
  } else if (String(sel).startsWith('text:')) {
    const txt = norm(String(sel).slice(5));
    element = editables.find(el =>
      norm(el.placeholder || el.getAttribute?.('aria-label') || '').includes(txt)
    ) || null;
  } else {
    try { element = document.querySelector(sel); } catch {}
    if (element && (!isEditable(element) || !visible(element))) element = null;
  }

  // Fallback: match by aria-label / placeholder / name / id tokens
  if (!element) {
    const tokens = norm(sel).split(' ').filter(Boolean);
    element = editables.find(el => {
      const hints = [
        el.placeholder,
        el.getAttribute ? el.getAttribute('aria-label') : '',
        el.getAttribute ? el.getAttribute('aria-labelledby') : '',
        el.name, el.id,
      ].map(h => norm(h || '')).join(' ');
      return tokens.every(t => hints.includes(t));
    }) || null;
  }

  if (!element && context?.domPath) {
    const domPathMatch = queryDomPath(context.domPath);
    if (domPathMatch && isEditable(domPathMatch)) {
      element = domPathMatch;
    } else if (domPathMatch) {
      element = domPathMatch.querySelector?.('input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable]') || null;
    }
  }

  if (!element && context) {
    const hintText = [context.label, context.axName, context.placeholder, context.text, context.ariaLabel]
      .map(norm)
      .find(Boolean);
    if (hintText) {
      element = editables.find(el => {
        const hints = [
          el.placeholder,
          el.getAttribute ? el.getAttribute('aria-label') : '',
          el.getAttribute ? el.getAttribute('aria-labelledby') : '',
          el.name,
          el.id,
        ].map(h => norm(h || '')).join(' ');
        return Boolean(hints) && (hints.includes(hintText) || hintText.includes(hints));
      }) || null;
    }
  }

  if (!element) return { ok: false, reason: 'No input matched: ' + sel };

  element.scrollIntoView({ block: 'center' });
  element.focus();

  // ── Branch A: contenteditable (Gmail compose, Outlook, Slack, Notion…) ───
  const isContentEditable =
    element.isContentEditable ||
    element.getAttribute?.('contenteditable') === 'true' ||
    element.getAttribute?.('contenteditable') === '';

  if (isContentEditable) {
    // Check if the element has real text. Use textContent ONLY — not innerHTML,
    // because Gmail's placeholder is literally <br> which has no textContent
    // but non-empty innerHTML, causing false "non-empty" detection that led to
    // all type calls appending instead of replacing.
    const isEmpty = !element.textContent?.trim();

    const winSel = window.getSelection();

    if (winSel) {
      const range = document.createRange();
      if (isEmpty) {
        // Element empty → position caret at start (will insert at position 0)
        range.setStart(element, 0);
        range.collapse(true);
      } else {
        // Element has content → move caret to very end so we APPEND
        range.selectNodeContents(element);
        range.collapse(false); // false = collapse to END
      }
      winSel.removeAllRanges();
      winSel.addRange(range);
    }

    // execCommand('insertText') fires through the browser's native editing
    // pipeline — React, Vue, and Gmail's own editor all see it as real input.
    let typed = false;
    try {
      typed = document.execCommand('insertText', false, val);
    } catch (_) {}

    if (!typed) {
      // Fallback: for empty elements only, clear and inject textNode + InputEvent
      if (isEmpty) element.innerHTML = '';
      element.focus();
      const textNode = document.createTextNode(val);
      if (isEmpty) {
        element.appendChild(textNode);
      } else {
        // Find last text node and append, or add a new node at end
        let last = element.lastChild;
        if (last && last.nodeType === 3) {
          last.textContent += val;
        } else {
          element.appendChild(textNode);
        }
      }
      try {
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true,
          inputType: 'insertText', data: val,
        }));
      } catch (_) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Generic listeners
    element.dispatchEvent(new Event('input',  { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    // Always move caret to end after insert
    try {
      const ws2 = window.getSelection();
      if (ws2) {
        const r2 = document.createRange();
        r2.selectNodeContents(element);
        r2.collapse(false);
        ws2.removeAllRanges();
        ws2.addRange(r2);
      }
    } catch (_) {}

    return { ok: true, method: 'contenteditable', appended: !isEmpty };
  }

  // ── Branch B: standard <input> / <textarea> ───────────────────────────────
  const proto  = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, val);
  else if ('value' in element) element.value = val;
  else element.textContent = val;

  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, method: 'input' };
}

function domKey(key) {
  const el = document.activeElement || document.body;
  const map = { Return: 'Enter', return: 'Enter', enter: 'Enter', tab: 'Tab', escape: 'Escape' };
  const k = map[key] || key;
  const code = k.length === 1 ? 'Key' + k.toUpperCase() : k;
  el.dispatchEvent(new KeyboardEvent('keydown',  { key: k, code, bubbles: true }));
  if (k === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', { key: k, code, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup',    { key: k, code, bubbles: true }));
  if (k === 'Enter') {
    const form = el.closest?.('form');
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
  }
}

function domSubmit(sel) {
  let target = null;
  if (sel) { try { target = document.querySelector(sel); } catch {} }
  const form = target?.closest?.('form') || document.activeElement?.closest?.('form') || document.querySelector('form');
  if (!form) return { ok: false, reason: 'No form found' };
  form.requestSubmit ? form.requestSubmit() : form.submit();
  return { ok: true };
}

function domScroll(dir, px) {
  const visible = el => {
    const r = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && r.display !== 'none' && r.visibility !== 'hidden';
  };
  const candidates = [document.scrollingElement || document.documentElement, ...document.querySelectorAll('*')]
    .filter(el => {
      if (!el || !visible(el)) return false;
      const style = getComputedStyle(el);
      return (el.scrollHeight - el.clientHeight) > 80 && /(auto|scroll|overlay)/.test(style.overflowY || '');
    })
    .map(el => {
      const rect = el.getBoundingClientRect();
      return { el, area: Math.max(0,Math.min(rect.width,innerWidth)) * Math.max(0,Math.min(rect.height,innerHeight)) };
    })
    .sort((a, b) => b.area - a.area);

  const scroller = candidates[0]?.el || document.scrollingElement || document.documentElement;
  const isDoc    = scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement;
  const before   = isDoc ? scrollY : scroller.scrollTop;
  const amount   = Math.max(200, px || 600);
  const target   = dir === 'bottom' ? scroller.scrollHeight : dir === 'top' ? 0 : before + (dir === 'up' ? -amount : amount);

  if (isDoc) window.scrollTo({ top: target, behavior: 'auto' });
  else scroller.scrollTop = target;

  const after  = isDoc ? scrollY : scroller.scrollTop;
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return {
    ok: true, before, after,
    moved:    Math.abs(after - before),
    atTop:    after <= 4,
    atBottom: after >= maxTop - 4,
    target:   isDoc ? 'document' : (scroller.tagName.toLowerCase() + (scroller.id ? '#' + scroller.id : '')),
  };
}

function domScrollToUid(uid) {
  const escAttr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const el = document.querySelector('[data-opencomet-agent-uid="' + escAttr(uid) + '"]');
  if (!el) return { ok: false, reason: 'uid not found: ' + uid };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  return { ok: true };
}

function domScrollToText(text) {
  const target = String(text || '').trim().toLowerCase();
  if (!target) return { ok: false, reason: 'No text provided' };
  const match = [...document.querySelectorAll('body *')].find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.textContent?.toLowerCase().includes(target);
  });
  if (!match) return { ok: false, reason: 'Text not visible: ' + text };
  match.scrollIntoView({ block: 'center', inline: 'nearest' });
  return { ok: true };
}

async function domSearch(query, context = null) {
  const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const isEditable = el => {
    if (!el) return false;
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '') return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return !['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes((el.type || '').toLowerCase());
  };
  const scoreEl = el => {
    const hints = [
      el.type,
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('role'),
      el.getAttribute?.('title'),
      el.className,
    ].map(norm).join(' ');
    let score = 0;
    if ((el.type || '').toLowerCase() === 'search') score += 6;
    if (hints.includes('search')) score += 5;
    if (hints.includes('find')) score += 4;
    if (hints.includes('query')) score += 3;
    if (/\bqs?\b/.test(hints)) score += 3;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.45) score += 2;
    if (rect.width > 120) score += 1;
    return score;
  };
  const nativeSet = (el, value) => {
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '') {
      el.focus();
      document.execCommand?.('selectAll', false);
      try { document.execCommand?.('insertText', false, value); } catch {}
      if (!el.textContent?.includes(value)) el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let searchEl = null;
  const candidateSelectors = (context?.candidates || []).map(candidate => candidate?.selector).filter(Boolean);
  for (const selector of candidateSelectors) {
    const uid = selector.startsWith('uid:') ? selector.slice(4) : '';
    let candidate = null;
    if (uid) {
      candidate = document.querySelector('[data-opencomet-agent-uid="' + uid.replace(/"/g, '\\"') + '"]');
    } else {
      try { candidate = document.querySelector(selector); } catch {}
    }
    if (visible(candidate)) {
      searchEl = candidate;
      break;
    }
  }

  if (!searchEl) {
    const pools = [
      ...document.querySelectorAll('input, textarea, [contenteditable], [role="searchbox"], [role="textbox"], button, a'),
    ].filter(visible);
    searchEl = pools.sort((a, b) => scoreEl(b) - scoreEl(a))[0] || null;
  }

  if (!searchEl) return { ok: false, reason: 'No search input found' };

  if (!isEditable(searchEl)) {
    searchEl.click();
    await new Promise(res => setTimeout(res, 400));
    const fresh = [
      ...document.querySelectorAll('input, textarea, [contenteditable], [role="searchbox"], [role="textbox"]'),
    ].filter(el => visible(el) && isEditable(el));
    searchEl = fresh.sort((a, b) => scoreEl(b) - scoreEl(a))[0] || searchEl;
  }

  if (!isEditable(searchEl)) return { ok: false, reason: 'Found search trigger but no editable input appeared' };

  searchEl.scrollIntoView({ block: 'center' });
  searchEl.focus();
  nativeSet(searchEl, query);

  const form = searchEl.closest('form');
  const submitButton = form?.querySelector('button[type=submit], input[type=submit], button[aria-label*=search i], button[title*=search i], #search-icon-legacy') || null;

  searchEl.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', code: 'Enter', bubbles: true }));
  searchEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
  searchEl.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', code: 'Enter', bubbles: true }));

  if (submitButton && typeof submitButton.click === 'function') {
    submitButton.click();
  } else if (form) {
    form.requestSubmit ? form.requestSubmit() : form.submit();
  }

  return {
    ok: true,
    matchedSelector: searchEl.id ? `#${searchEl.id}` : searchEl.name ? `[name="${searchEl.name}"]` : searchEl.tagName.toLowerCase(),
  };
}

export function describeAction(action) {
  const map = {
    navigate:       () => 'Navigate → ' + action.url,
    click:          () => 'Click "' + (action.selector || action.text) + '"',
    type:           () => 'Type "' + String(action.text || action.value || '').substring(0, 40) + '" into ' + action.selector,
    fill:           () => 'Fill "' + action.selector + '" ← "' + String(action.text || action.value || '').substring(0, 30) + '"',
    scroll:         () => 'Scroll ' + action.direction + ' ' + (action.amount || 600) + 'px',
    scroll_to_uid:  () => 'Scroll to uid:' + (action.uid || action.selector),
    scroll_to_text: () => 'Scroll to "' + (action.text || action.selector) + '"',
    search:         () => 'Search "' + action.query + '"',
    press_key:      () => 'Press ' + action.key,
    key:            () => 'Press ' + action.key,
    submit:         () => 'Submit form',
    wait:           () => 'Wait ' + ((action.ms || 2000) / 1000) + 's',
    extract:        () => 'Extract "' + action.selector + '"',
    new_tab:        () => 'New tab → ' + (action.url || ''),
    switch_tab:     () => 'Switch tab → ' + (action.host || action.title || ''),
    close_tab:      () => 'Close tab ' + (action.host || ''),
    done:           () => 'Done',
  };
  return (map[action.type] ?? (() => action.type))();
}
