const form = document.querySelector('#run-form');
const error = document.querySelector('#form-error');
const status = document.querySelector('#status');
const title = document.querySelector('#run-title');
const summary = document.querySelector('#summary');
const findings = document.querySelector('#findings');
const comparisons = document.querySelector('#comparisons');
const overlays = document.querySelector('#wording-overlay');
const scorePanel = document.querySelector('#score-panel');
const visualPanel = document.querySelector('#visual-panel');
const issuesPanel = document.querySelector('#issues-panel');
const visualCanvas = document.querySelector('#visual-canvas');
const issueList = document.querySelector('#issue-list');
const inspector = document.querySelector('#issue-inspector');
const severityFilter = document.querySelector('#severity-filter');
const categoryFilter = document.querySelector('#category-filter');
const opacityControl = document.querySelector('#opacity-control');
const opacity = document.querySelector('#overlay-opacity');
let timer, currentRun, selectedIssueId, visualView = 'side';

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value ?? ''; return div.innerHTML; }
function artifact(run, type) { return run.artifacts?.find(item => item.type === type); }
function setArtifactLink(id, url, label) {
  const old = document.querySelector(`#${id}`), element = document.createElement(url ? 'a' : 'span');
  element.id = id; element.className = `artifact${url ? '' : ' unavailable'}`; element.textContent = label;
  if (url) { element.href = url; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
  old.replaceWith(element);
}
function sentence(value) { return value.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase()); }

function renderScores(run) {
  scorePanel.hidden = !run.scores;
  if (!run.scores) return;
  document.querySelector('#overall-score').textContent = `${run.scores.overall}%`;
  document.querySelector('#score-confidence').textContent = `${run.scores.averageMatchConfidence}% average match confidence`;
  document.querySelector('#category-scores').innerHTML = Object.entries(run.scores.categories).map(([name, value]) => `<div class="score-item"><div><span>${escapeHtml(sentence(name))}</span><b>${value}%</b></div><meter min="0" max="100" value="${value}">${value}%</meter></div>`).join('');
  document.querySelector('#score-method').textContent = `${run.scores.calculation.method} Weights: ${Object.entries(run.scores.calculation.weights).map(([key, value]) => `${key} ${Math.round(value * 100)}%`).join(', ')}.`;
}

function renderVisual(run) {
  const figma = artifact(run, 'figma-normalized') || artifact(run, 'figma-reference');
  const website = artifact(run, 'screenshot');
  const diff = artifact(run, 'difference-map');
  visualPanel.hidden = !figma || !website;
  if (!figma || !website) return;
  opacityControl.hidden = visualView !== 'overlay';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === visualView));
  if (visualView === 'side') visualCanvas.innerHTML = `<div class="side-view"><figure class="comparison-image"><img src="${figma.url}" alt="Figma reference"><figcaption>Figma</figcaption></figure><figure class="comparison-image"><img src="${website.url}" alt="Website capture"><figcaption>Website</figcaption></figure></div>`;
  if (visualView === 'overlay') visualCanvas.innerHTML = `<div class="overlay-view"><img src="${figma.url}" alt="Figma reference"><img id="website-overlay-image" src="${website.url}" alt="Website overlay" style="opacity:${Number(opacity.value) / 100}"></div>`;
  if (visualView === 'diff') visualCanvas.innerHTML = diff ? `<div class="diff-view"><img src="${diff.url}" alt="Perceptual difference map"></div>` : '<p class="empty">Difference map unavailable.</p>';
}

