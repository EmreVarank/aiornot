// ─── Helpers ────────────────────────────────────────────────────────────────

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 4);
}

function splitParagraphs(text) {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
}

function getWords(text) {
  return text.toLowerCase().replace(/[^a-z']/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function scoreLabel(score) {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

// ─── Metric 1: Sentence Uniformity ──────────────────────────────────────────

function calcUniformity(sentences) {
  if (sentences.length < 3) return { score: 50, label: 'N/A', detail: 'Too few sentences' };
  const lengths = sentences.map(s => s.split(/\s+/).length);
  const m = mean(lengths);
  if (m === 0) return { score: 50, label: 'N/A', detail: 'Empty' };
  const cv = stddev(lengths) / m;

  let score;
  if (cv < 0.25) score = clamp(85 + (0.25 - cv) * 60, 0, 100);
  else if (cv <= 0.45) score = 50 + (0.45 - cv) * 175;
  else score = clamp(50 - (cv - 0.45) * 80, 10, 50);

  return { score: Math.round(score), label: scoreLabel(score), detail: `CV: ${cv.toFixed(2)}` };
}

// ─── Metric 2: Vocabulary Richness ──────────────────────────────────────────

const STOP_WORDS = new Set(['the','a','an','is','are','was','were','in','on','at','to','for',
  'of','and','but','or','with','that','this','it','he','she','they','we','you','i','my','me',
  'his','her','its','our','your','their','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','shall','can','not','as','by','from',
  'up','out','if','about','into','through','during','before','after','above','below','between']);

function calcVocabulary(words) {
  const filtered = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  if (filtered.length < 20) return { score: 50, label: 'N/A', detail: 'Too short' };

  // MATTR: sliding window of 50
  const windowSize = 50;
  const ttrs = [];
  for (let i = 0; i <= filtered.length - windowSize; i++) {
    const window = filtered.slice(i, i + windowSize);
    const unique = new Set(window).size;
    ttrs.push(unique / windowSize);
  }
  const mattr = ttrs.length ? mean(ttrs) : new Set(filtered).size / filtered.length;

  // Hapax bonus
  const freq = {};
  filtered.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const hapax = Object.values(freq).filter(c => c === 1).length / Object.keys(freq).length;

  let score;
  if (mattr < 0.55) score = clamp(70 + (0.55 - mattr) * 200, 0, 100);
  else if (mattr <= 0.72) score = 35 + (0.72 - mattr) * 206;
  else score = clamp(35 - (mattr - 0.72) * 107, 5, 35);

  if (hapax < 0.4) score = clamp(score + 10, 0, 100);

  return { score: Math.round(score), label: scoreLabel(score), detail: `MATTR: ${mattr.toFixed(2)}` };
}

// ─── Metric 3: Burstiness ───────────────────────────────────────────────────

function calcBurstiness(sentences) {
  if (sentences.length < 4) return { score: 50, label: 'N/A', detail: 'Too few sentences' };

  const complexities = sentences.map(s => {
    const words = s.split(/\s+/);
    const wc = words.length;
    const avgWL = mean(words.map(w => w.length));
    const commas = (s.match(/,/g) || []).length;
    return (wc / 20) * 0.5 + (avgWL / 8) * 0.3 + (commas / 3) * 0.2;
  });

  const diffs = [];
  for (let i = 1; i < complexities.length; i++) {
    diffs.push(Math.abs(complexities[i] - complexities[i - 1]));
  }

  const dm = mean(diffs);
  if (dm === 0) return { score: 90, label: 'High', detail: 'Completely uniform rhythm' };
  const burstiness = stddev(diffs) / dm;

  let score;
  if (burstiness < 0.5) score = clamp(75 + (0.5 - burstiness) * 50, 0, 100);
  else if (burstiness <= 1.0) score = 35 + (1.0 - burstiness) * 80;
  else score = clamp(35 - (burstiness - 1.0) * 30, 5, 35);

  return { score: Math.round(score), label: scoreLabel(score), detail: `Burstiness: ${burstiness.toFixed(2)}` };
}

// ─── Metric 4: AI Phrase Patterns ───────────────────────────────────────────

const AI_PATTERNS = [
  // Weight 3
  { p: "it's worth noting", w: 3 }, { p: "it is worth noting", w: 3 },
  { p: "it's important to note", w: 3 }, { p: "it is important to note", w: 3 },
  { p: "this underscores", w: 3 }, { p: "plays a crucial role", w: 3 },
  { p: "it is essential to", w: 3 }, { p: "a testament to", w: 3 },
  { p: "serves as a reminder", w: 3 }, { p: "navigating the complexities", w: 3 },
  { p: "in today's rapidly", w: 3 }, { p: "at the forefront", w: 3 },
  { p: "the landscape of", w: 3 },
  // Weight 2
  { p: "moreover", w: 2 }, { p: "furthermore", w: 2 }, { p: "in conclusion", w: 2 },
  { p: "delve into", w: 2 }, { p: "delve deeper", w: 2 },
  { p: "here are some", w: 2 }, { p: "there are several", w: 2 },
  { p: "in summary", w: 2 }, { p: "to summarize", w: 2 }, { p: "in essence", w: 2 },
  { p: "it should be noted", w: 2 }, { p: "one could argue", w: 2 },
  { p: "on the other hand", w: 2 }, { p: "having said that", w: 2 },
  { p: "that being said", w: 2 }, { p: "with that in mind", w: 2 },
  // Weight 1
  { p: "groundbreaking", w: 1 }, { p: "transformative", w: 1 }, { p: "revolutionary", w: 1 },
  { p: "cutting-edge", w: 1 }, { p: "game-changer", w: 1 }, { p: "leverage", w: 1 },
  { p: "utilize", w: 1 }, { p: "facilitate", w: 1 }, { p: "comprehensive", w: 1 },
  { p: "robust", w: 1 }, { p: "seamless", w: 1 }, { p: "streamline", w: 1 },
  { p: "holistic", w: 1 }, { p: "synergy", w: 1 },
  { p: "i'd be happy to", w: 1 }, { p: "absolutely!", w: 1 }, { p: "great question", w: 1 },
];

function calcPatterns(text, wordCount) {
  if (wordCount < 20) return { score: 50, label: 'N/A', detail: 'Too short' };
  const lower = text.toLowerCase();
  let weighted = 0;
  const found = [];
  AI_PATTERNS.forEach(({ p, w }) => {
    const regex = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = (lower.match(regex) || []).length;
    if (matches > 0) { weighted += matches * w; found.push(p); }
  });

  const density = weighted / (wordCount / 1000);
  let score;
  if (density > 8) score = clamp(80 + (density - 8) * 2.5, 0, 100);
  else if (density >= 3) score = 40 + (density - 3) * 8;
  else score = clamp(density * 13.3, 5, 40);

  return { score: Math.round(score), label: scoreLabel(score), detail: `Density: ${density.toFixed(1)}/1k words` };
}

// ─── Metric 5: Structural Coherence ─────────────────────────────────────────

function calcCoherence(paragraphs) {
  if (paragraphs.length <= 1) return { score: 50, label: 'N/A', detail: 'Single paragraph' };

  const pLengths = paragraphs.map(p => p.split(/\s+/).length);
  const m = mean(pLengths);
  const cv = m > 0 ? stddev(pLengths) / m : 0;

  const topicSentenceRe = /^(the|this|one|in|when|while|as|today|modern|it is|there are|many|most|some)/i;
  const topicCount = paragraphs.filter(p => topicSentenceRe.test(p.trim())).length;
  const topicRatio = topicCount / paragraphs.length;

  let score = 50;
  if (cv < 0.3) score = 70 + (0.3 - cv) * 100;
  else if (cv < 0.6) score = 40 + (0.6 - cv) * 100;
  else score = clamp(40 - (cv - 0.6) * 50, 10, 40);

  score = clamp(score + topicRatio * 20, 0, 100);
  return { score: Math.round(score), label: scoreLabel(score), detail: `Para CV: ${cv.toFixed(2)}` };
}

// ─── Metric 6: Naturalness ───────────────────────────────────────────────────

const CONTRACTIONS = ["don't","can't","won't","i'm","i've","i'll","it's","he's","she's",
  "we're","they're","isn't","aren't","wasn't","weren't","doesn't","didn't","couldn't",
  "shouldn't","wouldn't","hasn't","haven't","hadn't","let's","that's","there's","who's","what's"];

const FIRST_PERSON = ['\\bi\\b', '\\bme\\b', '\\bmy\\b', '\\bmine\\b', '\\bmyself\\b',
  '\\bwe\\b', '\\bus\\b', '\\bour\\b', '\\bours\\b'];

function calcNaturalness(text, sentences, wordCount) {
  if (wordCount < 20) return { score: 50, label: 'N/A', detail: 'Too short' };
  const lower = text.toLowerCase();

  const contractionCount = CONTRACTIONS.reduce((c, x) => c + (lower.split(x).length - 1), 0);
  const contractionRate = (contractionCount / wordCount) * 1000;

  const fpCount = FIRST_PERSON.reduce((c, r) => c + (lower.match(new RegExp(r, 'g')) || []).length, 0);
  const fpRate = (fpCount / wordCount) * 1000;

  const questionRate = sentences.filter(s => s.trim().endsWith('?')).length / sentences.length;
  const exclRate = sentences.filter(s => s.trim().endsWith('!')).length / sentences.length;

  const raw = (contractionRate * 0.3) + (fpRate * 0.3) + (questionRate * 100 * 0.2) + (exclRate * 100 * 0.2);
  const score = clamp(100 - raw * 2, 0, 100);

  return { score: Math.round(score), label: scoreLabel(score), detail: `Contractions: ${contractionCount}` };
}

// ─── Sentence-level scoring ──────────────────────────────────────────────────

function scoreSentence(sentence, avgLen, allPatterns) {
  const words = sentence.split(/\s+/);
  const wc = words.length;
  const lower = sentence.toLowerCase();

  const lenDiff = avgLen > 0 ? Math.abs(wc - avgLen) / avgLen : 0;
  const lenScore = clamp(lenDiff < 0.3 ? 60 : 60 - (lenDiff - 0.3) * 50, 10, 80);

  let patternScore = 0;
  AI_PATTERNS.forEach(({ p, w }) => { if (lower.includes(p)) patternScore += w * 20; });
  patternScore = clamp(patternScore, 0, 100);

  const hasContraction = CONTRACTIONS.some(c => lower.includes(c));

  return clamp(lenScore * 0.25 + patternScore * 0.55 + (hasContraction ? 0 : 20) * 0.2, 0, 100);
}

// ─── Main Export ─────────────────────────────────────────────────────────────

function analyzeText(text) {
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  const words = getWords(text);
  const wordCount = words.length;

  const uniformity = calcUniformity(sentences);
  const vocabulary = calcVocabulary(words);
  const burstiness = calcBurstiness(sentences);
  const patterns   = calcPatterns(text, wordCount);
  const coherence  = calcCoherence(paragraphs);
  const naturalness = calcNaturalness(text, sentences, wordCount);

  const overallScore = Math.round(
    uniformity.score  * 0.20 +
    vocabulary.score  * 0.15 +
    burstiness.score  * 0.20 +
    patterns.score    * 0.20 +
    coherence.score   * 0.15 +
    naturalness.score * 0.10
  );

  const avgLen = sentences.length ? mean(sentences.map(s => s.split(/\s+/).length)) : 0;
  const analyzedSentences = sentences.map(s => ({
    text: s,
    score: Math.round(scoreSentence(s, avgLen, AI_PATTERNS))
  }));

  return { overallScore, metrics: { uniformity, vocabulary, burstiness, patterns, coherence, naturalness }, sentences: analyzedSentences };
}
