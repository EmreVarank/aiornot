// ─── State ───────────────────────────────────────────────────────────────────

let currentText = '';
let fileLoaded = false;
let analysisInProgress = false;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const themeToggle    = $('theme-toggle');

const tabText        = $('tab-text');
const tabUpload      = $('tab-upload');
const panelText      = $('panel-text');
const panelUpload    = $('panel-upload');

const textarea       = $('text-input');
const charCount      = $('char-count');
const btnClear       = $('btn-clear');

const uploadZone     = $('upload-zone');
const fileInput      = $('file-input');
const fileInfo       = $('file-info');
const fileName       = $('file-name');
const fileSize       = $('file-size');
const btnRemoveFile  = $('btn-remove-file');

const btnAnalyze     = $('btn-analyze');
const btnText        = btnAnalyze.querySelector('.btn-text');
const btnLoader      = btnAnalyze.querySelector('.btn-loader');

const resultsSection = $('results-section');
const fallbackBanner = $('fallback-banner');
const fallbackMsg    = $('fallback-msg');

const ringProgress   = $('ring-progress');
const ringPct        = $('ring-pct');
const verdictBadge   = $('verdict-badge');
const verdictTitle   = $('verdict-title');
const verdictDesc    = $('verdict-desc');
const highlightBody  = $('highlight-body');

const btnNewAnalysis = $('btn-new-analysis');
const btnCopyReport  = $('btn-copy-report');

// ─── Theme ────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

// ─── Backend API Call ─────────────────────────────────────────────────────────

