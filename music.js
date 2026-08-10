/* =========================================================
   癒しのBGM — FQT LIFE COUNTERと同じ仕組みをそのまま移植
   ・著作権のある音源は一切使用せず、オシレーターのみで
     ドローン（持続音）とチャイム（きらめき音）を合成する
   ・13種類のプリセット（自然系5種＋ソルフェジオ周波数8種）
   ========================================================= */

const BGM_PRESETS = {
  moon:   { label: "🌙 月夜",     droneFreqs: [130.81, 196.00, 261.63], filterFreq: 750,  chimeScale: [523.25, 587.33, 659.25, 783.99, 880.00],   chimeMin: 4000, chimeMax: 9000 },
  ocean:  { label: "🌊 波の音",   droneFreqs: [98.00, 146.83, 196.00],   filterFreq: 550,  chimeScale: [392.00, 440.00, 523.25, 587.33, 659.25],   chimeMin: 5000, chimeMax: 11000 },
  forest: { label: "🌲 森の静寂", droneFreqs: [174.61, 220.00, 293.66],  filterFreq: 900,  chimeScale: [659.25, 739.99, 880.00, 987.77, 1174.66],  chimeMin: 3500, chimeMax: 8000 },
  star:   { label: "✨ 星空",     droneFreqs: [196.00, 246.94, 329.63],  filterFreq: 1200, chimeScale: [880.00, 987.77, 1046.50, 1318.51, 1567.98],chimeMin: 2500, chimeMax: 6000 },
  fire:   { label: "🔥 焚き火",   droneFreqs: [110.00, 164.81, 220.00],  filterFreq: 500,  chimeScale: [329.63, 392.00, 440.00, 523.25, 587.33],   chimeMin: 5000, chimeMax: 10000 }
};

// ソルフェジオ周波数（伝統的に特定の周波数に意味づけがされている音階。
// 科学的な効果が実証されているものではないが、癒し系BGMの定番として親しまれている）
function makeSolfeggioPreset(freq, filterFreq, label) {
  return {
    label,
    droneFreqs: [freq / 4, freq / 2, freq],
    filterFreq,
    chimeScale: [freq, freq * 1.125, freq * 1.25, freq * 1.5, freq * 1.875],
    chimeMin: 4500,
    chimeMax: 9500
  };
}
BGM_PRESETS.solfeggio396 = makeSolfeggioPreset(396, 700,  "396Hz｜恐れや罪悪感の解放");
BGM_PRESETS.solfeggio417 = makeSolfeggioPreset(417, 720,  "417Hz｜変化・再出発");
BGM_PRESETS.solfeggio432 = makeSolfeggioPreset(432, 780,  "432Hz｜自然との共鳴");
BGM_PRESETS.solfeggio528 = makeSolfeggioPreset(528, 850,  "528Hz｜愛・DNA修復");
BGM_PRESETS.solfeggio639 = makeSolfeggioPreset(639, 950,  "639Hz｜人間関係・調和");
BGM_PRESETS.solfeggio741 = makeSolfeggioPreset(741, 1050, "741Hz｜表現力・浄化");
BGM_PRESETS.solfeggio852 = makeSolfeggioPreset(852, 1150, "852Hz｜直感・氣づき");
BGM_PRESETS.solfeggio963 = makeSolfeggioPreset(963, 1250, "963Hz｜高次意識・統合");

// UIのselectに流し込みやすいよう、順序付きの一覧も用意しておく
const MUSIC_TRACKS = Object.keys(BGM_PRESETS).map(id => ({ id, name: BGM_PRESETS[id].label }));

const bgm = {
  ctx: null,
  master: null,
  delay: null,
  playing: false,
  chimeTimer: null,
  presetKey: "moon",
  oscillators: null,
  lfo: null
};

