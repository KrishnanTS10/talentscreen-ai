// ── TalentScreen AI — App Logic v2.0 ──

// ── NAV ──
function switchTab(id) {
  ['screener', 'questions', 'pipeline'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === id);
    document.getElementById('panel-' + t).classList.toggle('active', t === id);
  });
}

// ── FILE UTILS ──
function readAsText(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsText(f);
  });
}

async function extractPDF(f) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF reader loading — retry in a moment');
  const buf = await f.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map(it => it.str).join(' ') + '\n';
  }
  if (!out.trim()) throw new Error('No readable text found in PDF');
  return out;
}

async function extractDOCX(f) {
  if (typeof mammoth === 'undefined') throw new Error('DOCX reader loading — retry in a moment');
  const buf = await f.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  if (!result.value.trim()) throw new Error('No readable text in DOCX');
  return result.value;
}

async function extractFile(f) {
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return extractPDF(f);
  if (n.endsWith('.docx') || n.endsWith('.doc')) return extractDOCX(f);
  return readAsText(f);
}

// ── CLAUDE API ──

// ── TOKEN OPTIMISATION: Clean extracted text before sending to API ──
function cleanText(text, maxChars) {
  return text
    .replace(/\s{3,}/g, ' ')          // collapse 3+ spaces
    .replace(/\n{3,}/g, '\n\n')       // collapse 3+ newlines
    .replace(/[^\x20-\x7E\n]/g, ' ') // strip non-printable chars
    .replace(/\t/g, ' ')               // tabs to spaces
    .trim()
    .substring(0, maxChars);
}

// Dynamic max_tokens: scale with content
function calcMaxTokens(numCandidates) {
  // ~180 tokens per candidate output + 300 buffer
  return Math.min(300 + (numCandidates * 180), 3000);
}

function calcQMaxTokens(numQuestions) {
  // ~80 tokens per question + 100 buffer
  return Math.min(100 + (numQuestions * 80), 1800);
}

