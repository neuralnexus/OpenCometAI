// ─────────────────────────────────────────────────────────────────────────────
// src/lib/skill-matcher.js
// Automatically detects and activates skills that are relevant to the user's
// task and current URL — without requiring manual skill selection.
//
// Matching approach:
//   1. Host match  — skill.allowedHosts ∩ current URL's host → strong signal
//   2. Token overlap — tf-idf-lite overlap between task text and skill name+desc
//   3. Keyword match — keyword list for built-in skills (search shopping, etc.)
//
// Only activates a skill if its confidence score exceeds AUTO_THRESHOLD.
// Never duplicates a skill already explicitly activated by the user.
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_THRESHOLD = 0.38; // minimum score to auto-activate

// ── Per-skill keyword boosters for built-in skills ────────────────────────────
const SKILL_KEYWORDS = {
  builtin_summarise:        ['summarize', 'summarise', 'tldr', 'summary', 'overview', 'brief', 'explain'],
  builtin_price_check:      ['price', 'cost', 'buy', 'cheap', 'compare', 'shopping', 'deal', 'discount', 'amazon', 'flipkart'],
  builtin_extract_emails:   ['email', 'contact', 'phone', 'address', 'reach out', 'mail'],
  builtin_research_deep:    ['research', 'find', 'analyze', 'investigate', 'report', 'deep dive', 'compare', 'versus', 'vs'],
  builtin_fill_form:        ['fill', 'form', 'apply', 'register', 'signup', 'sign up', 'submit'],
};

/**
 * Given a task string and current page URL, returns skills from `allSkills`
 * that should be automatically activated.
 *
 * @param {string}   task       - The user's raw task string.
 * @param {string}   pageUrl    - The current page URL.
 * @param {Object[]} allSkills  - All available skills (built-in + user).
 * @param {string[]} activeIds  - IDs of skills already activated by the user.
 * @returns {Object[]} Array of skill objects to auto-activate.
 */
export function detectSkillsForTask(task, pageUrl, allSkills, activeIds = []) {
  if (!task || !Array.isArray(allSkills) || !allSkills.length) return [];

  const taskNorm  = normalizeText(task);
  const taskTokens = tokenize(taskNorm);
  const host      = extractHost(pageUrl || '');

  const candidates = [];

  for (const skill of allSkills) {
    const skillId = String(skill.id || '');

    // Never add a skill the user already activated
    if (activeIds.includes(skillId)) continue;

    const score = scoreSkill(skill, taskNorm, taskTokens, host);
    if (score >= AUTO_THRESHOLD) {
      candidates.push({ skill, score });
    }
  }

  // Sort by score descending; cap at 2 auto-activated skills to avoid noise
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 2).map(c => c.skill);
}

// ── Scoring ────────────────────────────────────────────────────────────────────

function scoreSkill(skill, taskNorm, taskTokens, host) {
  let score = 0;

  // 1. Host match — strongest signal
  const allowedHosts = (skill.allowedHosts || []).map(h => String(h).toLowerCase().trim());
  if (host && allowedHosts.length && allowedHosts.some(h => host.includes(h) || h.includes(host))) {
    score += 0.55;
  }

  // 2. Keyword match against known keyword lists
  const keywords = SKILL_KEYWORDS[skill.id] || [];
  const kwHits = keywords.filter(kw => taskNorm.includes(kw)).length;
  if (kwHits > 0) {
    score += Math.min(0.45, kwHits * 0.14);
  }

  // 3. Token overlap with skill name + description
  const skillText  = normalizeText(`${skill.name || ''} ${skill.description || ''}`);
  const skillTokens = tokenize(skillText);
  const overlap    = tokenOverlap(taskTokens, skillTokens);
  score += overlap * 0.30;

  // 4. Penalty: user-defined skills with no host/keyword context are ambiguous
  if (!skill.builtIn && !allowedHosts.length && keywords.length === 0) {
    score -= 0.10;
  }

  return Math.min(1, score);
}

// ── Text utilities ─────────────────────────────────────────────────────────────

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return new Set(
    String(text || '')
      .split(' ')
      .map(t => t.trim())
      .filter(t => t.length > 2 && !STOP_WORDS.has(t))
  );
}

/**
 * Jaccard-like overlap between two token sets.
 */
function tokenOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const token of a) {
    if (b.has(token)) hits++;
  }
  return hits / Math.max(a.size, b.size);
}

function extractHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
  'have', 'has', 'its', 'into', 'but', 'not', 'can', 'you', 'all',
  'use', 'get', 'any', 'how', 'what', 'when', 'where', 'who', 'will',
  'our', 'my', 'your', 'their', 'them', 'then', 'than', 'also', 'about',
  'want', 'need', 'make', 'just', 'like', 'some', 'more', 'does', 'did',
]);
