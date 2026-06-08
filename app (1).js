// ── TalentScreen AI — App Logic v2.0 ──

// ── NAV ──
function switchTab(id) {
  var tabs = ['screener', 'questions', 'pipeline'];
  for(var i=0; i<tabs.length; i++) {
    var t = tabs[i];
    var tabEl = document.getElementById('tab-' + t);
    var panelEl = document.getElementById('panel-' + t);
    if(tabEl) tabEl.classList.toggle('active', t === id);
    if(panelEl) panelEl.classList.toggle('active', t === id);
  }
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
  // ~150 tokens per question + 300 buffer
  return Math.min(300 + (numQuestions * 150), 3000);
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

// addAllToPipeline handled in pipeline section

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

// ── Function → Role mapping ──
const FUNCTION_ROLES = {
  'Finance': [
    'Financial Analyst', 'Senior Financial Analyst', 'Finance Manager',
    'Finance Business Partner', 'FP&A Manager', 'Head of Finance',
    'CFO', 'Treasury Manager', 'Tax Manager', 'Audit Manager',
    'Controller', 'Cost Accountant'
  ],
  'HR': [
    'Recruiter', 'Senior Recruiter', 'TA Manager', 'Head of Talent Acquisition',
    'HR Business Partner', 'Senior HRBP', 'Manager HRBP', 'Head of HRBP',
    'HR Manager', 'HR Director', 'Chief People Officer', 'CHRO',
    'L&D Manager', 'C&B Manager', 'ER Manager', 'DEI Lead',
    'HR Analyst', 'OD Manager', 'Payroll Manager'
  ],
  'IT': [
    'Software Engineer', 'Senior Software Engineer', 'Tech Lead',
    'Product Manager', 'Scrum Master', 'DevOps Engineer',
    'Data Analyst', 'Data Scientist', 'IT Manager', 'IT Director',
    'CTO', 'Cloud Architect', 'Cybersecurity Analyst', 'QA Engineer',
    'Systems Administrator', 'UX Designer'
  ],
  'Legal': [
    'Legal Counsel', 'Senior Legal Counsel', 'Compliance Officer',
    'Compliance Manager', 'Contract Manager', 'Legal Manager',
    'General Counsel', 'Risk Manager', 'Data Privacy Officer',
    'Company Secretary', 'Paralegal'
  ],
  'Marketing': [
    'Marketing Executive', 'Marketing Manager', 'Brand Manager',
    'Digital Marketing Manager', 'SEO Specialist', 'Content Manager',
    'Social Media Manager', 'Head of Marketing', 'CMO',
    'CRM Manager', 'Growth Manager', 'PR Manager',
    'Campaign Manager', 'Market Research Analyst'
  ],
  'Operations': [
    'Operations Analyst', 'Operations Manager', 'Process Improvement Manager',
    'Business Analyst', 'Project Manager', 'Program Manager',
    'Head of Operations', 'COO', 'Facilities Manager',
    'Customer Service Manager', 'Quality Manager', 'HSE Manager'
  ],
  'Sales': [
    'Sales Executive', 'Senior Sales Executive', 'Account Manager',
    'Key Account Manager', 'Sales Manager', 'Regional Sales Manager',
    'Business Development Manager', 'Head of Sales', 'VP Sales',
    'Sales Director', 'CSO', 'Pre-Sales Consultant',
    'Channel Sales Manager', 'Inside Sales Manager'
  ],
  'Supply Chain': [
    'Supply Chain Analyst', 'Supply Chain Manager', 'Procurement Officer',
    'Procurement Manager', 'Logistics Manager', 'Warehouse Manager',
    'Demand Planning Manager', 'Inventory Manager', 'Head of Supply Chain',
    'Chief Supply Chain Officer', 'Category Manager', 'Vendor Manager',
    'Import/Export Manager', 'Fleet Manager'
  ]
};

function onFunctionChange() {
  var fn = document.getElementById('functionSelect').value;
  var roleSelect = document.getElementById('roleSelect');
  var customFnGroup = document.getElementById('customFunctionGroup');
  var customRoleGroup = document.getElementById('customRoleGroup');

  customFnGroup.style.display = fn === 'custom' ? 'block' : 'none';
  customRoleGroup.style.display = 'none';

  if (!fn || fn === 'custom') {
    roleSelect.innerHTML = '<option value="">— Select function first —</option><option value="custom">Other (type below)</option>';
    if (fn === 'custom') { customRoleGroup.style.display = 'block'; }
    return;
  }

  var roles = FUNCTION_ROLES[fn] || [];
  var opts = '<option value="">— Select a role —</option>';
  for (var i = 0; i < roles.length; i++) {
    opts += '<option value="' + roles[i] + '">' + roles[i] + '</option>';
  }
  opts += '<option value="custom">Other (type below)</option>';
  roleSelect.innerHTML = opts;
}

function onRoleChange() {
  const rv = document.getElementById('roleSelect').value;
  document.getElementById('customRoleGroup').style.display = rv === 'custom' ? 'flex' : 'none';
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
  const fn = document.getElementById('functionSelect').value;
  const rv = document.getElementById('roleSelect').value;
  const cr = document.getElementById('customRole').value.trim();
  const cfn = document.getElementById('customFunction')?.value.trim();
  const errEl = document.getElementById('s2err');
  const btn = document.getElementById('genBtn');
  const resultEl = document.getElementById('qResult');

  if (!fn) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please select a function first.</div>'; return; }
  if (!rv) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please select a role.</div>'; return; }
  if (rv === 'custom' && !cr) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please type the role name.</div>'; return; }
  if (fn === 'custom' && !cfn) { errEl.innerHTML = '<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>Please type the function name.</div>'; return; }
  errEl.innerHTML = '';

  const functionName = fn === 'custom' ? cfn : fn;
  const role = rv === 'custom' ? cr : rv;
  const jd = document.getElementById('q2jd').value.trim();
  const seniority = document.getElementById('senioritySelect').value;
  const types = Array.from(activeTypes).join(', ');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="alert alert-info"><div class="spinner-dark"></div>&nbsp;Generating ' + selQty + ' questions…</div>';

  const qTokens = calcQMaxTokens(selQty);
  var jdPart = jd ? ('JD: ' + cleanText(jd, 1000)) : '';
  var prompt = 'Generate ' + selQty + ' interview questions. Function: ' + functionName + '. Role: ' + role + '. Level: ' + seniority + '. Types: ' + types + '. ' + jdPart + ' Return ONLY this JSON structure, no extra text: {"questions":[{"number":1,"type":"Behavioural","question":"full question here","what_to_listen_for":"brief tip"}]}';

  try {
    const raw = await callClaude(prompt, qTokens);
    const clean = raw.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    renderQuestions(data.questions || [], role, seniority, functionName);
  } catch (e) {
    resultEl.innerHTML = `<div class="alert alert-error"><i class="ti ti-alert-circle" style="font-size:14px"></i>${e.message}</div>`;
  }
  btn.innerHTML = '<i class="ti ti-wand" style="font-size:15px"></i> Generate questions';
  btn.disabled = false;
}

function renderQuestions(questions, role, seniority, functionName) {
  const resultEl = document.getElementById('qResult');
  resultEl.style.display = 'block';
  const typeColor = t => t === 'Behavioural' ? '#EAF3DE;color:#085041' : t === 'Situational' ? '#E6F1FB;color:#185FA5' : '#EEEDFE;color:#534AB7';

  resultEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:0.5px solid #E2EDE8">
      <div style="font-size:13px;font-weight:600;color:#0F6E56">
        <i class="ti ti-list-check" style="font-size:14px;vertical-align:-2px;margin-right:6px"></i>
        ${questions.length} Questions — ${functionName || ''} | ${role} | ${seniority}
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
// TOOL 3: CROSS-FUNCTIONAL PIPELINE
// ══════════════════════════════════════════

const PIPELINE_STAGES = ['Applied','Screening','Shortlisted','Interview R1','Interview R2','Interview R3','BG Check','Offer','Joining','Hired','Rejected'];
const REJECTION_REASONS = ['Overqualified','Underqualified','Salary Mismatch','Culture Fit','Better Candidate Selected','Role Cancelled','Candidate Withdrew','Failed Assessment','Failed Background Check','Other'];

let privacyOn = true;
let listVisible = false;
let activeRoleId = null;

// ── ROLES DATA ──
const roles = [
  {
    id: 'role-1',
    title: 'Manager HRBP',
    function: 'HR',
    status: 'Active',
    headcount: 1,
    candidates: [
      {id:1, name:'Farinaaz Lilaowalla', score:91, stage:'Shortlisted', date:'03/06/2026', stageDate:'03/06/2026', notes:'Highest JD alignment — PMS, manpower, GPTW.', rejectionReason:''},
      {id:2, name:'Sumit Gurjar',         score:89, stage:'Shortlisted', date:'03/06/2026', stageDate:'03/06/2026', notes:'Chartered MCIPD, Amazon + Landmark.', rejectionReason:''},
      {id:3, name:'Louise Pickin',        score:87, stage:'Interview R1', date:'03/06/2026', stageDate:'03/06/2026', notes:'Honeywell META SHRBP — near-perfect peer role.', rejectionReason:''},
      {id:4, name:'Urmila Murthy',        score:84, stage:'Interview R1', date:'03/06/2026', stageDate:'03/06/2026', notes:'100% Emiratization compliance. Probe PMS & ER.', rejectionReason:''},
      {id:5, name:'Natalie Canning',      score:82, stage:'Applied',     date:'03/06/2026', stageDate:'03/06/2026', notes:'Al Futtaim — strong Emiratization results.', rejectionReason:''},
      {id:6, name:'Rose Francis Alapatt', score:80, stage:'Applied',     date:'03/06/2026', stageDate:'03/06/2026', notes:'20+ yrs, good engagement & L&D.', rejectionReason:''},
      {id:7, name:'Deborah Joseph',       score:78, stage:'Screening',   date:'03/06/2026', stageDate:'03/06/2026', notes:'Dubai Islamic Bank TM. CIPD L7 in progress.', rejectionReason:''},
      {id:8, name:'Nishtha Arya',         score:75, stage:'Screening',   date:'03/06/2026', stageDate:'03/06/2026', notes:'Al Boom Marine — smaller scope.', rejectionReason:''},
      {id:9, name:'Ana Mason',            score:72, stage:'Rejected',    date:'03/06/2026', stageDate:'03/06/2026', notes:'FMCG/Manufacturing focus.', rejectionReason:'Better Candidate Selected'},
      {id:10,name:'Malgo Dabrowska',      score:68, stage:'Rejected',    date:'03/06/2026', stageDate:'03/06/2026', notes:'Fujifilm MEA — scope below expectation.', rejectionReason:'Underqualified'},
    ]
  }
];

let nextRoleId = 2;
let nextCandId = 100;

// ── HELPER FUNCTIONS ──
function initials(n) { return n.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase(); }
function maskName(n) { return n.split(' ').map(p=>p[0]+'•'.repeat(Math.min(p.length-1,4))).join(' '); }
function todayStr() { var d=new Date(); return d.getDate().toString().padStart(2,'0')+'/'+(d.getMonth()+1).toString().padStart(2,'0')+'/'+d.getFullYear(); }
function daysSince(ds) { if(!ds) return 0; var p=ds.split('/'); var diff=Date.now()-new Date(parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0])).getTime(); return Math.floor(diff/(1000*60*60*24)); }

