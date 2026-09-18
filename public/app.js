const form = document.querySelector('#run-form');
const error = document.querySelector('#form-error');
const status = document.querySelector('#status');
const title = document.querySelector('#run-title');
const summary = document.querySelector('#summary');
const findings = document.querySelector('#findings');
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
  summary.textContent = run.status === 'running' ? 'Browser is collecting evidence…' : run.error ? `Run error: ${run.error}` : `${run.findings.length} wording finding${run.findings.length === 1 ? '' : 's'}`;
  findings.innerHTML = run.findings.map(f => `<article class="finding ${f.severity}"><div><span class="tag">${escapeHtml(f.category)}</span><h3>${escapeHtml(f.title)}</h3></div><span class="severity">${escapeHtml(f.severity)}</span><p>${escapeHtml(f.description || '')}</p></article>`).join('') || (run.status === 'passed' ? '<p class="empty">No wording differences found.</p>' : '');
  const current = run.artifacts.find(a => a.type === 'screenshot');
  const figma = run.artifacts.find(a => a.type === 'figma-reference');
  setArtifactLink('current-render-link', current?.url, 'View current render');
  setArtifactLink('figma-reference-link', figma?.url || run.figmaUrl, 'View Figma references');
  const marked = run.artifacts.find(a => a.type === 'wording-overlay');
  overlay.innerHTML = marked ? `<figure class="overlay"><img src="${marked.url}" alt="Current page with red borders around wording differences"><figcaption>${escapeHtml(marked.label)}</figcaption></figure>` : '';
}
async function poll(id) { const run = await fetch(`/api/runs/${id}`).then(r => r.json()); render(run); if (['queued','running'].includes(run.status)) timer = setTimeout(() => poll(id), 1000); }
form.addEventListener('submit', async event => {
  event.preventDefault(); clearTimeout(timer); error.textContent = '';
  const data = new FormData(form);
  const payload = { url: data.get('url'), dismissSelector: data.get('dismissSelector') || undefined, figmaUrl: data.get('figmaUrl'), figmaToken: data.get('figmaToken') || undefined };
  try { const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const run = await response.json(); if (!response.ok) throw new Error(run.error); render(run); poll(run.id); } catch (e) { error.textContent = e.message; }
});