// 音声グラフを構築する（プリセットが変わった場合は作り直す）
function ensureAudioGraph(presetKey) {
  if (bgm.ctx && bgm.presetKey === presetKey) return;

  if (bgm.oscillators) bgm.oscillators.forEach(osc => { try { osc.stop(); } catch (e) {} });
  if (bgm.lfo) { try { bgm.lfo.stop(); } catch (e) {} }

  const preset = BGM_PRESETS[presetKey] || BGM_PRESETS.moon;
  bgm.presetKey = presetKey;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = bgm.ctx || new AudioCtx();

  // マスター音量（フェードイン・アウトに使用）
  const master = bgm.master || ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  // ディレイを使った簡易リバーブで、包み込まれるような癒しの空間を演出
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.5;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 1800;
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delay.connect(master);

  // 低音のドローン（持続音）。長3和音でやわらかく温かい響きに
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.14;
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = preset.filterFreq;
  droneGain.connect(droneFilter);
  droneFilter.connect(master);
  droneFilter.connect(delay);

  const oscillators = preset.droneFreqs.map((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.detune.value = (i - 1) * 4; // わずかにデチューンしてやさしい揺らぎを出す
    osc.connect(droneGain);
    osc.start();
    return osc;
  });

  // ゆっくりとしたLFOでドローン音量を呼吸するように揺らす（リラックス効果）
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.04;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.04;
  lfo.connect(lfoGain);
  lfoGain.connect(droneGain.gain);
  lfo.start();

  bgm.ctx = ctx;
  bgm.master = master;
  bgm.delay = delay;
  bgm.oscillators = oscillators;
  bgm.lfo = lfo;
}

// ランダムな音程でやさしいチャイム音を鳴らし、次の再生をスケジュールする
function playChime() {
  if (!bgm.playing) return;

  const preset = BGM_PRESETS[bgm.presetKey] || BGM_PRESETS.moon;
  const ctx = bgm.ctx;
  const scale = preset.chimeScale;
  const freq = scale[Math.floor(Math.random() * scale.length)];
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.09, now + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 5);

  osc.connect(gain);

  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.random() * 2 - 1;
    gain.connect(panner);
    panner.connect(bgm.master);
    panner.connect(bgm.delay);
  } else {
    gain.connect(bgm.master);
    gain.connect(bgm.delay);
  }

  osc.start(now);
  osc.stop(now + 5.2);

  const nextDelay = preset.chimeMin + Math.random() * (preset.chimeMax - preset.chimeMin);
  bgm.chimeTimer = setTimeout(playChime, nextDelay);
}

/* ---------------- 外部公開API（app.js から呼ぶ） ---------------- */

// トラック（プリセット）を指定して再生開始。既に鳴っていれば音色だけその場で切り替える
function playTrack(trackId) {
  const wasPlaying = bgm.playing;
  ensureAudioGraph(trackId);
  if (bgm.ctx.state === "suspended") bgm.ctx.resume();
  bgm.playing = true;

  const now = bgm.ctx.currentTime;
  bgm.master.gain.cancelScheduledValues(now);
  bgm.master.gain.setValueAtTime(wasPlaying ? 0.0001 : bgm.master.gain.value, now);
  bgm.master.gain.linearRampToValueAtTime(0.4, now + (wasPlaying ? 2 : 3));

  if (bgm.chimeTimer) clearTimeout(bgm.chimeTimer);
  playChime();
}

function stopTrack() {
  bgm.playing = false;
  if (bgm.chimeTimer) { clearTimeout(bgm.chimeTimer); bgm.chimeTimer = null; }
  if (bgm.ctx) {
    const now = bgm.ctx.currentTime;
    bgm.master.gain.cancelScheduledValues(now);
    bgm.master.gain.setValueAtTime(bgm.master.gain.value, now);
    bgm.master.gain.linearRampToValueAtTime(0.0001, now + 2);
  }
}

function setMusicVolume(v) {
  // 0〜1で渡ってくる値を、BGMの基準音量(0.4)に対する倍率として扱う
  if (bgm.master && bgm.ctx) {
    const now = bgm.ctx.currentTime;
    const target = bgm.playing ? 0.4 * v * 2.5 : bgm.master.gain.value;
    bgm.master.gain.cancelScheduledValues(now);
    bgm.master.gain.linearRampToValueAtTime(Math.min(target, 1), now + 0.3);
  }
}