function stageColor(s) {
  var m = {'Applied':'background:#E6F1FB;color:#185FA5','Screening':'background:#FAEEDA;color:#854F0B','Shortlisted':'background:#E1F5EE;color:#0F6E56','Interview R1':'background:#EEEDFE;color:#534AB7','Interview R2':'background:#AFA9EC;color:#26215C','Interview R3':'background:#7F77DD;color:#fff','BG Check':'background:#FBEAF0;color:#993556','Offer':'background:#EAF3DE;color:#3B6D11','Joining':'background:#9FE1CB;color:#04342C','Hired':'background:#C0DD97;color:#085041','Rejected':'background:#FCEBEB;color:#8B1A1A'};
  return m[s] || '';
}

function statusStyle(s) {
  if(s==='Active') return 'background:#EAF3DE;color:#085041';
  if(s==='On Hold') return 'background:#FAEEDA;color:#854F0B';
  return 'background:#F0F0F0;color:#555';
}

function rankBadge(i) {
  var styles = ['background:#EF9F27;color:#412402','background:#B4B2A9;color:#2C2C2A','background:#97C459;color:#173404'];
  var style = i < 3 ? styles[i] : 'background:#EEE;color:#666';
  return '<span style="font-size:10px;font-weight:600;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;'+style+'">'+(i+1)+'</span>';
}