function issueLocation(issue, run) {
  const image = artifact(run, 'screenshot');
  const region = issue.websiteRegion;
  if (!image || !region || !run.viewport) return '';
  const left = 100 * region.x / run.viewport.width, top = 100 * region.y / run.viewport.height;
  const width = 100 * region.width / run.viewport.width, height = 100 * region.height / run.viewport.height;
  return `<div class="issue-location inspection-image"><img src="${image.url}" alt="Issue location on website"><span style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></span></div>`;
}
function displayValue(value) {
  if (value === undefined) return '—';
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}
function measurementTable(issue) {
  const expected = issue.expected || {}, actual = issue.actual || {}, differences = issue.delta || {};
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual), ...Object.keys(differences)])];
  return `<div class="measure-table-wrap"><table class="measure-table"><thead><tr><th>Property</th><th>Figma</th><th>Website</th><th>Delta</th></tr></thead><tbody>${keys.map(key => `<tr><th>${escapeHtml(sentence(key))}</th><td>${escapeHtml(displayValue(expected[key]))}</td><td>${escapeHtml(displayValue(actual[key]))}</td><td>${escapeHtml(displayValue(differences[key]))}</td></tr>`).join('')}</tbody></table></div>`;
}
function spacingGuide(issue) {
  if (issue.category !== 'spacing') return '';
  const entry = Object.entries(issue.delta || {}).find(([, value]) => Number.isFinite(value) && value !== 0);
  if (!entry) return '';
  const [property, difference] = entry;
  const expected = Number(issue.expected?.[property]), actual = Number(issue.actual?.[property]);
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return '';
  const maximum = Math.max(Math.abs(expected), Math.abs(actual), 1);
  const expectedWidth = Math.max(4, Math.abs(expected) / maximum * 100);
  const actualWidth = Math.max(4, Math.abs(actual) / maximum * 100);
  return `<div class="spacing-guide"><h5>${escapeHtml(sentence(property))} measurement</h5>
    <div class="guide-row"><span>Figma</span><i><b style="width:${expectedWidth}%"></b></i><strong>${expected}px</strong></div>
    <div class="guide-row actual"><span>Website</span><i><b style="width:${actualWidth}%"></b></i><strong>${actual}px</strong></div>
    <p>Difference: <b>${difference > 0 ? '+' : ''}${difference}px</b></p></div>`;
}
function renderInspector(issue, run) {
  if (!issue) { inspector.innerHTML = '<p class="empty">Select an issue to inspect its measurements.</p>'; return; }
  inspector.innerHTML = `<h4>${escapeHtml(issue.title)}</h4><p class="confidence">${issue.confidence}% match confidence · ${escapeHtml(issue.status || 'confirmed')} · ${escapeHtml(issue.category)} · ${escapeHtml(issue.severity)}</p>
    <div class="fact-group"><h5>Measured fact</h5><p>${escapeHtml(issue.measured)}</p></div>${spacingGuide(issue)}
    <div class="fact-group"><h5>Expected, actual, and delta</h5>${measurementTable(issue)}</div>
    <div class="fact-group"><h5>Likely cause <small>inference</small></h5><p>${escapeHtml(issue.likelyCause)}</p></div>
    <div class="fact-group"><h5>Suggested investigation</h5><p>${escapeHtml(issue.investigation)}</p></div>${issueLocation(issue, run)}`;
}
function renderIssues(run) {
  const issues = run.issues || [];
  issuesPanel.hidden = !run.scores;
  if (!run.scores) return;
  const categories = [...new Set(issues.map(issue => issue.category))].sort();
  const selectedCategory = categoryFilter.value;
  categoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map(category => `<option value="${category}">${escapeHtml(sentence(category))}</option>`).join('');
  if (categories.includes(selectedCategory)) categoryFilter.value = selectedCategory;
  const filtered = issues.filter(issue => (severityFilter.value === 'all' || issue.severity === severityFilter.value) && (categoryFilter.value === 'all' || issue.category === categoryFilter.value));
  const counts = issues.reduce((result, issue) => ({ ...result, [issue.severity]: (result[issue.severity] || 0) + 1 }), {});
  document.querySelector('#issue-total').textContent = `${issues.length} issue${issues.length === 1 ? '' : 's'} · ${counts.critical || 0} critical · ${counts.major || 0} major · ${counts.minor || 0} minor`;
  issueList.innerHTML = filtered.map(issue => `<button class="issue-card ${issue.severity}${selectedIssueId === issue.id ? ' selected' : ''}" data-issue="${issue.id}"><div><strong>${escapeHtml(issue.title)}</strong><span class="pill">${escapeHtml(issue.status === 'needs-review' ? 'needs review' : issue.severity)}</span></div><p>${escapeHtml(issue.measured)} · ${issue.confidence}% confidence</p></button>`).join('') || '<p class="empty">No issues match these filters.</p>';
  issueList.querySelectorAll('[data-issue]').forEach(button => button.addEventListener('click', () => { selectedIssueId = button.dataset.issue; renderIssues(run); }));
  renderInspector(issues.find(issue => issue.id === selectedIssueId) || filtered[0], run);
}

