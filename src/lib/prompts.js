// ─────────────────────────────────────────────────────────────────────────────
// src/lib/prompts.js
// AI system prompt + plan/action prompt builders.
// System prompt engineered by a senior prompt engineer for maximum reliability,
// loop-resistance, selector precision, and clear completion criteria.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// Design principles:
//   1. Crystal-clear output contract — one JSON shape, zero ambiguity
//   2. Selector hierarchy enforced — uid > text: > #id > [name] > CSS
//   3. Explicit loop-break rules — agent cannot spiral on scroll/click
//   4. Done criteria specified — agent knows when to stop, not just when to act
//   5. Safety rules — no destructive actions without approval
//   6. Skill awareness — agent knows to honour user-defined skills
// ═══════════════════════════════════════════════════════════════════════════════
export const SYSTEM_PROMPT = `\
You are Open Comet — a precise, methodical, and reliable autonomous browser agent.
You control a real Chrome browser tab on behalf of a user and must complete tasks efficiently with minimal unnecessary steps.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FUNDAMENTAL RULES  (never break these)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Respond with a single, valid JSON object ONLY.
   No markdown fences. No prose. No comments. No trailing text.
2. Choose exactly ONE action per response. Never bundle multiple actions.
3. Always base decisions on the screenshot AND the structured page data together.
4. Never invent element selectors — use only selectors from INTERACTIVE ELEMENTS or the screenshot.
   Screenshot badges are visual labels for INTERACTIVE ELEMENTS uids: badge "15" maps to selector "uid:nx-15".
5. Prefer the fewest actions possible to complete the task.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE SHAPES  (use exactly one per response)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PLANNING (only for the initial plan step):
{
  "goal":               "One sentence describing what success looks like",
  "approach":           "Brief strategy — how you'll achieve the goal",
  "sites":              ["site1.com", "site2.com"],
  "steps":              ["Step 1: …", "Step 2: …"],
  "estimated_actions":  <integer 1-40>
}

ACTION (normal step — pick exactly one action type):
{
  "current_plan_item": <optional integer index of the active plan step>,
  "plan_update":       ["optional revised step 1", "optional revised step 2"],
  "action":    { <see ACTION CATALOGUE> },
  "reasoning": "One sentence — why this specific action advances the task right now"
}

DONE (task is fully and verifiably complete):
{
  "action":  { "type": "done" },
  "answer":  "Comprehensive, well-structured final answer. Include all data found — prices, comparisons, links, conclusions. Do NOT write 'Done' or 'Task completed' — write the actual result.",
  "data":    { "key": "structured data if applicable" }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTION CATALOGUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{ "type": "navigate",       "url": "https://…" }
{ "type": "search",         "query": "search terms" }
{ "type": "click",          "selector": "<SELECTOR — see rules below>" }
{ "type": "click",          "selector": "<SELECTOR>", "x": <optional viewport x>, "y": <optional viewport y> }
{ "type": "type",           "selector": "<SELECTOR>", "text": "text to enter" }
{ "type": "submit",         "selector": "<optional form selector>" }
{ "type": "scroll",         "direction": "down|up|top|bottom", "amount": 600 }
{ "type": "scroll_to_uid",  "uid": "nx-12" }
{ "type": "scroll_to_text", "text": "visible text to scroll to" }
{ "type": "key",            "key": "Enter|Tab|Escape|ArrowDown|ArrowUp" }
{ "type": "new_tab",        "url": "https://…" }
{ "type": "switch_tab",     "host": "example.com" }
{ "type": "close_tab",      "host": "example.com" }
{ "type": "wait",           "ms": 1500 }
{ "type": "extract",        "selector": "CSS selector for data to extract" }
{ "type": "done" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECTOR RULES  (apply in strict priority order)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. uid:nx-N         → from INTERACTIVE ELEMENTS list (ALWAYS prefer this)
2. text:Label Text  → exact visible button/link text (NOT for search queries)
3. #element-id      → unique element ID
4. [name="x"]       → named form input
5. simple.class     → single class, max 2 levels deep

NEVER use:
  • XPath expressions
  • :has-text(…), nth=, locator(…), getByRole(…) — Playwright syntax not supported
  • CSS chains deeper than 3 levels
  • Generic tags like "div", "span", "section" alone

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION FRAMEWORK  (apply before every action)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 1 — Understand state: Read screenshot + page data + scroll state together.
Step 2 — Check memory: Did this exact action just fail? If yes, try a different approach.
Step 3 — Check progress: Has the page state changed since last step?
  If NO change detected for 2+ steps → MUST change strategy (new URL, new approach, or done).
Step 4 — Choose action: Pick the single highest-value next action.
Step 5 — Verify selector: Is it from INTERACTIVE ELEMENTS? If not, use a simpler fallback.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCROLL DISCIPLINE  (anti-loop rules)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before any scroll action, check SCROLL STATE:
  • atBottom: true  → STOP scrolling down. Interact with visible elements or navigate.
  • atTop: true     → STOP scrolling up.
  • percent ≥ 92   → Near bottom — one final scroll max, then act on what's visible.

LOOP HINTS override everything: if LOOP HINTS say "no new content after scrolling" → do NOT scroll again.
After 2 down-scrolls with no new interactive elements appearing → change strategy.
Use scroll_to_uid or scroll_to_text to jump to a specific element instead of blind scrolling.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEARCH & NAVIGATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• For typing a search query and submitting: use "search" action (not click → type → key).
• After navigating to a new page, wait for INTERACTIVE ELEMENTS to reflect the new DOM before clicking.
• For research/shopping: open comparison tabs with new_tab; use switch_tab to move between them.
• Never re-submit the same search query to the same engine consecutively.
• Prefer direct URL navigation when you know the exact URL (faster, more reliable).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SKILLS  (user-defined behaviours — follow precisely)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When ACTIVE SKILLS are listed, you MUST follow their instructions exactly.
Skills override default behaviour when they conflict.
Check the skill's doneChecklist — use it to verify completion before returning "done".
If a skill restricts allowed hosts, do not navigate outside those hosts.
When you determine a checklist item is complete, add [DONE: <exact item text>] to your reasoning.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HIDDEN PAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If VISIBILITY is "hidden": the page is redacted by privacy policy.
→ Do NOT guess or invent content. Navigate to a visible source instead.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONE CRITERIA  (when to return type "done")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return "done" when ANY of these is true:
  ✓ The user's explicit goal is fully and verifiably achieved.
  ✓ All required data has been collected from ≥2 independent sources (research tasks).
  ✓ The action (form submit, click, navigation) completed successfully with visible confirmation.
  ✓ All useful sources have been visited and no new information is emerging.
  ✓ A skill's doneChecklist items are all satisfied.

The "answer" MUST contain the actual result — findings, prices, comparisons, data, URLs —
not vague statements like "I completed the task" or "Done".
Structure the answer with clear sections if it covers multiple points.`;

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
export function buildPlanPrompt(task, pageInfo, screenshot, options = {}) {
  const {
    profile     = 'default',
    userNotes   = [],
    attachments = [],
    skills      = [],
    memory      = {},
    profileData = {},
  } = options;

  const notesBlock = userNotes.length
    ? userNotes.map(n => `  • ${n.text}`).join('\n')
    : '  • None';

  const profileNote = profile === 'deep_research'
    ? 'DEEP RESEARCH MODE — plan to visit ≥3 independent sources, use tabs for parallel comparison, synthesise before concluding.'
    : profile === 'summarize'
      ? 'SUMMARIZE MODE — prefer direct page text and structure over screenshots; avoid unnecessary browsing.'
    : 'STANDARD MODE — efficient, direct path to the goal. Minimise steps.';

  return `\
═══ TASK ════════════════════════════════════════════════════
${task}

═══ CONTEXT ═════════════════════════════════════════════════
Current URL  : ${pageInfo.url   || 'about:blank'}
Page title   : ${pageInfo.title || '—'}
Visibility   : ${pageInfo.visibility || 'visible'}
Profile      : ${profileNote}

Readable text:
${(pageInfo.readableText || pageInfo.text || '').substring(0, 4000)}

═══ OPEN TABS ═══════════════════════════════════════════════
${JSON.stringify(pageInfo.openTabs || [], null, 2)}

═══ USER NOTES ══════════════════════════════════════════════
${notesBlock}

═══ USER PROFILE ════════════════════════════════════════════
${formatProfile(profileData)}

═══ ACTIVE SKILLS ═══════════════════════════════════════════
${formatSkills(skills)}

═══ ATTACHMENTS ═════════════════════════════════════════════
${formatAttachments(attachments)}

═══ TASK MEMORY (recent pages) ══════════════════════════════
${JSON.stringify(memory.pageSnapshots || [], null, 2)}

═══ INSTRUCTIONS ════════════════════════════════════════════
Return ONLY the PLANNING JSON (no other text).
• 3–8 concrete numbered steps.
• Every website hostname you expect to visit in "sites".
• "goal" = one sentence describing what success looks like.
• "approach" = 1–2 sentences on strategy.
• "estimated_actions" = realistic integer estimate.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
export function buildActionPrompt(task, plan, pageInfo, screenshot, recentSteps, iteration, options = {}) {
  const {
    profile     = 'default',
    userNotes   = [],
    attachments = [],
    skills      = [],
    memory      = {},
    profileData = {},
    workSummary = '',
  } = options;

  const recentActionsText = recentSteps
    .filter(s => ['action', 'done', 'error', 'muted', 'stopped'].includes(s.type))
    .slice(-8)
    .map(s => `  [${s.type.toUpperCase()}] ${s.text}`)
    .join('\n') || '  None yet';

  const notesText = userNotes.length
    ? userNotes.slice(-5).map(n => `  • ${n.text}`).join('\n')
    : '  None';

  const profileNote = profile === 'deep_research'
    ? 'DEEP RESEARCH — compare ≥2 sources before concluding; use new_tab for parallel comparison.'
    : profile === 'summarize'
      ? 'SUMMARIZE — answer from scraped page text when possible; only use screenshots for navigation or ambiguity.'
    : 'STANDARD MODE';

  const loopHints = memory.loopHints || [];
  const loopSection = loopHints.length
    ? `⚠️ LOOP WARNING:\n${loopHints.map(h => `  • ${h}`).join('\n')}`
    : '  None';

  return `\
═══ TASK (iteration ${iteration}) ══════════════════════════════════════
${task}
Mode: ${profileNote}

═══ CURRENT PAGE ════════════════════════════════════════════
URL        : ${pageInfo.url   || 'unknown'}
Title      : ${pageInfo.title || 'unknown'}
Visibility : ${pageInfo.visibility || 'visible'}

SCROLL STATE:
${JSON.stringify(pageInfo.scrollState || {}, null, 2)}

Page text (first 2500 chars):
${(pageInfo.text || '').substring(0, 2500)}

Readable page text (preferred for research/summarize):
${(pageInfo.readableText || '').substring(0, 5000)}

Headings:
${JSON.stringify((pageInfo.headings || []).slice(0, 20), null, 2)}

Tables:
${JSON.stringify((pageInfo.tables || []).slice(0, 3), null, 2)}

═══ OPEN TASK TABS ══════════════════════════════════════════
${JSON.stringify(pageInfo.openTabs || [], null, 2)}

═══ INTERACTIVE ELEMENTS  (prefer uid: selectors) ═══════════
${JSON.stringify(pageInfo.interactiveElements || [], null, 2)}

═══ CLICKABLE ELEMENTS ══════════════════════════════════════
${JSON.stringify(pageInfo.clickables || [], null, 2)}

═══ AVAILABLE INPUTS ════════════════════════════════════════
${JSON.stringify(pageInfo.inputs || [], null, 2)}

═══ VISIBLE LINKS ═══════════════════════════════════════════
${JSON.stringify((pageInfo.links || []).slice(0, 20), null, 2)}

═══ RECENT ACTIONS ══════════════════════════════════════════
${recentActionsText}

═══ LOOP HINTS ══════════════════════════════════════════════
${loopSection}

═══ TASK MEMORY ═════════════════════════════════════════════
${JSON.stringify(memory.pageSnapshots || [], null, 2)}

${workSummary ? `═══ WORK SUMMARY (compressed history) ═══════════════════════
${workSummary}
` : ''}═══ USER NOTES ══════════════════════════════════════════════
${notesText}

═══ USER PROFILE ════════════════════════════════════════════
${formatProfile(profileData)}

═══ ACTIVE SKILLS ═══════════════════════════════════════════
${formatSkills(skills)}

═══ ATTACHMENTS ═════════════════════════════════════════════
${formatAttachments(attachments)}

═══ PLAN (reference) ════════════════════════════════════════
${plan ? JSON.stringify(plan.steps || [], null, 2) : 'No plan provided'}

═══ DECISION INSTRUCTIONS ═══════════════════════════════════
1. Study the structured page content first, then use the screenshot for navigation grounding when needed.
2. Check SCROLL STATE: if atBottom or percent≥92, do NOT scroll down again.
3. Check LOOP HINTS: if warned about repeated state, change strategy NOW.
4. If LOOP HINTS or RECENT ACTIONS show the same action repeated ≥2×: change approach.
5. Pick the single highest-value next action.
6. Use uid: selectors from INTERACTIVE ELEMENTS; only fall back to text: or CSS.
   If the screenshot shows a numeric badge, convert it to uid:nx-N before clicking.
   Treat label, axName, and domPath as grounding hints. If isNew is true, the element appeared after your recent action on the same page.
7. If skills are active, check their instructions and doneChecklist.
   For summarise/extract/scrape tasks, prefer readableText, headings, and tables over screenshot interpretation.
8. If task is fully complete, return type "done" with a comprehensive, data-rich answer.
9. When a plan exists, set current_plan_item to the step you are actively working on.
   If the plan is no longer good, emit plan_update with a fully revised list before continuing.

Return ONLY the ACTION JSON.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL PROMPT BUILDER  (for when a skill is the primary context)
// ═══════════════════════════════════════════════════════════════════════════════
export function buildSkillActionPrompt(skill, pageInfo, recentSteps, iteration) {
  return buildActionPrompt(
    skill.prompt,
    { steps: skill.doneChecklist?.map((c, i) => `Step ${i+1}: ${c}`) || [] },
    pageInfo,
    null,
    recentSteps,
    iteration,
    {
      skills: [skill],
      userNotes: [],
      attachments: [],
      memory: {},
    }
  );
}

// ─── Context formatters ───────────────────────────────────────────────────────
function formatAttachments(attachments) {
  if (!attachments?.length) return '  None';
  return attachments.slice(0, 6).map(a => {
    if (a.kind === 'text')  return `  • ${a.name} (${a.mimeType || 'text'}): ${String(a.textContent || '').substring(0, 1800)}${a.truncated ? ' …[truncated]' : ''}`;
    if (a.kind === 'image') return `  • ${a.name} (image — pixels sent to vision-capable models)`;
    return `  • ${a.name} (${a.mimeType || 'file'}, ${a.size || 0} bytes)`;
  }).join('\n');
}

function formatSkills(skills) {
  if (!skills?.length) return '  None';
  return skills.slice(0, 6).map(skill => {
    const extras = [];
    if (skill.allowedHosts?.length)   extras.push(`allowed hosts: ${skill.allowedHosts.join(', ')}`);
    if (skill.preferredSites?.length) extras.push(`preferred: ${skill.preferredSites.join(', ')}`);
    if (skill.doneChecklist?.length)  extras.push(`done when: ${skill.doneChecklist.join('; ')}`);
    const suffix = extras.length ? ` [${extras.join(' | ')}]` : '';
    return `  • ${skill.name}: ${String(skill.prompt || '').substring(0, 700)}${suffix}`;
  }).join('\n');
}

function formatProfile(profileData) {
  const profile = profileData || {};
  const items = [
    ['Full name', profile.fullName],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['Address', profile.address],
    ['Company', profile.company],
    ['Website', profile.website],
    ['Notes', profile.notes],
  ].filter(([, value]) => String(value || '').trim());

  if (!items.length) return '  None';
  return items.map(([label, value]) => `  • ${label}: ${String(value).trim()}`).join('\n');
}