function daysInStageBadge(c) {
  var days = daysSince(c.stageDate || c.date);
  var isInterview = c.stage && c.stage.startsWith('Interview');
  var warn = isInterview && days > 7;
  var color = warn ? '#FCEBEB;color:#8B1A1A' : days > 14 ? '#FEF3DC;color:#7A4A00' : 'var(--color-background-secondary);color:var(--color-text-secondary)';
  return '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:'+color+';white-space:nowrap">'+(warn?'⚠ ':'')+days+'d</span>';
}

// ── LEVEL 1: ROLES DASHBOARD ──
var currentMetricFilter = 'all';

function setMetricFilter(f) {
  currentMetricFilter = f;
  ['all','active','offer','filled'].forEach(function(k) {
    var el = document.getElementById('mc-'+k);
    if(el) {
      el.style.borderColor = k===f ? '#0F6E56' : 'transparent';
      el.style.background = k===f ? '#EAF3DE' : 'var(--color-background-secondary)';
    }
  });
  var banner = document.getElementById('metricFilterBanner');
  var msgs = {all:null,active:'Showing Active roles only',offer:'Showing roles with candidates at Offer stage',filled:'Showing filled roles'};
  if(banner) {
    if(f==='all'){banner.style.display='none';}
    else{banner.style.display='flex';document.getElementById('metricFilterText').textContent=msgs[f];}
  }
  renderRolesDashboard();
}

