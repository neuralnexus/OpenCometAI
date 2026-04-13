// ═══════════════════════════════════════════════════════════════════
// Open Comet — Content Script
// Injects live overlay HUD into pages while agent is working
// UI matches Claude.ai aesthetic: warm cream/charcoal, minimal, clean
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (window.__opencometInjected) return;
  window.__opencometInjected = true;

  let overlayEl  = null;
  let statusEl   = null;
  let badgeEl    = null;
  let isActive   = false;
  const originalTitle = document.title;

  const STOP_ICON_SVG = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="2" y="2" width="10" height="10" rx="1.5" />
    </svg>`;

  // ── Create overlay ──────────────────────────────────────────────
  function createOverlay() {
    if (overlayEl || !document.documentElement) return;

    // ── Styles ──────────────────────────────────────────────────
    const style = document.createElement('style');
    style.id = 'open-comet-overlay-styles';
    style.textContent = `

      /* ── Overlay pill ── */
      #open-comet-agent-overlay {
        position: fixed;
        bottom: 32px;
        left: 50%;
        z-index: 2147483647;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 0;
        background: rgba(28, 25, 23, 0.72); /* Glass dark */
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 0.5px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px; /* Capsule shape */
        padding: 4px 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', sans-serif;
        box-shadow:
          0 4px 12px rgba(0,0,0,0.12),
          0 16px 48px rgba(0,0,0,0.32),
          inset 0 0 0 0.5px rgba(255,255,255,0.08);
        animation: nc-pop-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
        transition: opacity 0.25s ease, transform 0.25s ease;
        min-width: 240px;
        max-width: 440px;
        width: auto;
        pointer-events: all;
        user-select: none;
        overflow: hidden;
      }

      @keyframes nc-pop-in {
        from { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.95); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1);    }
      }

      #open-comet-agent-overlay.open-comet-hiding {
        opacity: 0;
        transform: translateX(-50%) translateY(12px) scale(0.96);
      }

      /* ── Left: brand mark ── */
      .nc-brand {
        width: 42px;
        height: 42px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        margin-right: 2px;
      }

      /* Spinning ring behind the logo */
      .nc-brand::before {
        content: '';
        position: absolute;
        inset: 4px;
        border-radius: 50%;
        border: 1.2px solid transparent;
        border-top-color: rgba(217, 135, 90, 0.8);
        border-right-color: rgba(217, 135, 90, 0.2);
        animation: nc-spin 1.2s linear infinite;
      }

      @keyframes nc-spin {
        to { transform: rotate(360deg); }
      }

      .nc-logo {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        position: relative;
        z-index: 1;
        filter: drop-shadow(0 0 8px rgba(217, 135, 90, 0.4));
      }

      /* ── Center: text content ── */
      .nc-content {
        flex: 1;
        min-width: 0;
        padding: 0 12px 0 6px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1px;
      }

      .nc-label {
        font-size: 8.5px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
        line-height: 1;
        margin-bottom: 1px;
      }

      .nc-status {
        font-size: 13.5px;
        font-weight: 500;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
        animation: nc-fade 0.25s ease;
      }

      @keyframes nc-fade {
        from { opacity: 0.4; transform: translateY(1px); }
        to   { opacity: 1;   transform: translateY(0);   }
      }

      .nc-step {
        display: none; /* Hide step for more compact look, or keep very small */
      }

      /* ── Right: stop button ── */
      .nc-stop-wrap {
        padding-right: 4px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      #open-comet-stop-btn {
        width: 34px;
        height: 34px;
        border-radius: 50%; /* Circle button */
        background: rgba(255, 255, 255, 0.1);
        border: 0.5px solid rgba(255, 255, 255, 0.15);
        color: #ffffff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }

      #open-comet-stop-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.3);
        transform: scale(1.05);
      }

      #open-comet-stop-btn:active {
        transform: scale(0.92);
        background: rgba(255, 255, 255, 0.12);
      }

      #open-comet-stop-btn svg {
        opacity: 0.9;
      }
    `;

    overlayEl = document.createElement('div');
    overlayEl.id = 'open-comet-agent-overlay';
    overlayEl.innerHTML = `
      <div class="nc-brand">
        <div class="nc-logo">
          <img id="open-comet-brand-logo" width="22" height="22" style="display:block;border-radius:4px;" />
        </div>
      </div>
      <div class="nc-content">
        <div class="nc-label">Open Comet is working</div>
        <div class="nc-status" id="open-comet-status-text">Starting…</div>
      </div>
      <div class="nc-stop-wrap">
        <button id="open-comet-stop-btn" title="Stop agent">
          ${STOP_ICON_SVG}
        </button>
      </div>
    `;

    const head = document.head || document.documentElement;
    const body = document.body || document.documentElement;
    head.appendChild(style);
    body.appendChild(overlayEl);

    statusEl = document.getElementById('open-comet-status-text');
    setAgentTitle(true);

    // Set logos
    const brandLogo = document.getElementById('open-comet-brand-logo');
    if (brandLogo) {
      brandLogo.src = chrome.runtime.getURL('assets/icons/icon48.png');
    }

    document.getElementById('open-comet-stop-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
      removeOverlay();
    });

    isActive = true;
  }

  // ── Remove overlay ───────────────────────────────────────────────
  function removeOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.add('open-comet-hiding');
    setTimeout(() => {
      overlayEl?.remove();
      document.getElementById('open-comet-overlay-styles')?.remove();
      overlayEl = null;
      statusEl  = null;
      badgeEl   = null;
      isActive  = false;
      setAgentTitle(false);
    }, 300);
  }

  // ── Update status text + step badge ─────────────────────────────
  function updateStatus(text, step) {
    if (!overlayEl) createOverlay();
    if (statusEl) statusEl.textContent = text;
    if (badgeEl && step !== undefined) badgeEl.textContent = `step ${step}`;
  }

  // ── Tab title indicator ─────────────────────────────────────────
  function setAgentTitle(active) {
    if (active) {
      if (!document.title.startsWith('◉ ')) {
        document.title = `◉ ${originalTitle}`;
      }
    } else if (document.title.startsWith('◉ ')) {
      document.title = originalTitle;
    }
  }

  // ── Background message listener ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {

    if (msg.type === 'STEP_UPDATE') {
      const s = msg.step;
      if (!overlayEl && s.type !== 'stopped' && s.type !== 'done' && s.type !== 'error') {
        createOverlay();
      }
      const cleanText = (s.text || '').replace(/^[^\s]+\s/, '');
      updateStatus(cleanText, msg.stepCount || msg.allSteps?.length || 0);

      if (s.type === 'done' || s.type === 'stopped') {
        setTimeout(removeOverlay, 2800);
      }
      if (s.type === 'error') {
        setTimeout(removeOverlay, 3800);
      }
    }

    if (msg.type === 'AGENT_DONE' || msg.type === 'AGENT_STOPPED' || msg.type === 'AGENT_ERROR') {
      setTimeout(removeOverlay, 3000);
    }

    if (msg.type === 'AGENT_STARTED') {
      createOverlay();
      updateStatus('Starting agent…', 0);
    }

    if (msg.type === 'CHAT_RESET') {
      removeOverlay();
    }
  });

})();

