const form = document.querySelector('#run-form');
const error = document.querySelector('#form-error');
const status = document.querySelector('#status');
const title = document.querySelector('#run-title');
const summary = document.querySelector('#summary');
const findings = document.querySelector('#findings');
const artifacts = document.querySelector('#artifacts');
const functionalityCheck = form.elements.testFunctionality;
const flowInput = form.elements.flow;
let timer;

function syncFlowRequirement() { flowInput.required = functionalityCheck.checked; document.querySelector('#flow-label small').textContent = functionalityCheck.checked ? 'Required: add at least one test step.' : 'Required only when Functionality is checked.'; }
functionalityCheck.addEventListener('change', syncFlowRequirement);
syncFlowRequirement();

function render(run) {
  status.textContent = run.status;
  status.className = `badge ${run.status}`;
  title.textContent = run.url;
  summary.textContent = run.status === 'running' ? 'Browser is collecting evidence…' : run.error ? `Run error: ${run.error}` : `${run.findings.length} finding${run.findings.length === 1 ? '' : 's'} · ${run.steps.filter(s => s.status === 'passed').length} functional steps passed`;
  findings.innerHTML = run.findings.map(f => `<article class="finding ${f.severity}"><div><span class="tag">${f.category}</span><h3>${escapeHtml(f.title)}</h3></div><span class="severity">${f.severity}</span><p>${escapeHtml(f.description || '')}</p>${f.selector ? `<code>${escapeHtml(f.selector)}</code>` : ''}${f.rule ? `<small>${escapeHtml(f.rule)} · ${f.wcag?.join(', ') || 'manual review'}</small>` : ''}</article>`).join('') || (run.status === 'passed' ? '<p class="empty">No reportable issues were found by this run. Manual accessibility review is still required.</p>' : '');
  const aiPanel = run.ai?.summary ? `<article class="ai-panel"><p class="eyebrow">LOCAL AI TRIAGE · ${escapeHtml(run.ai.model)}</p><strong>${escapeHtml(run.ai.summary)}</strong><p><b>Likely causes:</b> ${escapeHtml((run.ai.likelyCauses || []).join(' · '))}</p><p><b>Next steps:</b> ${escapeHtml((run.ai.nextSteps || []).join(' · '))}</p></article>` : '';
  artifacts.innerHTML = aiPanel + run.artifacts.map(a => ['figma-overlay', 'wording-overlay'].includes(a.type) ? `<figure class="overlay"><img src="${a.url}" alt="Current page with red borders around detected differences"><figcaption>${escapeHtml(a.label)}</figcaption></figure>` : `<a class="artifact" href="${a.url}" target="_blank">View ${escapeHtml(a.label)}</a>`).join('');
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
async function poll(id) { const run = await fetch(`/api/runs/${id}`).then(r => r.json()); render(run); if (['queued','running'].includes(run.status)) timer = setTimeout(() => poll(id), 1000); }
form.addEventListener('submit', async event => {
  event.preventDefault(); clearTimeout(timer); error.textContent = '';
  const data = new FormData(form); let flow = [];
  try { flow = data.get('flow').trim() ? JSON.parse(data.get('flow')) : []; if (!Array.isArray(flow)) throw new Error('Flow must be a JSON array.'); } catch (e) { error.textContent = `Invalid flow: ${e.message}`; return; }
  const tests = { wording: data.get('testWording') === 'on', styleSpacing: data.get('testStyleSpacing') === 'on', functionality: data.get('testFunctionality') === 'on', accessibility: data.get('testAccessibility') === 'on' };
  if (!Object.values(tests).some(Boolean)) { error.textContent = 'Choose at least one test type.'; return; }
  if (tests.functionality && !flow.length) { error.textContent = 'Functionality testing needs at least one flow step.'; return; }
  const payload = { url: data.get('url'), dismissSelector: data.get('dismissSelector') || undefined, viewport: { width: Number(data.get('width')), height: Number(data.get('height')) }, figmaUrl: data.get('figmaUrl') || undefined, figmaToken: data.get('figmaToken') || undefined, visualThreshold: Number(data.get('visualThreshold')), baseline: data.get('baseline') === 'on', flow, tests, ai: { enabled: data.get('aiEnabled') === 'on', model: data.get('aiModel') || 'llama3.2' } };
  try { const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const run = await response.json(); if (!response.ok) throw new Error(run.error); render(run); poll(run.id); } catch (e) { error.textContent = e.message; }
});