function filterRoles() { currentMetricFilter='all'; renderRolesDashboard(); }

function showAddRoleForm() { document.getElementById('addRoleForm').style.display='block'; }
function hideAddRoleForm() { document.getElementById('addRoleForm').style.display='none'; }

function addRole() {
  var title = document.getElementById('newRoleTitle').value.trim();
  var fn = document.getElementById('newRoleFunction').value;
  var status = document.getElementById('newRoleStatus').value;
  var hc = parseInt(document.getElementById('newRoleHC').value) || 1;
  if(!title) { alert('Please enter a job title.'); return; }
  if(!fn) { alert('Please select a function.'); return; }
  roles.push({ id:'role-'+nextRoleId++, title:title, function:fn, status:status, headcount:hc, filled:false, candidates:[] });
  document.getElementById('newRoleTitle').value='';
  document.getElementById('newRoleFunction').value='';
  document.getElementById('newRoleHC').value='';
  hideAddRoleForm();
  renderRolesDashboard();
}

function renderRolesDashboard() {
  var fnFilter = document.getElementById('filterFunction').value;
  var stFilter = document.getElementById('filterStatus').value;
  var filtered = roles.filter(function(r) {
    return (!fnFilter || r.function===fnFilter) && (!stFilter || r.status===stFilter);
  });
  if(currentMetricFilter==='active') filtered=filtered.filter(function(r){return r.status==='Active';});
  else if(currentMetricFilter==='offer') filtered=filtered.filter(function(r){return r.candidates.some(function(c){return c.stage==='Offer';});});
  else if(currentMetricFilter==='filled') filtered=filtered.filter(function(r){return r.filled;});

  // Metrics
  var totalCands = roles.reduce(function(a,r){return a+r.candidates.length;},0);
  var totalHired = roles.reduce(function(a,r){return a+r.candidates.filter(function(c){return c.stage==='Hired';}).length;},0);
  var activeRoles = roles.filter(function(r){return r.status==='Active';}).length;
  var totalOffer = roles.reduce(function(a,r){return a+r.candidates.filter(function(c){return c.stage==='Offer';}).length;},0);
  var totalFilled = roles.filter(function(r){return r.filled;}).length;
  document.getElementById('rm-total').textContent = roles.length;
  document.getElementById('rm-active').textContent = activeRoles;
  document.getElementById('rm-offer').textContent = totalOffer;
  document.getElementById('rm-filled').textContent = totalFilled;

  var tbody = document.getElementById('rolesTableBody');
  if(!filtered.length) {
    tbody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-secondary);font-size:13px"><i class="ti ti-inbox" style="font-size:16px;vertical-align:-3px;margin-right:6px"></i>No roles found — click Add role to create one</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(r) {
    var cands = r.candidates.filter(function(c){return c.stage!=='Rejected';});
    var shortlisted = r.candidates.filter(function(c){return !['Applied','Screening','Rejected'].includes(c.stage);}).length;
    var inInterview = r.candidates.filter(function(c){return c.stage&&c.stage.startsWith('Interview');}).length;
    var inOffer = r.candidates.filter(function(c){return ['Offer','Joining'].includes(c.stage);}).length;
    var hired = r.candidates.filter(function(c){return c.stage==='Hired';}).length;

    return '<tr style="cursor:pointer" onclick="openRolePipeline(\''+r.id+'\')">'
      +'<td style="font-weight:600;color:var(--color-text-primary);padding:10px 12px">'
        +'<div style="font-size:13px">'+r.title+'</div>'
        +'<div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">HC: '+r.headcount+'</div>'
      +'</td>'
      +'<td style="padding:10px 12px"><span style="font-size:11px;padding:2px 9px;border-radius:20px;background:#EAF3DE;color:#085041">'+r.function+'</span></td>'
      +'<td style="padding:10px 12px"><span style="font-size:11px;padding:2px 9px;border-radius:20px;'+statusStyle(r.status)+'">'+r.status+'</span></td>'
      +'<td style="text-align:center;font-weight:600;color:var(--color-text-primary);padding:10px 12px">'+r.candidates.length+'</td>'
      +'<td style="text-align:center;padding:10px 12px"><span style="font-size:12px;font-weight:600;color:#0F6E56">'+shortlisted+'</span></td>'
      +'<td style="text-align:center;padding:10px 12px"><span style="font-size:12px;font-weight:600;color:#534AB7">'+inInterview+'</span></td>'
      +'<td style="text-align:center;padding:10px 12px"><span style="font-size:12px;font-weight:600;color:#3B6D11">'+inOffer+'</span></td>'
      +'<td style="text-align:center;padding:10px 12px"><span style="font-size:12px;font-weight:600;color:#085041">'+hired+'</span></td>'
      +'<td style="padding:10px 12px">'
        +'<button onclick="event.stopPropagation();openRolePipeline(\''+r.id+'\')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;background:#EAF3DE;color:#085041;border:0.5px solid #C0DD97;border-radius:8px;font-size:11px;font-weight:500;cursor:pointer;font-family:\'DM Sans\',sans-serif">'
          +'<i class="ti ti-arrow-right" style="font-size:12px"></i>View'
        +'</button>'
        +' <button onclick="event.stopPropagation();deleteRole(\''+r.id+'\')" style="background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:13px;padding:4px" title="Delete role"><i class="ti ti-trash"></i></button>'
      +'</td>'
    +'</tr>';
  }).join('');
}

