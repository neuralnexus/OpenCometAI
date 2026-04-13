// ─────────────────────────────────────────────────────────────────────────────
// src/lib/skills.js
// Skills system — user-defined reusable agent behaviours.
//
// A Skill is a named, saved set of instructions the agent follows automatically
// when the user activates it before or during a task. Examples:
//   • "Amazon Price Tracker" — always check Amazon.in, extract price + rating
//   • "LinkedIn Outreach"    — navigate to profile, compose and send a note
//   • "Summarise Page"       — extract key points in bullet form
//
// Skills are stored in chrome.storage.local under 'opencometSkills'.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'opencometSkills';

export const SKILL_CATEGORIES = [
  'Research',
  'Shopping',
  'Social',
  'Productivity',
  'Data Extraction',
  'Form Filling',
  'Custom',
];

export const BUILT_IN_SKILLS = [
  {
    id:            'builtin_summarise',
    name:          'Summarise Page',
    description:   'Extract and summarise the key points of the current page.',
    category:      'Research',
    icon:          '📄',
    prompt:        'Read the current page carefully. Extract the main topic, key arguments or facts, and any important conclusions. Present this as a clear, well-structured summary with bullet points for the key facts. Keep it concise — under 300 words.',
    allowedHosts:  [],
    preferredSites:[],
    doneChecklist: ['Page content has been summarised', 'Key points are listed', 'Summary is under 300 words'],
    builtIn:       true,
    createdAt:     0,
  },
  {
    id:            'builtin_price_check',
    name:          'Price Comparison',
    description:   'Find and compare the price of the searched product across top shopping sites.',
    category:      'Shopping',
    icon:          '🛒',
    prompt:        'Search for the product name on Amazon, Flipkart, and one other relevant shopping site. For each site, extract: product name, exact price, rating (if shown), and product URL. Return a structured comparison table with the best deal clearly highlighted.',
    allowedHosts:  ['amazon.in', 'amazon.com', 'flipkart.com'],
    preferredSites:['amazon.in', 'flipkart.com'],
    doneChecklist: ['Prices found on at least 2 sites', 'Ratings extracted where available', 'Best deal identified'],
    builtIn:       true,
    createdAt:     0,
  },
  {
    id:            'builtin_extract_emails',
    name:          'Extract Emails & Contacts',
    description:   'Scrape all email addresses and contact details from the current page.',
    category:      'Data Extraction',
    icon:          '📧',
    prompt:        'Scan the entire page (scroll to the bottom if needed) and extract every email address, phone number, and contact name visible. Also note the page title and URL. Return the results as a structured list grouped by type (emails, phones, names).',
    allowedHosts:  [],
    preferredSites:[],
    doneChecklist: ['Page fully scrolled', 'All emails extracted', 'All phone numbers extracted', 'Results structured by type'],
    builtIn:       true,
    createdAt:     0,
  },
  {
    id:            'builtin_research_deep',
    name:          'Multi-Source Research',
    description:   'Research a topic across 3+ independent sources and compare findings.',
    category:      'Research',
    icon:          '🔬',
    prompt:        'Research the given topic thoroughly. Visit at least 3 independent, authoritative sources (not just Google). For each source: note the URL, key claims, and any data points. After visiting all sources, synthesise the findings into a cohesive report that notes areas of agreement and disagreement. Cite sources by URL.',
    allowedHosts:  [],
    preferredSites:[],
    doneChecklist: ['At least 3 independent sources visited', 'Key claims noted per source', 'Synthesis written with citations', 'Conflicting information flagged'],
    builtIn:       true,
    createdAt:     0,
  },
  {
    id:            'builtin_fill_form',
    name:          'Smart Form Filler',
    description:   'Detect and fill all visible form fields using user-provided information.',
    category:      'Form Filling',
    icon:          '📝',
    prompt:        'Identify all visible form fields on the page (inputs, textareas, selects, checkboxes). For each field, determine what information it requires based on its label, placeholder, and name attribute. Fill each field with appropriate placeholder data or data extracted from the task description. Submit the form only if the user explicitly asked to submit it.',
    allowedHosts:  [],
    preferredSites:[],
    doneChecklist: ['All visible form fields identified', 'Fields filled with appropriate data', 'Form not submitted unless explicitly requested'],
    builtIn:       true,
    createdAt:     0,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Storage operations
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllSkills() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const userSkills   = data[STORAGE_KEY] || [];
  return [...BUILT_IN_SKILLS, ...userSkills];
}

export async function getUserSkills() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

export async function saveSkill(skill) {
  const skills  = await getUserSkills();
  const cleaned = validateAndClean(skill);
  const idx     = skills.findIndex(s => s.id === cleaned.id);
  if (idx >= 0) {
    skills[idx] = cleaned;
  } else {
    skills.unshift(cleaned);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: skills });
  return cleaned;
}

export async function deleteSkill(id) {
  const skills = await getUserSkills();
  const filtered = skills.filter(s => s.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
}

export async function getSkillById(id) {
  const all = await getAllSkills();
  return all.find(s => s.id === id) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation & normalisation
// ─────────────────────────────────────────────────────────────────────────────

export function createNewSkill(partial = {}) {
  return {
    id:            partial.id            || `skill_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    name:          partial.name          || '',
    description:   partial.description  || '',
    category:      partial.category      || 'Custom',
    icon:          partial.icon          || '⚙️',
    prompt:        partial.prompt        || '',
    allowedHosts:  partial.allowedHosts  || [],
    preferredSites:partial.preferredSites|| [],
    doneChecklist: partial.doneChecklist || [],
    builtIn:       false,
    createdAt:     partial.createdAt     || Date.now(),
  };
}

function validateAndClean(skill) {
  return {
    id:            String(skill.id || `skill_${Date.now()}`),
    name:          String(skill.name || '').trim().substring(0, 80),
    description:   String(skill.description || '').trim().substring(0, 300),
    category:      SKILL_CATEGORIES.includes(skill.category) ? skill.category : 'Custom',
    icon:          String(skill.icon || '⚙️').substring(0, 4),
    prompt:        String(skill.prompt || '').trim().substring(0, 3000),
    allowedHosts:  (skill.allowedHosts || []).map(h => String(h).trim().toLowerCase()).filter(Boolean),
    preferredSites:(skill.preferredSites || []).map(s => String(s).trim()).filter(Boolean),
    doneChecklist: (skill.doneChecklist || []).map(c => String(c).trim()).filter(Boolean),
    builtIn:       Boolean(skill.builtIn),
    createdAt:     Number(skill.createdAt) || Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Clone skills for agent state (removes non-serialisable stuff)
// ─────────────────────────────────────────────────────────────────────────────
export function cloneSkillsForAgent(skills) {
  return (skills || []).map(s => ({
    id:            s.id,
    name:          s.name,
    prompt:        s.prompt,
    allowedHosts:  s.allowedHosts  || [],
    preferredSites:s.preferredSites|| [],
    doneChecklist: s.doneChecklist || [],
  }));
}