async function callAnalyzeAPI(text) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (res.status === 429) throw new Error('Rate limit reached. Please wait a moment.');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error (${res.status})`);
  }
  return res.json();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  if (tab === 'text') {
    tabText.classList.add('active'); tabUpload.classList.remove('active');
    panelText.classList.add('active'); panelUpload.classList.remove('active');
  } else {
    tabUpload.classList.add('active'); tabText.classList.remove('active');
    panelUpload.classList.add('active'); panelText.classList.remove('active');
  }
}

tabText.addEventListener('click', () => switchTab('text'));
tabUpload.addEventListener('click', () => switchTab('upload'));

// ─── Text Input ───────────────────────────────────────────────────────────────

textarea.addEventListener('input', () => {
  currentText = textarea.value;
  charCount.textContent = `${currentText.length} characters`;
  updateAnalyzeBtn();
});

btnClear.addEventListener('click', () => {
  textarea.value = ''; currentText = '';
  charCount.textContent = '0 characters';
  updateAnalyzeBtn();
});

// ─── File Upload ──────────────────────────────────────────────────────────────

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.querySelector('.upload-browse').addEventListener('click', e => {
  e.stopPropagation(); fileInput.click();
});

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

btnRemoveFile.addEventListener('click', () => {
  fileLoaded = false; currentText = '';
  fileInfo.classList.add('hidden'); uploadZone.classList.remove('hidden');
  fileInput.value = ''; updateAnalyzeBtn();
});

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx'].includes(ext)) { alert('Only PDF and DOCX files are supported.'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('File size must be under 10MB.'); return; }

  fileName.textContent = file.name;
  fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
  uploadZone.classList.add('hidden');
  fileInfo.classList.remove('hidden');

  try {
    if (ext === 'pdf') currentText = await extractPDF(file);
    else currentText = await extractDOCX(file);
    fileLoaded = true;
    updateAnalyzeBtn();
  } catch (err) {
    alert('Failed to extract text from file: ' + err.message);
    btnRemoveFile.click();
  }
}

async function extractPDF(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text.trim();
}

async function extractDOCX(file) {
  const ab = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: ab });
  return result.value.trim();
}

// ─── Analyze Button ───────────────────────────────────────────────────────────

function updateAnalyzeBtn() {
  btnAnalyze.disabled = currentText.length < 50;
}

// ─── Main Analysis Flow ───────────────────────────────────────────────────────

btnAnalyze.addEventListener('click', handleAnalyze);

async function handleAnalyze() {
  if (analysisInProgress || currentText.length < 50) return;
  analysisInProgress = true;

  btnText.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  btnAnalyze.disabled = true;

  try {
    let apiResult = null;
    let apiError  = null;
    const heuristicPromise = Promise.resolve(analyzeText(currentText));
    const apiPromise = callAnalyzeAPI(currentText).catch(e => { apiError = e; return null; });

    const [heuristic, api] = await Promise.all([heuristicPromise, apiPromise]);
    apiResult = api;

    displayResults(apiResult, heuristic, apiError);
  } catch (err) {
    console.error(err);
    alert('Analysis failed: ' + err.message);
  } finally {
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
    btnAnalyze.disabled = false;
    analysisInProgress = false;
  }
}

// ─── Display Results ──────────────────────────────────────────────────────────

function displayResults(apiResult, heuristic, apiError) {
  let aiScore, verdict, confidence, reasoning;

  if (apiResult) {
    verdict = apiResult.verdict;
    confidence = apiResult.confidence;
    reasoning = apiResult.reasoning;
    if (verdict === 'human') {
      aiScore = 100 - confidence;
    } else if (verdict === 'mixed') {
      // Derive real AI% from sentence labels
      if (apiResult.sentences?.length) {
        const aiCount    = apiResult.sentences.filter(s => s.label === 'ai').length;
        const mixedCount = apiResult.sentences.filter(s => s.label === 'mixed').length;
        aiScore = Math.round((aiCount + mixedCount * 0.5) / apiResult.sentences.length * 100);
      } else {
        aiScore = confidence;
      }
    } else {
      aiScore = confidence;
    }
    fallbackBanner.classList.add('hidden');
  } else {
    aiScore = heuristic.overallScore;
    verdict = aiScore >= 60 ? 'ai' : aiScore >= 30 ? 'mixed' : 'human';
    confidence = aiScore >= 60 ? aiScore : aiScore <= 30 ? (100 - aiScore) : Math.abs(50 - aiScore) + 50;
    reasoning = generateFallbackReasoning(heuristic, verdict);
    fallbackBanner.classList.remove('hidden');
    if (apiError) fallbackMsg.textContent = `API temporarily unavailable: ${apiError.message}. Showing heuristic analysis only.`;
    else fallbackMsg.textContent = 'API unavailable. Results are based on heuristic analysis only.';
  }

  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  animateRing(aiScore, verdict);

  verdictBadge.className = `verdict-badge verdict-${verdict}`;
  verdictBadge.textContent = verdict === 'ai' ? 'AI Generated' : verdict === 'human' ? 'Human Written' : 'Mixed Content';
  verdictTitle.textContent = verdict === 'ai' ? 'This content appears to be AI-generated' : verdict === 'human' ? 'This content appears to be human-written' : 'This content appears to be a mix of AI and human writing';
  verdictDesc.textContent = reasoning;

  const metricsOrder = ['uniformity', 'vocabulary', 'burstiness', 'patterns', 'coherence', 'naturalness'];
  metricsOrder.forEach((key, i) => {
    const m = heuristic.metrics[key];
    setTimeout(() => {
      const fill = $(`mfill-${key}`);
      const val  = $(`mval-${key}`);
      if (fill) fill.style.width = `${m.score}%`;
      if (val) val.textContent = `${m.score}% — ${m.detail}`;
    }, i * 120);
  });

  renderSentenceHighlights(apiResult, heuristic);
}

function generateFallbackReasoning(heuristic, verdict) {
  const { uniformity, vocabulary, burstiness, patterns, naturalness } = heuristic.metrics;
  if (verdict === 'ai') {
    return `The text shows strong AI indicators: sentence uniformity is ${uniformity.label.toLowerCase()} (${uniformity.detail}), and AI phrase pattern density is ${patterns.label.toLowerCase()}. Naturalness score is low, suggesting limited use of contractions and personal language.`;
  } else if (verdict === 'human') {
    return `The text exhibits human writing characteristics: high burstiness (${burstiness.detail}) suggests natural rhythm variation, and vocabulary richness is ${vocabulary.label.toLowerCase()}. The naturalness score indicates organic language use.`;
  }
  return `The text shows mixed signals — some sections exhibit AI-like uniformity while others display natural human variation. Consider reviewing section by section using the sentence highlights below.`;
}

function animateRing(score, verdict) {
  const circumference = 527.8;
  const colorMap = {
    ai:    ['#f472b6', '#ec4899'],
    human: ['#34d399', '#10b981'],
    mixed: ['#fbbf24', '#f59e0b'],
  };
  const [c1, c2] = colorMap[verdict] || colorMap.mixed;
  document.documentElement.style.setProperty('--ring-c1', c1);
  document.documentElement.style.setProperty('--ring-c2', c2);

  ringProgress.style.strokeDashoffset = circumference;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const offset = circumference - (score / 100) * circumference;
      ringProgress.style.strokeDashoffset = offset;
    });
  });

  let current = 0;
  const target = score;
  const duration = 1500;
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    current = Math.round(eased * target);
    ringPct.textContent = `${current}%`;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderSentenceHighlights(apiResult, heuristic) {
  highlightBody.innerHTML = '';

  // Prefer Gemini's sentence-level labels — they are authoritative
  if (apiResult?.sentences?.length) {
    apiResult.sentences.forEach(s => {
      const label = ['ai', 'human', 'mixed'].includes(s.label) ? s.label : 'mixed';
      const span = document.createElement('span');
      span.className = `hl-sentence hl-${label}`;
      span.textContent = s.text + ' ';
      span.title = `AI probability: ${s.confidence}%`;
      highlightBody.appendChild(span);
    });
    return;
  }

  // Fallback: use heuristic sentence scores when API is unavailable
  heuristic.sentences.forEach(({ text, score }) => {
    const label = score >= 55 ? 'ai' : score >= 30 ? 'mixed' : 'human';
    const span = document.createElement('span');
    span.className = `hl-sentence hl-${label}`;
    span.textContent = text + ' ';
    span.title = `AI probability: ${score}%`;
    highlightBody.appendChild(span);
  });
}

// ─── Result Actions ───────────────────────────────────────────────────────────

btnNewAnalysis.addEventListener('click', () => {
  resultsSection.classList.add('hidden');
  textarea.value = ''; currentText = '';
  charCount.textContent = '0 characters';
  updateAnalyzeBtn();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

btnCopyReport.addEventListener('click', () => {
  const badge = verdictBadge.textContent;
  const title = verdictTitle.textContent;
  const desc  = verdictDesc.textContent;
  const mKeys = ['uniformity','vocabulary','burstiness','patterns','coherence','naturalness'];
  const metricsText = mKeys.map(k => {
    const el = $(`mval-${k}`);
    return `  ${k}: ${el ? el.textContent : ''}`;
  }).join('\n');

  const report = `AI Checker — Analysis Report\n${'='.repeat(40)}\n${badge}\n${title}\n\n${desc}\n\nMetrics:\n${metricsText}\n\nAnalyzed: ${new Date().toLocaleString()}`;
  navigator.clipboard.writeText(report).then(() => {
    const orig = btnCopyReport.innerHTML;
    btnCopyReport.textContent = 'Copied!';
    setTimeout(() => { btnCopyReport.innerHTML = orig; }, 2000);
  });
});

// ─── FAQ Accordion ────────────────────────────────────────────────────────────

document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

// ─── Animated Counter ─────────────────────────────────────────────────────────

function animateCounters() {
  document.querySelectorAll('.stat-number[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count);
    const duration = 2000;
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);
      el.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// ─── Scroll Reveal ────────────────────────────────────────────────────────────

function initScrollReveal() {
  const els = document.querySelectorAll('.step-card, .use-case-card, .testimonial-card, .faq-item, .cta-card');
  els.forEach(el => el.classList.add('reveal'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  els.forEach(el => observer.observe(el));
}

// ─── Particles ────────────────────────────────────────────────────────────────

function initParticles() {
  const container = $('particles');
  if (!container) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.style.cssText = `
      position:fixed; border-radius:50%; pointer-events:none; z-index:-1;
      width:${2 + Math.random() * 4}px; height:${2 + Math.random() * 4}px;
      background:rgba(129,140,248,${0.2 + Math.random() * 0.3});
      left:${Math.random() * 100}%; top:${Math.random() * 100}%;
      animation:float${i % 3} ${8 + Math.random() * 8}s ease-in-out infinite;
      animation-delay:${-Math.random() * 10}s;
    `;
    container.appendChild(p);
  }
}

const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes float0 { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
  @keyframes float1 { 0%,100%{transform:translateY(0) translateX(0)} 50%{transform:translateY(-15px) translateX(10px)} }
  @keyframes float2 { 0%,100%{transform:translateY(0) translateX(0)} 50%{transform:translateY(20px) translateX(-8px)} }
`;
document.head.appendChild(styleEl);

// ─── Init ─────────────────────────────────────────────────────────────────────

initTheme();
initParticles();
initScrollReveal();
animateCounters();