function deleteRole(id) {
  if(!confirm('Delete this role and all its candidates?')) return;
  var idx = roles.findIndex(function(r){return r.id===id;});
  if(idx>-1) roles.splice(idx,1);
  renderRolesDashboard();
}

// ── LEVEL 2: INDIVIDUAL ROLE PIPELINE ──
function openRolePipeline(roleId) {
  activeRoleId = roleId;
  var role = roles.find(function(r){return r.id===roleId;});
  if(!role) return;

  document.getElementById('view-roles').style.display = 'none';
  document.getElementById('view-pipeline').style.display = 'block';

  document.getElementById('activeRoleName').textContent = role.title;
  document.getElementById('activeRoleFunction').textContent = role.function;
  var statusEl = document.getElementById('activeRoleStatus');
  statusEl.textContent = role.status;
  statusEl.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:20px;'+statusStyle(role.status);

  listVisible = false;
  document.getElementById('tableSection').classList.add('collapsed');
  document.getElementById('listLabel').textContent = 'Show';
  document.getElementById('listChevron').classList.remove('open');

  renderPipeline();
}

function backToRoles() {
  activeRoleId = null;
  document.getElementById('view-pipeline').style.display = 'none';
  document.getElementById('view-roles').style.display = 'block';
  renderRolesDashboard();
}

function getActiveCandidates() {
  if(!activeRoleId) return [];
  var role = roles.find(function(r){return r.id===activeRoleId;});
  return role ? role.candidates : [];
}

// ── PRIVACY ──
function togglePrivacy() {
  privacyOn = !privacyOn;
  document.getElementById('privacyIcon').className = privacyOn ? 'ti ti-eye-off' : 'ti ti-eye';
  document.getElementById('privacyLabel').textContent = privacyOn ? 'Privacy on' : 'Privacy off';
  var banner = document.getElementById('privacyBanner');
  if(banner) banner.style.display = privacyOn ? 'flex' : 'none';
  renderPipeline();
}

function toggleList() {
  listVisible = !listVisible;
  document.getElementById('tableSection').classList.toggle('collapsed', !listVisible);
  document.getElementById('listLabel').textContent = listVisible ? 'Hide' : 'Show';
  document.getElementById('listChevron').classList.toggle('open', listVisible);
}

// ── CANDIDATE ACTIONS ──
function addCandidate() {
  if(!activeRoleId) return;
  var name = document.getElementById('p-name').value.trim();
  var score = parseInt(document.getElementById('p-score').value)||0;
  var stage = document.getElementById('p-stage').value;
  var notes = document.getElementById('p-notes').value.trim();
  if(!name) { alert('Please enter a candidate name.'); return; }
  var role = roles.find(function(r){return r.id===activeRoleId;});
  if(role) {
    role.candidates.push({id:nextCandId++, name:name, score:score, stage:stage, date:todayStr(), stageDate:todayStr(), notes:notes, rejectionReason:''});
    role.candidates.sort(function(a,b){return b.score-a.score;});
  }
  document.getElementById('p-name').value='';
  document.getElementById('p-score').value='';
  document.getElementById('p-notes').value='';
  renderPipeline();
}

function removePCandidate(id) {
  var role = roles.find(function(r){return r.id===activeRoleId;});
  if(role) { var idx=role.candidates.findIndex(function(c){return c.id===id;}); if(idx>-1) role.candidates.splice(idx,1); }
  renderPipeline();
}

