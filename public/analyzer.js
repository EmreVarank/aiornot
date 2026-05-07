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

  // AI text: very uniform (low CV). Human: varies more (high CV).
  let score;
  if (cv < 0.20) score = clamp(95 + (0.20 - cv) * 50, 0, 100);
  else if (cv < 0.35) score = 65 + (0.35 - cv) * 200;
  else if (cv <= 0.55) score = 40 + (0.55 - cv) * 125;
  else score = clamp(40 - (cv - 0.55) * 80, 5, 40);

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

  // AI text tends to be moderate vocabulary — not too repetitive, not wildly varied.
  // Very low MATTR = repetitive (slightly AI-like), moderate = AI sweet spot, high = human
  let score;
  if (mattr < 0.55) score = clamp(65 + (0.55 - mattr) * 180, 0, 100);
  else if (mattr <= 0.70) score = 40 + (0.70 - mattr) * 167;
  else score = clamp(40 - (mattr - 0.70) * 100, 5, 40);

  // Low hapax ratio suggests repetitive vocabulary (AI-like)
  if (hapax < 0.35) score = clamp(score + 15, 0, 100);

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
  if (dm === 0) return { score: 95, label: 'High', detail: 'Completely uniform rhythm' };
  const burstiness = stddev(diffs) / dm;

  // Low burstiness = AI (smooth, predictable complexity changes)
  let score;
  if (burstiness < 0.4) score = clamp(85 + (0.4 - burstiness) * 62, 0, 100);
  else if (burstiness <= 0.9) score = 40 + (0.9 - burstiness) * 90;
  else score = clamp(40 - (burstiness - 0.9) * 35, 5, 40);

  return { score: Math.round(score), label: scoreLabel(score), detail: `Burstiness: ${burstiness.toFixed(2)}` };
}

// ─── Metric 4: AI Phrase Patterns ───────────────────────────────────────────

const AI_PATTERNS = [
  // Weight 4 — dead giveaways
  { p: "it's worth noting", w: 4 },
  { p: "it is worth noting", w: 4 },
  { p: "it's important to note", w: 4 },
  { p: "it is important to note", w: 4 },
  { p: "this underscores", w: 4 },
  { p: "plays a crucial role", w: 4 },
  { p: "plays a vital role", w: 4 },
  { p: "it is essential to", w: 4 },
  { p: "a testament to", w: 4 },
  { p: "serves as a reminder", w: 4 },
  { p: "navigating the complexities", w: 4 },
  { p: "in today's rapidly", w: 4 },
  { p: "at the forefront", w: 4 },
  { p: "the landscape of", w: 4 },
  { p: "i'd be happy to", w: 4 },
  { p: "i'm here to help", w: 4 },
  { p: "as an ai", w: 4 },
  { p: "delve into", w: 4 },
  { p: "delve deeper", w: 4 },
  { p: "let's delve", w: 4 },
  // Weight 3 — very common AI phrases
  { p: "moreover", w: 3 },
  { p: "furthermore", w: 3 },
  { p: "in conclusion", w: 3 },
  { p: "in summary", w: 3 },
  { p: "to summarize", w: 3 },
  { p: "in essence", w: 3 },
  { p: "it should be noted", w: 3 },
  { p: "one could argue", w: 3 },
  { p: "on the other hand", w: 3 },
  { p: "having said that", w: 3 },
  { p: "that being said", w: 3 },
  { p: "with that in mind", w: 3 },
  { p: "here are some", w: 3 },
  { p: "there are several", w: 3 },
  { p: "there are many", w: 3 },
  { p: "it is crucial", w: 3 },
  { p: "it is vital", w: 3 },
  { p: "it is imperative", w: 3 },
  { p: "it is worth", w: 3 },
  { p: "needless to say", w: 3 },
  { p: "first and foremost", w: 3 },
  { p: "last but not least", w: 3 },
  { p: "in the realm of", w: 3 },
  { p: "in the world of", w: 3 },
  { p: "in today's world", w: 3 },
  { p: "in today's digital", w: 3 },
  { p: "in recent years", w: 3 },
  { p: "it goes without saying", w: 3 },
  { p: "by and large", w: 3 },
  { p: "all in all", w: 3 },
  // Weight 2 — common AI words/constructs
  { p: "groundbreaking", w: 2 },
  { p: "transformative", w: 2 },
  { p: "revolutionary", w: 2 },
  { p: "cutting-edge", w: 2 },
  { p: "game-changer", w: 2 },
  { p: "game changer", w: 2 },
  { p: "leverage", w: 2 },
  { p: "utilize", w: 2 },
  { p: "facilitate", w: 2 },
  { p: "comprehensive", w: 2 },
  { p: "robust", w: 2 },
  { p: "seamless", w: 2 },
  { p: "streamline", w: 2 },
  { p: "holistic", w: 2 },
  { p: "synergy", w: 2 },
  { p: "absolutely!", w: 2 },
  { p: "great question", w: 2 },
  { p: "foster", w: 2 },
  { p: "in order to", w: 2 },
  { p: "in addition to", w: 2 },
  { p: "a wide range of", w: 2 },
  { p: "a variety of", w: 2 },
  { p: "it is important", w: 2 },
  { p: "it is necessary", w: 2 },
  { p: "it is possible", w: 2 },
  { p: "this allows", w: 2 },
  { p: "this enables", w: 2 },
  { p: "this ensures", w: 2 },
  { p: "this helps", w: 2 },
  { p: "this means that", w: 2 },
  { p: "in other words", w: 2 },
  { p: "to put it simply", w: 2 },
  { p: "simply put", w: 2 },
  { p: "as mentioned", w: 2 },
  { p: "as noted", w: 2 },
  { p: "as discussed", w: 2 },
  { p: "as previously", w: 2 },
  { p: "it's clear that", w: 2 },
  { p: "it is clear that", w: 2 },
  { p: "it's evident that", w: 2 },
  { p: "it is evident that", w: 2 },
  { p: "undoubtedly", w: 2 },
  { p: "ultimately", w: 2 },
  { p: "overall", w: 2 },
  { p: "however, it", w: 2 },
  { p: "nevertheless", w: 2 },
  { p: "consequently", w: 2 },
  { p: "therefore", w: 2 },
  { p: "thus", w: 2 },
  { p: "hence", w: 2 },
  { p: "significant", w: 2 },
  { p: "substantial", w: 2 },
  { p: "paramount", w: 2 },
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

  const density = weighted / (wordCount / 100);  // per 100 words (more sensitive)
  let score;
  if (density > 6) score = clamp(85 + (density - 6) * 3, 0, 100);
  else if (density >= 2) score = 45 + (density - 2) * 10;
  else score = clamp(density * 22, 5, 45);

  return { score: Math.round(score), label: scoreLabel(score), detail: `Density: ${density.toFixed(1)}/100 words` };
}

