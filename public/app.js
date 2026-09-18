const form = document.querySelector('#run-form');
const error = document.querySelector('#form-error');
const status = document.querySelector('#status');
const title = document.querySelector('#run-title');
const summary = document.querySelector('#summary');
const findings = document.querySelector('#findings');
const comparisons = document.querySelector('#comparisons');
const overlay = document.querySelector('#wording-overlay');
let timer;

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function setArtifactLink(id, url, label) {
  const old = document.querySelector(`#${id}`);
  const element = document.createElement(url ? 'a' : 'span');
  element.id = id;
  element.className = `artifact${url ? '' : ' unavailable'}`;
  element.textContent = label;
  if (url) { element.href = url; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
  else element.setAttribute('aria-disabled', 'true');
  old.replaceWith(element);
}
function render(run) {
  status.textContent = run.status;
  status.className = `badge ${run.status}`;
  title.textContent = run.url;
  const differenceCount = (run.comparisons || []).reduce((count, section) => count + section.rows.length, 0);
  summary.textContent = run.status === 'queued' ? 'Waiting to start…' : run.status === 'running' ? 'Browser is collecting evidence…' : run.error ? `Run error: ${run.error}` : `${differenceCount} phrase difference${differenceCount === 1 ? '' : 's'} across ${(run.comparisons || []).length} section${(run.comparisons || []).length === 1 ? '' : 's'}`;
  findings.innerHTML = run.findings.map(f => `<article class="finding ${f.severity}"><div><span class="tag">${escapeHtml(f.category)}</span><h3>${escapeHtml(f.title)}</h3></div><span class="severity">${escapeHtml(f.severity)}</span><p>${escapeHtml(f.description || '')}</p></article>`).join('') || (run.status === 'passed' ? '<p class="empty">No wording differences found.</p>' : '');
  comparisons.innerHTML = (run.comparisons || []).map(section => `<details class="comparison-section" open><summary>${escapeHtml(section.label)} <span>${section.rows.length} difference${section.rows.length === 1 ? '' : 's'}</span></summary><div class="comparison-scroll"><table><thead><tr><th>Type</th><th>Figma phrase</th><th>Website phrase</th></tr></thead><tbody>${section.rows.map(row => `<tr class="${row.kind}"><td class="difference-type">${row.kind === 'added' ? 'Website only' : row.kind === 'missing' ? 'Figma only' : 'Changed'}</td><td>${row.figma ? escapeHtml(row.figma) : '<em>Not in Figma</em>'}</td><td>${row.website ? escapeHtml(row.website) : '<em>Not on website</em>'}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
  const current = run.artifacts.find(a => a.type === 'screenshot');
  const figma = run.artifacts.find(a => a.type === 'figma-reference');
  setArtifactLink('current-render-link', current?.url, 'View current render');
  setArtifactLink('figma-reference-link', figma?.url || run.figmaUrl, 'View Figma references');
  const marked = run.artifacts.find(a => a.type === 'wording-overlay');
  overlay.innerHTML = marked ? `<figure class="overlay"><img src="${marked.url}" alt="Current page with red borders around changed phrases"><figcaption>${escapeHtml(marked.label)}</figcaption></figure>` : '';
}
async function poll(id) { const run = await fetch(`/api/runs/${id}`).then(r => r.json()); render(run); if (['queued','running'].includes(run.status)) timer = setTimeout(() => poll(id), 1000); }
form.addEventListener('submit', async event => {
  event.preventDefault(); clearTimeout(timer); error.textContent = '';
  const data = new FormData(form);
  const payload = { url: data.get('url'), dismissSelector: data.get('dismissSelector') || undefined, figmaUrl: data.get('figmaUrl'), figmaToken: data.get('figmaToken') || undefined, includeHeaderFooter: data.has('includeHeaderFooter') };
  try { const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const run = await response.json(); if (!response.ok) throw new Error(run.error); render(run); poll(run.id); } catch (e) { error.textContent = e.message; }
});