function updatePStage(id, s) {
  var role = roles.find(function(r){return r.id===activeRoleId;});
  if(!role) return;
  var c = role.candidates.find(function(c){return c.id===id;});
  if(!c) return;
  if(s==='Rejected') {
    showRejectModal(id);
    var sel = document.querySelector('select[onchange="updatePStage('+id+',this.value)"]');
    if(sel) sel.value = c.stage;
    return;
  }
  c.stage=s; c.stageDate=todayStr(); c.rejectionReason='';
  renderPipeline();
}

function showRejectModal(id) {
  var role = roles.find(function(r){return r.id===activeRoleId;});
  var c = role ? role.candidates.find(function(c){return c.id===id;}) : null;
  if(!c) return;
  var existing = document.getElementById('rejectModal');
  if(existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'rejectModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.25)">'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      +'<div style="width:36px;height:36px;border-radius:50%;background:#FCEBEB;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ti-user-x" style="font-size:18px;color:#E24B4A"></i></div>'
      +'<div><div style="font-size:15px;font-weight:600;color:#1A2E25">Reject candidate</div><div style="font-size:12px;color:#5A7A6A">'+c.name+'</div></div>'
    +'</div>'
    +'<p style="font-size:13px;color:#5A7A6A;margin:0 0 14px;line-height:1.5">Select a reason for rejection.</p>'
    +'<div style="margin-bottom:16px">'
      +'<label style="font-size:11px;font-weight:600;color:#8B1A1A;display:block;margin-bottom:6px">REASON FOR REJECTION</label>'
      +'<select id="rejectReasonSelect" style="width:100%;padding:10px 12px;font-size:13px;font-family:\'DM Sans\',sans-serif;border:1.5px solid #F09595;border-radius:10px;color:#1A2E25;background:#fff;cursor:pointer">'
        +'<option value="">— Select a reason —</option>'
        +REJECTION_REASONS.map(function(r){return '<option value="'+r+'">'+r+'</option>';}).join('')
      +'</select>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<button onclick="document.getElementById(\'rejectModal\').remove()" style="flex:1;padding:10px;background:#F7FAF8;border:0.5px solid #E2EDE8;border-radius:10px;font-size:13px;font-weight:500;color:#5A7A6A;cursor:pointer;font-family:\'DM Sans\',sans-serif">Cancel</button>'
      +'<button onclick="confirmReject('+id+')" style="flex:1;padding:10px;background:#E24B4A;border:none;border-radius:10px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;font-family:\'DM Sans\',sans-serif">Confirm Rejection</button>'
    +'</div>'
  +'</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });
}

function confirmReject(id) {
  var reason = document.getElementById('rejectReasonSelect').value;
  if(!reason) { alert('Please select a rejection reason.'); return; }
  var role = roles.find(function(r){return r.id===activeRoleId;});
  if(role) {
    var c = role.candidates.find(function(c){return c.id===id;});
    if(c) { c.stage='Rejected'; c.stageDate=todayStr(); c.rejectionReason=reason; }
  }
  document.getElementById('rejectModal').remove();
  renderPipeline();
}

function restoreCandidate(id) {
  var role = roles.find(function(r){return r.id===activeRoleId;});
  if(role) {
    var c = role.candidates.find(function(c){return c.id===id;});
    if(c) { c.stage='Applied'; c.stageDate=todayStr(); c.rejectionReason=''; }
  }
  renderPipeline();
}

// ── RENDER PIPELINE ──
function renderPipeline() {
  var pCandidates = getActiveCandidates();
  var tbody = document.getElementById('pipelineBody');
  var rejectedSection = document.getElementById('rejectedSection');
  var rejectedBody = document.getElementById('rejectedBody');
  if(!tbody) return;

  var active = pCandidates.filter(function(c){return c.stage!=='Rejected';});
  var rejected = pCandidates.filter(function(c){return c.stage==='Rejected';});

  // Active candidates
  if(!active.length) {
    tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-secondary);font-size:13px"><i class="ti ti-inbox" style="font-size:18px;vertical-align:-4px;margin-right:8px"></i>No candidates yet — add one above or screen CVs</td></tr>';
  } else {
    var stagesForSelect = PIPELINE_STAGES.filter(function(s){return s!=='Rejected';});
    tbody.innerHTML = active.map(function(c,i) {
      var dn = privacyOn
        ? '<span style="width:24px;height:24px;border-radius:50%;background:#EAF3DE;color:#085041;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #C0DD97">'+initials(c.name)+'</span><span style="font-size:12px;color:var(--color-text-secondary)">'+maskName(c.name)+'</span>'
        : '<span style="width:24px;height:24px;border-radius:50%;background:#EAF3DE;color:#085041;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #C0DD97">'+initials(c.name)+'</span><span style="font-weight:500">'+c.name+'</span>';
      var nt = privacyOn
        ? '<span style="font-size:11px;color:var(--color-text-secondary);display:inline-flex;align-items:center;gap:3px"><i class="ti ti-lock" style="font-size:11px"></i>Hidden</span>'
        : '<span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--color-text-secondary);display:block" title="'+c.notes+'">'+( c.notes||'—')+'</span>';
      return '<tr>'
        +'<td>'+rankBadge(i)+'</td>'
        +'<td style="white-space:nowrap">'+dn+'</td>'
        +'<td><div style="width:45px;height:5px;background:#E2EDE8;border-radius:4px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:4px"><div style="height:100%;width:'+c.score+'%;background:#1D9E75;border-radius:4px"></div></div><span style="font-size:12px;font-weight:600;color:#0F6E56">'+c.score+'</span></td>'
        +'<td><select style="font-size:10px;padding:3px 6px;border:0.5px solid #97C459;border-radius:20px;font-family:\'DM Sans\',sans-serif;cursor:pointer;'+stageColor(c.stage)+'" onchange="updatePStage('+c.id+',this.value)">'+stagesForSelect.map(function(s){return '<option value="'+s+'"'+(s===c.stage?' selected':'')+'>'+s+'</option>';}).join('')+'<option value="Rejected" style="color:#E24B4A;font-weight:600">⊗ Reject</option></select></td>'
        +'<td>'+daysInStageBadge(c)+'</td>'
        +'<td style="color:var(--color-text-secondary);font-size:11px">'+c.date+'</td>'
        +'<td>'+nt+'</td>'
        +'<td><button onclick="removePCandidate('+c.id+')" style="background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:14px"><i class="ti ti-x"></i></button></td>'
      +'</tr>';
    }).join('');
  }

  // Rejected section
  if(rejectedSection) rejectedSection.style.display = rejected.length ? 'block' : 'none';
  if(rejectedBody && rejected.length) {
    rejectedBody.innerHTML = rejected.map(function(c) {
      var dn = privacyOn
        ? '<span style="width:24px;height:24px;border-radius:50%;background:#FCEBEB;color:#8B1A1A;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #F09595">'+initials(c.name)+'</span><span style="font-size:12px;color:#8B1A1A">'+maskName(c.name)+'</span>'
        : '<span style="width:24px;height:24px;border-radius:50%;background:#FCEBEB;color:#8B1A1A;font-size:9px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;border:0.5px solid #F09595">'+initials(c.name)+'</span><span style="font-weight:500;color:#8B1A1A;text-decoration:line-through">'+c.name+'</span>';
      return '<tr style="background:#FFF8F8">'
        +'<td style="padding:8px 10px">'+dn+'</td>'
        +'<td style="padding:8px 10px"><span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#FCEBEB;color:#8B1A1A"><i class="ti ti-ban" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Rejected</span></td>'
        +'<td style="padding:8px 10px"><span style="font-size:11px;padding:2px 9px;border-radius:20px;background:#FEF3DC;color:#7A4A00">'+( c.rejectionReason||'—')+'</span></td>'
        +'<td style="padding:8px 10px;color:var(--color-text-secondary);font-size:11px">'+( c.stageDate||c.date)+'</td>'
        +'<td style="padding:8px 10px">'
          +'<button onclick="restoreCandidate('+c.id+')" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:4px 10px;background:#EAF3DE;color:#085041;border:0.5px solid #C0DD97;border-radius:8px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:500"><i class="ti ti-rotate" style="font-size:12px"></i>Restore</button>'
          +' <button onclick="removePCandidate('+c.id+')" style="background:none;border:none;cursor:pointer;color:#F09595;font-size:14px"><i class="ti ti-trash"></i></button>'
        +'</td>'
      +'</tr>';
    }).join('');
    document.getElementById('rejectedCountPill').textContent = rejected.length;
  }

  updateMetrics();
}