// ─── Metric 5: Structural Coherence ─────────────────────────────────────────

function calcCoherence(paragraphs) {
  if (paragraphs.length <= 1) return { score: 50, label: 'N/A', detail: 'Single paragraph' };

  const pLengths = paragraphs.map(p => p.split(/\s+/).length);
  const m = mean(pLengths);
  const cv = m > 0 ? stddev(pLengths) / m : 0;

  const topicSentenceRe = /^(the|this|one|in|when|while|as|today|modern|it is|there are|many|most|some|overall|additionally|furthermore|moreover)/i;
  const topicCount = paragraphs.filter(p => topicSentenceRe.test(p.trim())).length;
  const topicRatio = topicCount / paragraphs.length;

  // AI: very uniform paragraph lengths (low CV) + formulaic topic sentences
  let score = 50;
  if (cv < 0.25) score = 75 + (0.25 - cv) * 120;
  else if (cv < 0.50) score = 40 + (0.50 - cv) * 140;
  else score = clamp(40 - (cv - 0.50) * 55, 10, 40);

  score = clamp(score + topicRatio * 25, 0, 100);
  return { score: Math.round(score), label: scoreLabel(score), detail: `Para CV: ${cv.toFixed(2)}` };
}

// ─── Metric 6: Naturalness ───────────────────────────────────────────────────

const CONTRACTIONS = ["don't","can't","won't","i'm","i've","i'll","it's","he's","she's",
  "we're","they're","isn't","aren't","wasn't","weren't","doesn't","didn't","couldn't",
  "shouldn't","wouldn't","hasn't","haven't","hadn't","let's","that's","there's","who's","what's",
  "you're","you've","you'll","they've","they'll","we've","we'll","i'd","you'd","he'd","she'd",
  "we'd","they'd","it'll","that'll","there'll","here's","how's","when's","where's","why's"];

const FIRST_PERSON = ['\\bi\\b', '\\bme\\b', '\\bmy\\b', '\\bmine\\b', '\\bmyself\\b'];