/* ---------------- スリープタイマー ---------------- */
let sleepTimeoutId = null;
function clearSleepTimer() {
  if (sleepTimeoutId) { clearTimeout(sleepTimeoutId); sleepTimeoutId = null; }
}
function applySleepTimer(minutes, onStop) {
  clearSleepTimer();
  if (!minutes) return;
  sleepTimeoutId = setTimeout(() => {
    if (bgm.playing) { stopTrack(); if (onStop) onStop(); }
    sleepTimeoutId = null;
  }, minutes * 60 * 1000);
}

/* =========================================================
   効果音（SFX） — BGMとは独立してON/OFFできる
   BGMがすでに鳴っていればそのオーディオグラフを共用し、
   鳴っていなければ効果音専用の軽いオーディオグラフを用意する
   ========================================================= */
let sfxCtx = null, sfxMaster = null;

// 効果音は、BGM用のAudioContext(あれば)を間借りしつつも、
// 音量ノードは必ず専用のものを使う（BGMを止めてもフェードアウトの影響を受けないように）
function ensureSfxAudio() {
  const activeCtx = bgm.ctx || sfxCtx || (sfxCtx = new (window.AudioContext || window.webkitAudioContext)());
  if (!sfxMaster || sfxMaster.context !== activeCtx) {
    sfxMaster = activeCtx.createGain();
    sfxMaster.gain.value = 0.8;
    sfxMaster.connect(activeCtx.destination);
  }
  if (activeCtx.state === "suspended") activeCtx.resume();
}

function getSfxNodes() {
  const ctx = bgm.ctx || sfxCtx;
  return { ctx, master: sfxMaster };
}

function playTone(ctx, master, freq, startTime, duration, waveform, gainLevel) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = waveform;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainLevel, startTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

// ボタンをタップした時の、短く柔らかいクリック音
function playClickTick() {
  ensureSfxAudio();
  const { ctx, master } = getSfxNodes();
  if (!ctx) return;
  playTone(ctx, master, 720, ctx.currentTime, 0.07, "sine", 0.12);
}

// タイプライターで文字が1つ増えるたびの、ごく短いタイプ音（ピッチを少しゆらす）
function playTypeTick() {
  ensureSfxAudio();
  const { ctx, master } = getSfxNodes();
  if (!ctx) return;
  const freq = 850 + Math.random() * 250;
  playTone(ctx, master, freq, ctx.currentTime, 0.025, "square", 0.045);
}

// 進化のファンファーレ（豪華版）：和音の土台＋上昇メロディ＋高音のきらめき
function playFanfare() {
  ensureSfxAudio();
  const { ctx, master } = getSfxNodes();
  if (!ctx) return;
  const now = ctx.currentTime;

  // 土台の和音（C・E・G）をロングトーンで鳴らし、厚みを出す
  [523.25, 659.25, 783.99].forEach(freq => {
    playTone(ctx, master, freq, now, 1.0, "sine", 0.13);
  });

  // 上昇するメインメロディ（ドミソド ミ）
  const mainNotes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
  mainNotes.forEach((freq, i) => {
    playTone(ctx, master, freq, now + i * 0.1, 0.5, "triangle", 0.22);
  });

  // 仕上げの高音のきらめき
  const sparkleNotes = [1567.98, 1760.00, 1975.53, 2093.00];
  sparkleNotes.forEach((freq, i) => {
    playTone(ctx, master, freq, now + 0.5 + i * 0.06, 0.35, "triangle", 0.13);
  });
}

// メンターとの出会いの音（ファンファーレとは違う、静かで神秘的な響き）
function playMentorChime() {
  ensureSfxAudio();
  const { ctx, master } = getSfxNodes();
  if (!ctx) return;
  const now = ctx.currentTime;

  // ゆっくり降りてくる、澄んだベルのような3音
  const notes = [1046.50, 880.00, 659.25];
  notes.forEach((freq, i) => {
    playTone(ctx, master, freq, now + i * 0.35, 1.3, "sine", 0.16);
  });
  // 下で支える低い持続音
  playTone(ctx, master, 220.00, now, 1.8, "sine", 0.08);
}