function updateMetrics() {
  var pCandidates = getActiveCandidates();
  var total = pCandidates.length;
  var hired = pCandidates.filter(function(c){return c.stage==='Hired';}).length;
  var offers = pCandidates.filter(function(c){return ['Offer','Joining','Hired'].includes(c.stage);}).length;
  var shortlisted = pCandidates.filter(function(c){return !['Applied','Screening','Rejected'].includes(c.stage);}).length;

  var mTotal=document.getElementById('m-total'); if(mTotal) mTotal.textContent=total;
  var mHired=document.getElementById('m-hired'); if(mHired) mHired.textContent=hired;
  var mRate=document.getElementById('m-hired-rate'); if(mRate) mRate.textContent=(total>0?Math.round(hired/total*100):0)+'% conversion';
  var mOffer=document.getElementById('m-offer-rate'); if(mOffer) mOffer.textContent=offers>0?Math.round(hired/offers*100)+'%':'—';
  var mShort=document.getElementById('m-shortlisted'); if(mShort) mShort.textContent=shortlisted;
  var lPill=document.getElementById('listPill'); if(lPill) lPill.textContent=pCandidates.filter(function(c){return c.stage!=='Rejected';}).length;

  PIPELINE_STAGES.forEach(function(s) {
    var el = document.getElementById('sc-'+s.replace(/ /g,'-'));
    if(el) el.textContent = pCandidates.filter(function(c){return c.stage===s;}).length;
  });
}