function calcNaturalness(text, sentences, wordCount) {
  if (wordCount < 20) return { score: 50, label: 'N/A', detail: 'Too short' };
  const lower = text.toLowerCase();

  const contractionCount = CONTRACTIONS.reduce((c, x) => c + (lower.split(x).length - 1), 0);
  const contractionRate = (contractionCount / wordCount) * 100;

  const fpCount = FIRST_PERSON.reduce((c, r) => c + (lower.match(new RegExp(r, 'g')) || []).length, 0);
  const fpRate = (fpCount / wordCount) * 100;

  const questionCount = sentences.filter(s => s.trim().endsWith('?')).length;
  const exclCount = sentences.filter(s => s.trim().endsWith('!')).length;
  const questionRate = questionCount / sentences.length;
  const exclRate = exclCount / sentences.length;

  // High naturalness score = more AI (less human markers)
  // More contractions/first-person = more human = lower AI score
  const humanScore = clamp(
    contractionRate * 12 +
    fpRate * 8 +
    questionRate * 30 +
    exclRate * 20,
    0, 100
  );
  const score = clamp(100 - humanScore, 0, 100);

  return { score: Math.round(score), label: scoreLabel(score), detail: `Contractions: ${contractionCount}` };
}

// ─── Sentence-level scoring ──────────────────────────────────────────────────

function scoreSentence(sentence, avgLen, allPatterns) {
  const words = sentence.split(/\s+/);
  const wc = words.length;
  const lower = sentence.toLowerCase();

  // Length proximity to average (AI = close to average)
  const lenDiff = avgLen > 0 ? Math.abs(wc - avgLen) / avgLen : 0;
  const lenScore = lenDiff < 0.2 ? 70 : lenDiff < 0.4 ? 50 : lenDiff < 0.7 ? 30 : 15;

  // AI pattern matches
  let patternScore = 0;
  AI_PATTERNS.forEach(({ p, w }) => {
    if (lower.includes(p)) patternScore += w * 18;
  });
  patternScore = clamp(patternScore, 0, 100);

  // Human markers
  const hasContraction = CONTRACTIONS.some(c => lower.includes(c));
  const hasFirstPerson = /\bi\b|\bme\b|\bmy\b/.test(lower);
  const endsQuestion = sentence.trim().endsWith('?');
  const endsExclaim = sentence.trim().endsWith('!');

  // Formal AI words
  const formalWords = ['furthermore','moreover','additionally','consequently','therefore','nevertheless',
    'utilize','facilitate','comprehensive','implement','leverage','robust','streamline'];
  const formalCount = formalWords.filter(w => lower.includes(w)).length;
  const formalScore = clamp(formalCount * 20, 0, 60);

  const humanPenalty = (hasContraction ? 25 : 0) + (hasFirstPerson ? 15 : 0) + (endsQuestion ? 15 : 0) + (endsExclaim ? 10 : 0);

  const raw = lenScore * 0.20 + patternScore * 0.40 + formalScore * 0.20 + (hasContraction ? 0 : 15) * 0.20 - humanPenalty * 0.25;
  return clamp(Math.round(raw), 0, 100);
}

// ─── Main Export ─────────────────────────────────────────────────────────────

function analyzeText(text) {
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  const words = getWords(text);
  const wordCount = words.length;

  const uniformity  = calcUniformity(sentences);
  const vocabulary  = calcVocabulary(words);
  const burstiness  = calcBurstiness(sentences);
  const patterns    = calcPatterns(text, wordCount);
  const coherence   = calcCoherence(paragraphs);
  const naturalness = calcNaturalness(text, sentences, wordCount);

  // Patterns and uniformity/burstiness are the strongest signals
  const overallScore = Math.round(
    uniformity.score  * 0.22 +
    vocabulary.score  * 0.12 +
    burstiness.score  * 0.22 +
    patterns.score    * 0.25 +
    coherence.score   * 0.12 +
    naturalness.score * 0.07
  );

  const avgLen = sentences.length ? mean(sentences.map(s => s.split(/\s+/).length)) : 0;
  const analyzedSentences = sentences.map(s => ({
    text: s,
    score: Math.round(scoreSentence(s, avgLen, AI_PATTERNS))
  }));

  return { overallScore, metrics: { uniformity, vocabulary, burstiness, patterns, coherence, naturalness }, sentences: analyzedSentences };
}