function renderLegacy(run) {
  const designQA = run.testType === 'design-qa';
  findings.innerHTML = designQA ? '' : run.findings.map(finding => `<article class="finding ${finding.severity}"><div><h3>${escapeHtml(finding.title)}</h3><span class="severity">${escapeHtml(finding.severity)}</span></div><p>${escapeHtml(finding.description || '')}</p></article>`).join('');
  comparisons.hidden = designQA;
  comparisons.innerHTML = designQA ? '' : (run.comparisons || []).map(section => `<details class="comparison-section" open><summary>${escapeHtml(section.label)} · ${section.rows.length}</summary><table><thead><tr><th>Type</th><th>Figma</th><th>Website</th></tr></thead><tbody>${section.rows.map(row => `<tr><td>${escapeHtml(row.issue || row.kind)}</td><td>${escapeHtml(row.figma)}</td><td>${escapeHtml(row.website)}</td></tr>`).join('')}</tbody></table></details>`).join('');
  const marked = run.artifacts.filter(item => ['wording-overlay', 'figma-wording-overlay', 'style-spacing-overlay'].includes(item.type));
  overlays.innerHTML = designQA ? '' : marked.map(item => `<figure class="overlay"><img src="${item.url}" alt="${escapeHtml(item.label)}"><figcaption>${escapeHtml(item.label)}</figcaption></figure>`).join('');
}

function render(run) {
  currentRun = run;
  status.textContent = run.status; status.className = `badge ${run.status}`; title.textContent = run.url;
  const issueCount = run.issues?.length || (run.comparisons || []).reduce((count, section) => count + section.rows.length, 0);
  summary.textContent = run.status === 'queued' ? 'Waiting to start…' : run.status === 'running' ? 'Analyzing Figma, DOM, styles, geometry, and visual evidence…' : run.error ? `Run error: ${run.error}` : run.scores ? `${run.scores.overall}% overall alignment · ${issueCount} issue${issueCount === 1 ? '' : 's'} · ${run.matches?.length || 0} matched elements` : `${issueCount} difference${issueCount === 1 ? '' : 's'}`;
  renderScores(run); renderVisual(run); renderIssues(run); renderLegacy(run);
  setArtifactLink('current-render-link', artifact(run, 'screenshot')?.url, 'Website capture');
  setArtifactLink('figma-reference-link', artifact(run, 'figma-reference')?.url || run.figmaUrl, 'Figma reference');
}

async function poll(id) {
  const run = await fetch(`/api/runs/${id}`).then(response => response.json()); render(run);
  if (['queued', 'running'].includes(run.status)) timer = setTimeout(() => poll(id), 800);
}
const viewportPresets = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, mobile: { width: 390, height: 844 } };
const toleranceProfiles = {
  strict: { positionPx: 2, sizePx: 2, sizePercent: 0.02, spacingPx: 1, colorDistance: 10 },
  balanced: {}, relaxed: { positionPx: 8, sizePx: 8, sizePercent: 0.06, spacingPx: 4, colorDistance: 30 }
};
form.viewportPreset.addEventListener('change', () => { document.querySelector('.viewport-fields').hidden = form.viewportPreset.value !== 'custom'; });
form.addEventListener('submit', async event => {
  event.preventDefault(); clearTimeout(timer); error.textContent = ''; selectedIssueId = undefined;
  const data = new FormData(form), preset = data.get('viewportPreset');
  const viewport = preset === 'figma' ? undefined : preset === 'custom' ? { width: Number(data.get('viewportWidth')), height: Number(data.get('viewportHeight')) } : viewportPresets[preset];
  const payload = {
    testType: data.get('testType'), url: data.get('url'), figmaUrl: data.get('figmaUrl'),
    figmaToken: data.get('figmaToken') || undefined, dismissSelector: data.get('dismissSelector') || undefined,
    includeHeaderFooter: data.has('includeHeaderFooter'), viewport, thresholds: toleranceProfiles[data.get('tolerance')]
  };
  try {
    const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const run = await response.json(); if (!response.ok) throw new Error(run.error); render(run); poll(run.id);
  } catch (exception) { error.textContent = exception.message; }
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { visualView = button.dataset.view; if (currentRun) renderVisual(currentRun); }));
opacity.addEventListener('input', () => { const image = document.querySelector('#website-overlay-image'); if (image) image.style.opacity = Number(opacity.value) / 100; opacityControl.querySelector('output').textContent = `${opacity.value}%`; });
severityFilter.addEventListener('change', () => currentRun && renderIssues(currentRun));
categoryFilter.addEventListener('change', () => currentRun && renderIssues(currentRun));