// ── IMPORT FROM SCREENER ──
function addAllToPipeline() {
  if(!lastScreenResults.length) return;
  var jd = jdState.text || document.getElementById('jdText').value.trim();
  var roleTitle = 'Screened Role';
  var roleFunction = 'HR';

  // Try to detect role from JD
  if(jd) {
    var jdLower = jd.toLowerCase();
    if(jdLower.includes('finance')||jdLower.includes('financial')) roleFunction='Finance';
    else if(jdLower.includes('market')) roleFunction='Marketing';
    else if(jdLower.includes('sales')) roleFunction='Sales';
    else if(jdLower.includes('supply')||jdLower.includes('logistics')) roleFunction='Supply Chain';
    else if(jdLower.includes('it ')||jdLower.includes('technology')||jdLower.includes('software')) roleFunction='IT';
    else if(jdLower.includes('legal')||jdLower.includes('compliance')) roleFunction='Legal';
    else if(jdLower.includes('operations')) roleFunction='Operations';
  }

  // Create a new role for this screening
  var newRole = { id:'role-'+nextRoleId++, title:roleTitle, function:roleFunction, status:'Active', headcount:1, filled:false, candidates:[] };
  lastScreenResults.forEach(function(c) {
    newRole.candidates.push({
      id: nextCandId++,
      name: c.name,
      score: c.score,
      stage: 'Applied',
      date: todayStr(),
      stageDate: todayStr(),
      notes: c.verdict+' — '+(c.matched_skills||[]).slice(0,3).join(', '),
      rejectionReason: ''
    });
  });
  newRole.candidates.sort(function(a,b){return b.score-a.score;});
  roles.push(newRole);

  // Switch to pipeline tab and open the new role
  switchTab('pipeline');
  setTimeout(function(){ openRolePipeline(newRole.id); }, 100);

  var btn = event.target.closest('button');
  if(btn) {
    btn.innerHTML='<i class="ti ti-check" style="font-size:14px"></i>Added to Pipeline';
    btn.style.background='#EAF3DE'; btn.style.color='#085041';
    setTimeout(function(){ btn.innerHTML='<i class="ti ti-layout-kanban" style="font-size:14px"></i>Add all to Pipeline'; btn.style.background=''; btn.style.color=''; },2500);
  }
}

// ── EXPORT ──
function exportRoleCSV() {
  var pCandidates = getActiveCandidates();
  if(!pCandidates.length) { alert('No candidates to export.'); return; }
  var role = roles.find(function(r){return r.id===activeRoleId;});
  var headers = ['Rank','Candidate','Score','Stage','Rejection Reason','Days in Stage','Date Added','Notes'];
  var rows = pCandidates.map(function(c,i){ return [i+1,c.name,c.score,c.stage,c.rejectionReason||'',daysSince(c.stageDate||c.date),c.date,c.notes||''].map(function(v){return '"'+v+'"';}).join(','); });
  var csv = [headers.join(',')].concat(rows).join('\n');
  var blob = new Blob([csv],{type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href=url; a.download='TalentScreen_'+(role?role.title.replace(/ /g,'_'):'Pipeline')+'.csv';
  a.click(); URL.revokeObjectURL(url);
}

// ── REJECTED TOGGLE ──
var rejectedVisible = false;
function toggleRejected() {
  rejectedVisible = !rejectedVisible;
  var wrap = document.getElementById('rejectedTableWrap');
  var label = document.getElementById('rejectedLabel');
  var chevron = document.getElementById('rejectedChevron');
  if(wrap) wrap.style.maxHeight = rejectedVisible ? '600px' : '0';
  if(label) label.textContent = rejectedVisible ? 'Hide' : 'Show';
  if(chevron) chevron.style.transform = rejectedVisible ? 'rotate(180deg)' : 'rotate(0deg)';
}


document.addEventListener('DOMContentLoaded', () => { renderPipeline(); });

// ── Rejected section toggle handled in pipeline section ──