async function callClaude(prompt, maxTokens = 1000) {
  const apiKey = localStorage.getItem('ts_api_key');
  if (!apiKey) throw new Error('No API key found. Please add your Anthropic API key via the setup link on the login page.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `API error ${res.status}`);
  return data.content.map(c => c.text || '').join('');
}

// ══════════════════════════════════════════
// TOOL 1: CV SCREENER
// ══════════════════════════════════════════
const jdState = { text: '' };
const cvList = [];
const MAX_CVS = 10;
let lastScreenResults = [];

function onJDPaste() {
  jdState.text = document.getElementById('jdText').value.trim();
  const box = document.getElementById('jdBox');
  const st = document.getElementById('jdStatus');
  if (jdState.text) {
    box.classList.add('has-file');
    st.innerHTML = '<span class="pill pill-green"><i class="ti ti-check" style="font-size:11px"></i>Text ready</span>';
  } else {
    box.classList.remove('has-file');
    st.innerHTML = '';
  }
}

async function handleJD(input) {
  const file = input.files[0];
  if (!file) return;
  const st = document.getElementById('jdStatus');
  const box = document.getElementById('jdBox');
  st.innerHTML = '<span class="pill pill-green"><div class="spinner-dark"></div>Reading…</span>';
  try {
    jdState.text = await extractFile(file);
    box.classList.add('has-file');
    document.getElementById('jdText').value = '';
    const short = file.name.length > 28 ? file.name.substring(0, 25) + '…' : file.name;
    st.innerHTML = `<span class="pill pill-green"><i class="ti ti-check" style="font-size:11px"></i>${short}</span>`;
  } catch (e) {
    st.innerHTML = `<span class="pill pill-orange"><i class="ti ti-alert-circle" style="font-size:11px"></i>${e.message}</span>`;
  }
}

async function handleCVs(input) {
  const files = Array.from(input.files);
  const slots = MAX_CVS - cvList.length;
  const toProcess = files.slice(0, slots);
  const errEl = document.getElementById('s1err');
  if (files.length > slots) {
    errEl.innerHTML = `<div class="alert alert-warning"><i class="ti ti-alert-triangle" style="font-size:14px"></i>Only ${slots} slot(s) remaining — first ${slots} added.</div>`;
  } else { errEl.innerHTML = ''; }
  for (const file of toProcess) {
    const id = Date.now() + Math.random();
    const entry = { id, name: file.name, text: null, status: 'reading' };
    cvList.push(entry);
    renderCVQueue();
    try {
      entry.text = await extractFile(file);
      entry.status = 'ready';
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message;
    }
    renderCVQueue();
  }
  input.value = '';
}

function removeCV(id) {
  const idx = cvList.findIndex(c => c.id === id);
  if (idx > -1) cvList.splice(idx, 1);
  renderCVQueue();
  document.getElementById('s1err').innerHTML = '';
}

function clearCVs() {
  cvList.length = 0;
  renderCVQueue();
  document.getElementById('s1err').innerHTML = '';
}

function renderCVQueue() {
  const q = document.getElementById('cvQueue');
  document.getElementById('cvCountPill').textContent = `${cvList.length}/${MAX_CVS}`;
  if (!cvList.length) { q.innerHTML = ''; return; }
  q.innerHTML = cvList.map((c, i) => {
    const short = c.name.length > 32 ? c.name.substring(0, 29) + '…' : c.name;
    const statusHtml = c.status === 'reading'
      ? '<div class="spinner-dark"></div>'
      : c.status === 'error'
      ? `<i class="ti ti-alert-circle" style="font-size:14px;color:#E24B4A" title="${c.error}"></i>`
      : '<i class="ti ti-check" style="font-size:14px;color:#0F6E56"></i>';
    return `<div class="cv-item">
      <div class="cv-num">${i + 1}</div>
      <div class="cv-name">${short}</div>
      ${statusHtml}
      <button class="cv-remove" onclick="removeCV(${c.id})" aria-label="Remove">
        <i class="ti ti-x" style="font-size:13px"></i>
      </button>
    </div>`;
  }).join('');
  document.getElementById('addMoreBtn').style.display = cvList.length >= MAX_CVS ? 'none' : 'flex';
}

async function screenAll() {
  const jd = jdState.text || document.getElementById('jdText').value.trim();
  const readyCVs = cvList.filter(c => c.status === 'ready');
  const errEl = document.getElementById('s1err');
  const btn = document.getElementById('screenBtn');
  const resultEl = document.getElementById('screenResult');

  if (!jd) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please provide a job description.</div>'; return; }
  if (!readyCVs.length) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please upload at least one CV.</div>'; return; }

  errEl.innerHTML = '';
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Screening candidates…';
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="alert alert-info"><div class="spinner-dark"></div>&nbsp;Analysing ' + readyCVs.length + ' candidate(s) — this may take a moment…</div>';

  const cvSections = readyCVs.map((c, i) =>
    `--- CANDIDATE ${i + 1}: ${c.name.replace(/\.[^.]+$/, '')} ---\n${cleanText(c.text, 800)}`
  ).join('\n\n');

  const dynamicTokens = calcMaxTokens(readyCVs.length);
  const prompt = `Rank ${readyCVs.length} candidates against this JD. Return JSON only:
{"candidates":[{"name":"","score":0-100,"verdict":"Strong/Good/Partial/Weak Match","sub_scores":{"skills_match":0-30,"experience_level":0-25,"industry_fit":0-20,"location_fit":0-15,"qualifications":0-10},"matched_skills":[],"missing_skills":[],"summary":"2 sentences"}]}
JD: ${cleanText(jd, 1200)}
CVS: ${cvSections}`;

  try {
    const raw = await callClaude(prompt, dynamicTokens);
    const clean = raw.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    lastScreenResults = data.candidates || [];
    renderScreenResults(lastScreenResults);
  } catch (e) {
    resultEl.innerHTML = `<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>${e.message}</div>`;
  }
  btn.innerHTML = '<i class="ti ti-search" style="font-size:15px"></i> Screen candidates';
  btn.disabled = false;
}

// ── IMPROVEMENT 1: Score Breakdown + IMPROVEMENT 3: Side-by-side compare ──
let compareSet = new Set();

function toggleCompare(name) {
  if (compareSet.has(name)) {
    compareSet.delete(name);
  } else {
    if (compareSet.size >= 3) {
      alert('You can compare up to 3 candidates at a time.');
      return;
    }
    compareSet.add(name);
  }
  renderScreenResults(lastScreenResults);
}

function renderScreenResults(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const resultEl = document.getElementById('screenResult');
  resultEl.style.display = 'block';

  const barColor = s => s >= 75 ? '#1D9E75' : s >= 55 ? '#378ADD' : s >= 35 ? '#F0A500' : '#E24B4A';
  const rankStyle = i => i === 0 ? 'background:#EF9F27;color:#412402' : i === 1 ? 'background:#B4B2A9;color:#2C2C2A' : i === 2 ? 'background:#97C459;color:#173404' : 'background:#EEE;color:#666';
  const verdictColor = v => {
    if (v === 'Strong Match') return '#EAF3DE;color:#085041';
    if (v === 'Good Match') return '#E6F1FB;color:#185FA5';
    if (v === 'Partial Match') return '#FEF3DC;color:#7A4A00';
    return '#FCEBEB;color:#8B1A1A';
  };

  const subLabels = { skills_match: 'Skills Match', experience_level: 'Experience', industry_fit: 'Industry Fit', location_fit: 'Location Fit', qualifications: 'Qualifications' };
  const subMax = { skills_match: 30, experience_level: 25, industry_fit: 20, location_fit: 15, qualifications: 10 };

  const compareBtn = compareSet.size >= 2
    ? `<button onclick="showComparison()" style="display:flex;align-items:center;gap:6px;padding:8px 16px;background:#0F6E56;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif"><i class="ti ti-columns" style="font-size:14px"></i>Compare ${compareSet.size} candidates</button>`
    : '';

  resultEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:0.5px solid #E2EDE8;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:600;color:#0F6E56">
        <i class="ti ti-trophy" style="font-size:14px;vertical-align:-2px;margin-right:6px"></i>
        ${sorted.length} Candidate${sorted.length > 1 ? 's' : ''} Ranked
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${compareBtn}
        <button onclick="addAllToPipeline()" style="display:flex;align-items:center;gap:6px;padding:8px 16px;background:#EAF3DE;color:#085041;border:0.5px solid #C0DD97;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif">
          <i class="ti ti-layout-kanban" style="font-size:14px"></i>Add all to Pipeline
        </button>
        <button onclick="exportPDFReport()" style="display:flex;align-items:center;gap:6px;padding:8px 16px;background:#E6F1FB;color:#185FA5;border:0.5px solid #B3D4F5;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif">
          <i class="ti ti-file-download" style="font-size:14px"></i>Download PDF Report
        </button>
      </div>
    </div>
    ${sorted.length > 1 ? `<div style="font-size:11px;color:#5A7A6A;margin-bottom:12px"><i class="ti ti-info-circle" style="font-size:12px;vertical-align:-1px;margin-right:4px"></i>Tick up to 3 candidates to compare side by side</div>` : ''}
    ${sorted.map((c, i) => {
      const ss = c.sub_scores || {};
      const isCompared = compareSet.has(c.name);
      return `
      <div style="background:#fff;border:${isCompared ? '2px solid #1D9E75' : '0.5px solid #E2EDE8'};border-radius:12px;padding:16px;margin-bottom:12px;transition:border 0.15s">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
          <div style="width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:700;${rankStyle(i)}">${i+1}</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:14px;font-weight:700;color:#1A2E25">${c.name}</span>
              <span style="font-size:11px;font-weight:500;padding:2px 9px;border-radius:20px;background:${verdictColor(c.verdict)}">${c.verdict}</span>
              ${sorted.length > 1 ? `<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#5A7A6A;cursor:pointer;margin-left:auto">
                <input type="checkbox" ${isCompared ? 'checked' : ''} onchange="toggleCompare('${c.name}')" style="accent-color:#1D9E75"> Compare
              </label>` : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:26px;font-weight:700;color:#0F6E56;line-height:1">${c.score}</div>
            <div style="font-size:10px;color:#5A7A6A">/ 100</div>
          </div>
        </div>

        <div style="height:6px;background:#EEE;border-radius:4px;margin-bottom:12px;overflow:hidden">
          <div style="height:100%;width:${c.score}%;background:${barColor(c.score)};border-radius:4px;transition:width 0.5s ease"></div>
        </div>

        ${Object.keys(subLabels).map(k => {
          const val = ss[k] || 0;
          const max = subMax[k];
          const pct = Math.round((val / max) * 100);
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <div style="font-size:10px;color:#5A7A6A;width:100px;flex-shrink:0">${subLabels[k]}</div>
            <div style="flex:1;height:4px;background:#EEE;border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${barColor(pct)};border-radius:4px"></div>
            </div>
            <div style="font-size:10px;font-weight:600;color:#0F6E56;width:36px;text-align:right">${val}/${max}</div>
          </div>`;
        }).join('')}

        <p style="font-size:13px;color:#5A7A6A;margin:10px 0 8px;line-height:1.6">${c.summary}</p>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px">
          ${(c.matched_skills||[]).map(s=>`<span style="font-size:11px;padding:2px 9px;border-radius:20px;background:#EAF3DE;color:#085041">${s}</span>`).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${(c.missing_skills||[]).map(s=>`<span style="font-size:11px;padding:2px 9px;border-radius:20px;background:#FCEBEB;color:#8B1A1A">${s}</span>`).join('')}
        </div>
      </div>`;
    }).join('')}`;
}

// ── IMPROVEMENT 3: Side-by-Side Comparison Modal ──
function showComparison() {
  const selected = lastScreenResults.filter(c => compareSet.has(c.name));
  const barColor = s => s >= 75 ? '#1D9E75' : s >= 55 ? '#378ADD' : s >= 35 ? '#F0A500' : '#E24B4A';
  const subLabels = { skills_match: 'Skills Match', experience_level: 'Experience', industry_fit: 'Industry Fit', location_fit: 'Location Fit', qualifications: 'Qualifications' };
  const subMax = { skills_match: 30, experience_level: 25, industry_fit: 20, location_fit: 15, qualifications: 10 };

  const modal = document.createElement('div');
  modal.id = 'compareModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div style="font-size:16px;font-weight:700;color:#0F6E56"><i class="ti ti-columns" style="font-size:16px;vertical-align:-2px;margin-right:8px"></i>Candidate Comparison</div>
        <button onclick="document.getElementById('compareModal').remove()" style="background:none;border:none;cursor:pointer;font-size:20px;color:#5A7A6A">×</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${selected.length},1fr);gap:16px">
        ${selected.map((c, i) => `
          <div style="background:#F7FAF8;border-radius:12px;padding:16px">
            <div style="font-size:13px;font-weight:700;color:#1A2E25;margin-bottom:4px">${c.name}</div>
            <div style="font-size:28px;font-weight:700;color:#0F6E56;margin-bottom:8px">${c.score}<span style="font-size:14px;color:#5A7A6A">/100</span></div>
            <div style="height:6px;background:#E2EDE8;border-radius:4px;margin-bottom:12px;overflow:hidden">
              <div style="height:100%;width:${c.score}%;background:${barColor(c.score)};border-radius:4px"></div>
            </div>
            ${Object.keys(subLabels).map(k => {
              const val = (c.sub_scores||{})[k] || 0;
              const max = subMax[k];
              const pct = Math.round((val/max)*100);
              return `<div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
                  <span style="color:#5A7A6A">${subLabels[k]}</span>
                  <span style="font-weight:600;color:#0F6E56">${val}/${max}</span>
                </div>
                <div style="height:5px;background:#E2EDE8;border-radius:4px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${barColor(pct)};border-radius:4px"></div>
                </div>
              </div>`;
            }).join('')}
            <div style="margin-top:10px">
              <div style="font-size:10px;font-weight:600;color:#0F6E56;margin-bottom:5px">✓ MATCHED</div>
              ${(c.matched_skills||[]).map(s=>`<span style="display:inline-block;font-size:10px;padding:2px 7px;border-radius:20px;background:#EAF3DE;color:#085041;margin:2px">${s}</span>`).join('')}
            </div>
            <div style="margin-top:8px">
              <div style="font-size:10px;font-weight:600;color:#E24B4A;margin-bottom:5px">✗ MISSING</div>
              ${(c.missing_skills||[]).map(s=>`<span style="display:inline-block;font-size:10px;padding:2px 7px;border-radius:20px;background:#FCEBEB;color:#8B1A1A;margin:2px">${s}</span>`).join('')}
            </div>
            <p style="font-size:11px;color:#5A7A6A;margin-top:10px;line-height:1.5">${c.summary}</p>
          </div>
        `).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── IMPROVEMENT 4: Add All to Pipeline ──
function addAllToPipeline() {
  if (!lastScreenResults.length) return;
  let added = 0;
  lastScreenResults.forEach(c => {
    if (!pCandidates.find(p => p.name === c.name)) {
      pCandidates.push({
        id: Date.now() + Math.random(),
        name: c.name,
        score: c.score,
        stage: 'Applied',
        date: todayStr(),
        notes: `${c.verdict} — ${(c.matched_skills||[]).slice(0,3).join(', ')}`
      });
      added++;
    }
  });
  pCandidates.sort((a, b) => b.score - a.score);
  renderPipeline();
  const btn = event.target.closest('button');
  btn.innerHTML = `<i class="ti ti-check" style="font-size:14px"></i>${added} added to Pipeline`;
  btn.style.background = '#EAF3DE';
  btn.style.color = '#085041';
  setTimeout(() => {
    btn.innerHTML = '<i class="ti ti-layout-kanban" style="font-size:14px"></i>Add all to Pipeline';
    btn.style.background = '#EAF3DE';
  }, 2000);
  setTimeout(() => switchTab('pipeline'), 1500);
}

// ── IMPROVEMENT 1: PDF Report Export ──
function exportPDFReport() {
  if (!lastScreenResults.length) return;
  const sorted = [...lastScreenResults].sort((a, b) => b.score - a.score);
  const barColor = s => s >= 75 ? '#1D9E75' : s >= 55 ? '#378ADD' : s >= 35 ? '#F0A500' : '#E24B4A';
  const verdictColor = v => v === 'Strong Match' ? '#085041' : v === 'Good Match' ? '#185FA5' : v === 'Partial Match' ? '#7A4A00' : '#8B1A1A';
  const subLabels = { skills_match: 'Skills Match', experience_level: 'Experience', industry_fit: 'Industry Fit', location_fit: 'Location Fit', qualifications: 'Qualifications' };
  const subMax = { skills_match: 30, experience_level: 25, industry_fit: 20, location_fit: 15, qualifications: 10 };

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>TalentScreen AI — Screening Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1A2E25; margin: 0; padding: 0; }
    .header { background: #0F6E56; color: white; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 4px 0 0; font-size: 12px; opacity: 0.7; }
    .content { padding: 24px 32px; }
    .candidate { border: 1px solid #E2EDE8; border-radius: 10px; padding: 16px; margin-bottom: 16px; page-break-inside: avoid; }
    .cand-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .cand-name { font-size: 15px; font-weight: 700; }
    .score { font-size: 26px; font-weight: 700; color: #0F6E56; }
    .score-bar { height: 6px; background: #EEE; border-radius: 4px; margin-bottom: 10px; }
    .score-fill { height: 100%; border-radius: 4px; }
    .sub-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .sub-label { font-size: 10px; color: #5A7A6A; width: 100px; }
    .sub-bar { flex: 1; height: 4px; background: #EEE; border-radius: 4px; overflow: hidden; }
    .sub-fill { height: 100%; border-radius: 4px; }
    .sub-val { font-size: 10px; font-weight: 700; width: 30px; text-align: right; color: #0F6E56; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .tag { font-size: 10px; padding: 2px 8px; border-radius: 20px; }
    .tag-green { background: #EAF3DE; color: #085041; }
    .tag-red { background: #FCEBEB; color: #8B1A1A; }
    .summary { font-size: 12px; color: #5A7A6A; margin-top: 8px; line-height: 1.5; }
    .verdict { font-size: 11px; padding: 2px 9px; border-radius: 20px; display: inline-block; margin-top: 2px; }
    .footer { text-align: center; padding: 16px; font-size: 10px; color: #5A7A6A; border-top: 1px solid #E2EDE8; }
    .rank { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-right: 8px; }
  </style></head><body>
  <div class="header">
    <h1>🎯 TalentScreen AI — Screening Report</h1>
    <p>Generated on ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })} · ${sorted.length} candidates screened</p>
  </div>
  <div class="content">
    ${sorted.map((c, i) => {
      const rankColors = ['background:#EF9F27;color:#412402', 'background:#B4B2A9;color:#2C2C2A', 'background:#97C459;color:#173404', 'background:#EEE;color:#666'];
      return `<div class="candidate">
        <div class="cand-header">
          <div>
            <span class="rank" style="${rankColors[Math.min(i,3)]}">${i+1}</span>
            <span class="cand-name">${c.name}</span>
            <div style="margin-top:4px;margin-left:36px">
              <span class="verdict" style="background:${c.verdict==='Strong Match'?'#EAF3DE':c.verdict==='Good Match'?'#E6F1FB':c.verdict==='Partial Match'?'#FEF3DC':'#FCEBEB'};color:${verdictColor(c.verdict)}">${c.verdict}</span>
            </div>
          </div>
          <div style="text-align:right"><div class="score">${c.score}<span style="font-size:13px;color:#5A7A6A">/100</span></div></div>
        </div>
        <div class="score-bar"><div class="score-fill" style="width:${c.score}%;background:${barColor(c.score)}"></div></div>
        ${Object.keys(subLabels).map(k => {
          const val = (c.sub_scores||{})[k]||0;
          const max = subMax[k];
          return `<div class="sub-row">
            <div class="sub-label">${subLabels[k]}</div>
            <div class="sub-bar"><div class="sub-fill" style="width:${Math.round(val/max*100)}%;background:${barColor(Math.round(val/max*100))}"></div></div>
            <div class="sub-val">${val}/${max}</div>
          </div>`;
        }).join('')}
        <p class="summary">${c.summary}</p>
        <div class="tags">
          ${(c.matched_skills||[]).map(s=>`<span class="tag tag-green">✓ ${s}</span>`).join('')}
          ${(c.missing_skills||[]).map(s=>`<span class="tag tag-red">✗ ${s}</span>`).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>
  <div class="footer">TalentScreen AI · Beta v2.0 · Built for volume hiring · Confidential</div>
  <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// ══════════════════════════════════════════
// TOOL 2: INTERVIEW QUESTIONS
// ══════════════════════════════════════════
let selQty = 10;
const activeTypes = new Set(['behavioural', 'situational', 'technical']);

function onRoleChange() {
  document.getElementById('customRoleGroup').style.display =
    document.getElementById('roleSelect').value === 'custom' ? 'flex' : 'none';
}

function toggleType(t) {
  const card = document.getElementById('type-' + t);
  if (activeTypes.has(t)) {
    if (activeTypes.size === 1) return;
    activeTypes.delete(t);
    card.classList.remove('active');
  } else {
    activeTypes.add(t);
    card.classList.add('active');
  }
}

function setQty(n) {
  selQty = n;
  document.querySelectorAll('.qty-chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.textContent) === n);
  });
}

async function generateQs() {
  const rv = document.getElementById('roleSelect').value;
  const cr = document.getElementById('customRole').value.trim();
  const errEl = document.getElementById('s2err');
  const btn = document.getElementById('genBtn');
  const resultEl = document.getElementById('qResult');

  if (!rv) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please select a role.</div>'; return; }
  if (rv === 'custom' && !cr) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please type the role name.</div>'; return; }
  errEl.innerHTML = '';

  const role = rv === 'custom' ? cr : rv;
  const jd = document.getElementById('q2jd').value.trim();
  const seniority = document.getElementById('senioritySelect').value;
  const types = Array.from(activeTypes).join(', ');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="alert alert-info"><div class="spinner-dark"></div>&nbsp;Generating ' + selQty + ' questions…</div>';

  const qTokens = calcQMaxTokens(selQty);
  const prompt = `Generate ${selQty} HR interview questions. Role: ${role}, Level: ${seniority}, Types: ${types}.
${jd ? `JD: ${cleanText(jd, 1000)}` : ''}
JSON only: {"questions":[{"number":1,"type":"Behavioural","question":"","what_to_listen_for":""}]}`;

  try {
    const raw = await callClaude(prompt, qTokens);
    const clean = raw.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    renderQuestions(data.questions || [], role, seniority);
  } catch (e) {
    resultEl.innerHTML = `<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>${e.message}</div>`;
  }
  btn.innerHTML = '<i class="ti ti-wand" style="font-size:15px"></i> Generate questions';
  btn.disabled = false;
}

function renderQuestions(questions, role, seniority) {
  const resultEl = document.getElementById('qResult');
  resultEl.style.display = 'block';
  const typeColor = t => t === 'Behavioural' ? '#EAF3DE;color:#085041' : t === 'Situational' ? '#E6F1FB;color:#185FA5' : '#EEEDFE;color:#534AB7';

  resultEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:0.5px solid #E2EDE8">
      <div style="font-size:13px;font-weight:600;color:#0F6E56">
        <i class="ti ti-list-check" style="font-size:14px;vertical-align:-2px;margin-right:6px"></i>
        ${questions.length} Questions — ${role} | ${seniority}
      </div>
      <button onclick="copyQuestions()" style="display:flex;align-items:center;gap:5px;padding:6px 12px;background:#fff;border:0.5px solid #C0DD97;border-radius:8px;font-size:11px;color:#0F6E56;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
        <i class="ti ti-copy" style="font-size:13px"></i>Copy all
      </button>
    </div>
    <div id="questionsList">
      ${questions.map(q => `
        <div style="background:#fff;border:0.5px solid #E2EDE8;border-radius:12px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:22px;height:22px;border-radius:50%;background:#EAF3DE;color:#085041;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${q.number}</div>
            <span style="font-size:11px;font-weight:500;padding:2px 8px;border-radius:20px;background:${typeColor(q.type)}">${q.type}</span>
          </div>
          <div style="font-size:14px;color:#1A2E25;font-weight:500;margin-bottom:6px;line-height:1.5">${q.question}</div>
          ${q.what_to_listen_for ? `<div style="font-size:12px;color:#5A7A6A;font-style:italic;padding:6px 10px;background:#F7FAF8;border-radius:8px;border-left:2px solid #C0DD97"><i class="ti ti-ear" style="font-size:12px;vertical-align:-1px;margin-right:4px"></i>${q.what_to_listen_for}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function copyQuestions() {
  const items = document.querySelectorAll('#questionsList > div');
  let text = '';
  items.forEach((item, i) => {
    const q = item.querySelector('div[style*="font-weight:500"]')?.textContent || '';
    text += `${i + 1}. ${q}\n\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('[onclick="copyQuestions()"]');
    if (btn) { btn.innerHTML = '<i class="ti ti-check" style="font-size:13px"></i>Copied!'; setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy" style="font-size:13px"></i>Copy all'; }, 2000); }
  });
}

// ══════════════════════════════════════════
// TOOL 3: PIPELINE
// ══════════════════════════════════════════
const PIPELINE_STAGES = ['Applied', 'Screening', 'Shortlisted', 'Interview R1', 'Interview R2', 'Interview R3', 'BG Check', 'Offer', 'Joining', 'Hired', 'Rejected'];
const REJECTION_REASONS = ['Overqualified', 'Underqualified', 'Salary Mismatch', 'Culture Fit', 'Better Candidate Selected', 'Role Cancelled', 'Candidate Withdrew', 'Failed Assessment', 'Failed Background Check', 'Other'];
let privacyOn = true;
let listVisible = false;
const pCandidates = [];

function togglePrivacy() {
  privacyOn = !privacyOn;
  document.getElementById('privacyIcon').className = privacyOn ? 'ti ti-eye-off' : 'ti ti-eye';
  document.getElementById('privacyLabel').textContent = privacyOn ? 'Privacy on' : 'Privacy off';
  const banner = document.getElementById('privacyBanner');
  if (banner) banner.style.display = privacyOn ? 'flex' : 'none';
  renderPipeline();
}

function toggleList() {
  listVisible = !listVisible;
  document.getElementById('tableSection').classList.toggle('collapsed', !listVisible);
  document.getElementById('listLabel').textContent = listVisible ? 'Hide' : 'Show';
  document.getElementById('listChevron').classList.toggle('open', listVisible);
}

function initials(n) { return n.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(); }
function maskName(n) { return n.split(' ').map(p => p[0] + '•'.repeat(Math.min(p.length - 1, 4))).join(' '); }

function stageColor(s) {
  const m = {
    'Applied':'background:#E6F1FB;color:#185FA5','Screening':'background:#FAEEDA;color:#854F0B',
    'Shortlisted':'background:#E1F5EE;color:#0F6E56','Interview R1':'background:#EEEDFE;color:#534AB7',
    'Interview R2':'background:#AFA9EC;color:#26215C','Interview R3':'background:#7F77DD;color:#fff',
    'BG Check':'background:#FBEAF0;color:#993556','Offer':'background:#EAF3DE;color:#3B6D11',
    'Joining':'background:#9FE1CB;color:#04342C','Hired':'background:#C0DD97;color:#085041',
    'Rejected':'background:#FCEBEB;color:#8B1A1A'
  };
  return m[s] || '';
}

function rankBadge(i) {
  const styles = ['background:#EF9F27;color:#412402','background:#B4B2A9;color:#2C2C2A','background:#97C459;color:#173404'];
  const style = styles[i] || 'background:#EEE;color:#666';
  return `<span style="font-size:10px;font-weight:600;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;${style}">${i + 1}</span>`;
}

function todayStr() {
  const d = new Date();
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
}

// ── IMPROVEMENT 5: Days in Stage ──
function daysSince(dateStr) {
  if (!dateStr) return 0;
  const [d, m, y] = dateStr.split('/').map(Number);
  const diff = Date.now() - new Date(y, m - 1, d).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function daysInStageBadge(c) {
  const days = daysSince(c.stageDate || c.date);
  const isInterview = c.stage.startsWith('Interview');
  const warn = isInterview && days > 7;
  const color = warn ? '#FCEBEB;color:#8B1A1A' : days > 14 ? '#FEF3DC;color:#7A4A00' : '#F0F0F0;color:#555';
  return `<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:${color};white-space:nowrap" title="Days in current stage">
    ${warn ? '⚠ ' : ''}${days}d
  </span>`;
}

function addCandidate() {
  const name = document.getElementById('p-name').value.trim();
  const score = parseInt(document.getElementById('p-score').value) || 0;
  const stage = document.getElementById('p-stage').value;
  const notes = document.getElementById('p-notes').value.trim();
  if (!name) { alert('Please enter a candidate name.'); return; }
  pCandidates.push({ id: Date.now(), name, score, stage, date: todayStr(), stageDate: todayStr(), notes });
  pCandidates.sort((a, b) => b.score - a.score);
  document.getElementById('p-name').value = '';
  document.getElementById('p-score').value = '';
  document.getElementById('p-notes').value = '';
  renderPipeline();
}

function removePCandidate(id) {
  const idx = pCandidates.findIndex(c => c.id === id);
  if (idx > -1) pCandidates.splice(idx, 1);
  renderPipeline();
}

function updatePStage(id, s) {
  const c = pCandidates.find(c => c.id === id);
  if (!c) return;
  if (s === 'Rejected') {
    showRejectModal(id);
    // Reset dropdown to current stage visually
    const sel = document.querySelector(`select[onchange="updatePStage(${id},this.value)"]`);
    if (sel) sel.value = c.stage;
    return;
  }
  c.stage = s;
  c.stageDate = todayStr();
  c.rejectionReason = '';
  renderPipeline();
}

function showRejectModal(id) {
  const c = pCandidates.find(c => c.id === id);
  if (!c) return;
  const existing = document.getElementById('rejectModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'rejectModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.25)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:36px;height:36px;border-radius:50%;background:#FCEBEB;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="ti ti-user-x" style="font-size:18px;color:#E24B4A"></i>
        </div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#1A2E25">Reject candidate</div>
          <div style="font-size:12px;color:#5A7A6A">${c.name}</div>
        </div>
      </div>
      <p style="font-size:13px;color:#5A7A6A;margin:12px 0 16px;line-height:1.5">This will move the candidate to the Rejected section. Please select a reason.</p>
      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:600;color:#8B1A1A;display:block;margin-bottom:6px;letter-spacing:0.3px">REASON FOR REJECTION</label>
        <select id="rejectReasonSelect" style="width:100%;padding:10px 12px;font-size:13px;font-family:'DM Sans',sans-serif;border:1.5px solid #F09595;border-radius:10px;color:#1A2E25;background:#fff;cursor:pointer;outline:none">
          <option value="">— Select a reason —</option>
          ${REJECTION_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('rejectModal').remove()" style="flex:1;padding:10px;background:#F7FAF8;border:0.5px solid #E2EDE8;border-radius:10px;font-size:13px;font-weight:500;color:#5A7A6A;cursor:pointer;font-family:'DM Sans',sans-serif">Cancel</button>
        <button onclick="confirmReject(${id})" style="flex:1;padding:10px;background:#E24B4A;border:none;border-radius:10px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;font-family:'DM Sans',sans-serif">Confirm Rejection</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function confirmReject(id) {
  const reason = document.getElementById('rejectReasonSelect').value;
  if (!reason) { alert('Please select a rejection reason.'); return; }
  const c = pCandidates.find(c => c.id === id);
  if (c) {
    c.stage = 'Rejected';
    c.stageDate = todayStr();
    c.rejectionReason = reason;
  }
  document.getElementById('rejectModal').remove();
  renderPipeline();
}

function restoreCandidate(id) {
  const c = pCandidates.find(c => c.id === id);
  if (c) {
    c.stage = 'Applied';
    c.stageDate = todayStr();
    c.rejectionReason = '';
  }
  renderPipeline();
}

function renderPipeline() {
  const tbody = document.getElementById('pipelineBody');
  const rejectedBody = document.getElementById('rejectedBody');
  const rejectedSection = document.getElementById('rejectedSection');
  if (!tbody) return;

  const active = pCandidates.filter(c => c.stage !== 'Rejected');
  const rejected = pCandidates.filter(c => c.stage === 'Rejected');

  // ── Active candidates ──
  if (!active.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#5A7A6A;font-size:13px"><i class="ti ti-inbox" style="font-size:18px;vertical-align:-4px;margin-right:8px"></i>No candidates yet — add one above or import from CV Screener</td></tr>';
  } else {
    tbody.innerHTML = active.map((c, i) => {
      const dn = privacyOn
        ? `<span style="width:24px;height:24px;border-radius:50%;background:#EAF3DE;color:#085041;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #C0DD97">${initials(c.name)}</span><span style="font-family:'DM Mono',monospace;font-size:12px;color:#5A7A6A;letter-spacing:1px">${maskName(c.name)}</span>`
        : `<span style="width:24px;height:24px;border-radius:50%;background:#EAF3DE;color:#085041;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #C0DD97">${initials(c.name)}</span><span style="font-weight:500">${c.name}</span>`;
      const nt = privacyOn
        ? `<span style="font-size:11px;color:#5A7A6A;display:inline-flex;align-items:center;gap:3px"><i class="ti ti-lock" style="font-size:11px"></i>Hidden</span>`
        : `<span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#5A7A6A;display:block" title="${c.notes}">${c.notes || '—'}</span>`;
      const stagesForSelect = PIPELINE_STAGES.filter(s => s !== 'Rejected');
      return `<tr>
        <td>${rankBadge(i)}</td>
        <td style="white-space:nowrap">${dn}</td>
        <td>
          <div style="width:45px;height:5px;background:#E2EDE8;border-radius:4px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:4px">
            <div style="height:100%;width:${c.score}%;background:#1D9E75;border-radius:4px"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:#0F6E56">${c.score}</span>
        </td>
        <td>
          <select style="font-size:10px;padding:3px 6px;border:0.5px solid #97C459;border-radius:20px;font-family:'DM Sans',sans-serif;cursor:pointer;${stageColor(c.stage)}" onchange="updatePStage(${c.id},this.value)">
            ${stagesForSelect.map(s => `<option value="${s}" ${s === c.stage ? 'selected' : ''}>${s}</option>`).join('')}
            <option value="Rejected" style="color:#E24B4A;font-weight:600">⊗ Reject</option>
          </select>
        </td>
        <td>${daysInStageBadge(c)}</td>
        <td style="color:#5A7A6A;font-size:11px">${c.date}</td>
        <td>${nt}</td>
        <td><button onclick="removePCandidate(${c.id})" style="background:none;border:none;cursor:pointer;color:#5A7A6A;font-size:14px" aria-label="Remove"><i class="ti ti-x"></i></button></td>
      </tr>`;
    }).join('');
  }

  // ── Rejected section ──
  if (rejectedSection) {
    rejectedSection.style.display = rejected.length ? 'block' : 'none';
  }
  if (rejectedBody && rejected.length) {
    rejectedBody.innerHTML = rejected.map(c => {
      const dn = privacyOn
        ? `<span style="width:24px;height:24px;border-radius:50%;background:#FCEBEB;color:#8B1A1A;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #F09595">${initials(c.name)}</span><span style="font-family:'DM Mono',monospace;font-size:12px;color:#8B1A1A;letter-spacing:1px">${maskName(c.name)}</span>`
        : `<span style="width:24px;height:24px;border-radius:50%;background:#FCEBEB;color:#8B1A1A;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #F09595">${initials(c.name)}</span><span style="font-weight:500;color:#8B1A1A;text-decoration:line-through">${c.name}</span>`;
      return `<tr style="background:#FFF8F8">
        <td style="white-space:nowrap">${dn}</td>
        <td><span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#FCEBEB;color:#8B1A1A;white-space:nowrap"><i class="ti ti-ban" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Rejected</span></td>
        <td><span style="font-size:11px;padding:2px 9px;border-radius:20px;background:#FEF3DC;color:#7A4A00">${c.rejectionReason || '—'}</span></td>
        <td style="color:#5A7A6A;font-size:11px">${c.stageDate || c.date}</td>
        <td>
          <button onclick="restoreCandidate(${c.id})" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:4px 10px;background:#EAF3DE;color:#085041;border:0.5px solid #C0DD97;border-radius:8px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
            <i class="ti ti-rotate" style="font-size:12px"></i>Restore
          </button>
          <button onclick="removePCandidate(${c.id})" style="background:none;border:none;cursor:pointer;color:#F09595;font-size:14px;margin-left:4px" aria-label="Delete"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
    document.getElementById('rejectedCountPill').textContent = rejected.length;
  }

  updateMetrics();
}

function updateMetrics() {
  const total = pCandidates.length;
  const hired = pCandidates.filter(c => c.stage === 'Hired').length;
  const offers = pCandidates.filter(c => ['Offer', 'Joining', 'Hired'].includes(c.stage)).length;
  const shortlisted = pCandidates.filter(c => !['Applied', 'Screening'].includes(c.stage)).length;
  const stale = pCandidates.filter(c => c.stage.startsWith('Interview') && daysSince(c.stageDate || c.date) > 7).length;
  const rejected = pCandidates.filter(c => c.stage === 'Rejected').length;

  document.getElementById('m-total').textContent = total;
  document.getElementById('m-hired').textContent = hired;
  document.getElementById('m-hired-rate').textContent = (total > 0 ? Math.round(hired / total * 100) : 0) + '% conversion';
  document.getElementById('m-offer-rate').textContent = offers > 0 ? Math.round(hired / offers * 100) + '%' : '—';
  document.getElementById('m-shortlisted').textContent = shortlisted;
  document.getElementById('listPill').textContent = pCandidates.filter(c => c.stage !== 'Rejected').length;
  const staleEl = document.getElementById('m-stale');
  if (staleEl) { staleEl.textContent = stale; document.getElementById('m-stale-label').textContent = stale > 0 ? '⚠ need follow-up' : 'no action needed'; }

  PIPELINE_STAGES.forEach(s => {
    const el = document.getElementById('sc-' + s.replace(/ /g, '-'));
    if (el) el.textContent = pCandidates.filter(c => c.stage === s).length;
  });
  const rejEl = document.getElementById('sc-Rejected');
  if (rejEl) rejEl.textContent = pCandidates.filter(c => c.stage === 'Rejected').length;
}

function exportCSV() {
  if (!pCandidates.length) { alert('No candidates to export yet.'); return; }
  const headers = ['Rank', 'Candidate', 'Score', 'Stage', 'Rejection Reason', 'Days in Stage', 'Date Added', 'Notes'];
  const rows = pCandidates.map((c, i) => [i + 1, c.name, c.score, c.stage, c.rejectionReason || '', daysSince(c.stageDate || c.date), c.date, c.notes || ''].map(v => `"${v}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'TalentScreen_Pipeline.csv';
  a.click(); URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => { renderPipeline(); });

// ── Rejected section toggle ──
let rejectedVisible = false;
function toggleRejected() {
  rejectedVisible = !rejectedVisible;
  const wrap = document.getElementById('rejectedTableWrap');
  const label = document.getElementById('rejectedLabel');
  const chevron = document.getElementById('rejectedChevron');
  wrap.style.maxHeight = rejectedVisible ? '600px' : '0';
  label.textContent = rejectedVisible ? 'Hide' : 'Show';
  chevron.style.transform = rejectedVisible ? 'rotate(180deg)' : 'rotate(0deg)';
}
