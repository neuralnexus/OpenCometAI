// Role-specific prompt builders used for browser-native research, scraping,
// and text-first summarization flows.

export function buildResearchPlannerPrompt(task, options = {}) {
  const {
    maxQueries = 4,
    maxSites = 6,
    siteHints = [],
  } = options;

  return `You are the Open Comet Research Planner sub-agent.
Break the user's topic into focused web-search queries and optional preferred domains.

USER TASK:
${task}

CONSTRAINTS:
- Return ${Math.max(2, maxQueries)} or fewer search queries.
- Aim for at most ${Math.max(2, maxSites)} final source pages.
- Keep each query concise and specific.
- If the user supplied site hints, prefer them.
- Use only domains when they are genuinely helpful.

SITE HINTS:
${siteHints.length ? siteHints.join(', ') : 'None'}

Respond with valid JSON only:
{
  "queries": ["query 1", "query 2"],
  "domains": ["example.com"],
  "strategy": "short sentence"
}`;
}

export function buildSourceDigestPrompt(task, source, page) {
  return `You are the Open Comet Source Analyst sub-agent.
Read one scraped webpage and extract only the evidence relevant to the task.

TASK:
${task}

SOURCE:
Title: ${source.title || page.title || 'Unknown'}
URL: ${source.url || page.url || ''}
Snippet: ${source.snippet || ''}

PAGE CONTENT:
${String(page.text || '').substring(0, 12000)}

Respond with valid JSON only:
{
  "summary": "short evidence-based summary",
  "keyPoints": ["point 1", "point 2"],
  "entities": ["entity 1"],
  "confidence": "high|medium|low"
}`;
}

export function buildResearchSynthesisPrompt(task, digests) {
  const body = digests.map((item, index) => {
    const points = (item.keyPoints || []).map(point => `- ${point}`).join('\n');
    return `[${index + 1}] ${item.title}\nURL: ${item.url}\nSummary: ${item.summary}\n${points}`;
  }).join('\n\n');

  return `You are the Open Comet Synthesis sub-agent.
Use only the source digests below to answer the research task.

TASK:
${task}

SOURCE DIGESTS:
${body}

Write a concise but complete markdown report with:
- Overview
- Key findings
- Conflicts or caveats
- Sources`;
}

export function buildSummaryPrompt(task, pageInfo, profileData = {}) {
  return `You are the Open Comet Summarizer sub-agent.
Summarize the current webpage using the scraped text only. Do not mention screenshots.

USER REQUEST:
${task}

PAGE:
URL: ${pageInfo.url || ''}
Title: ${pageInfo.title || ''}

PROFILE DATA:
${formatProfile(profileData)}

PAGE TEXT:
${String(pageInfo.text || '').substring(0, 16000)}

Return markdown with:
- 2-3 sentence summary
- bullet key points
- notable facts or actions if present

Keep it under 300 words unless the user explicitly asked for more.`;
}

export function buildScrapeExtractionPrompt(task, pageInfo, options = {}) {
  const { maxItems = 30 } = options;
  const contentToUse = pageInfo.cleanedHtml
    ? `CLEANED HTML:\n${String(pageInfo.cleanedHtml).substring(0, 25000)}`
    : `TEXT:\n${String(pageInfo.text || '').substring(0, 18000)}`;

  return `You are the Open Comet Extraction sub-agent.
Convert the scraped webpage into structured records relevant to the user request.

USER REQUEST:
${task}

PAGE:
URL: ${pageInfo.url || ''}
Title: ${pageInfo.title || ''}

${contentToUse}

VISIBLE LINKS:
${JSON.stringify(pageInfo.links || [], null, 2)}

Respond with valid JSON ONLY, and you MUST wrap the JSON exactly inside <blocks> and </blocks> tags. Do not use markdown quotes inside the blocks.

<blocks>
{
  "title": "dataset title",
  "columns": ["column_a", "column_b"],
  "rows": [
    { "column_a": "value", "column_b": "value" }
  ],
  "notes": ["optional note"]
}
</blocks>

Rules:
- Return at most ${Math.max(5, maxItems)} rows.
- Keep rows factual and grounded in the page.
- If the page is not tabular, still extract the most useful structured list possible.
- Do not invent fields that are not supported by the page.`;
}

function formatProfile(profileData = {}) {
  const entries = Object.entries(profileData || {}).filter(([, value]) => String(value || '').trim());
  if (!entries.length) return 'None';
  return entries.map(([key, value]) => `- ${key}: ${String(value).trim()}`).join('\n');
}

