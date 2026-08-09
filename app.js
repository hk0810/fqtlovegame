/* =========================================================
   愛を育てるゲーム — ゲームエンジン
   このファイルには「設問」や「宇宙どうぶつの種族データ」を書き込まない。
   すべて questions.json / evolution.json / mentors.json /
   species.json / traits.json から読み込む。
   ========================================================= */

const CACHE_VERSION = "38"; // データ更新のたびに数字を上げると、キャッシュされた古いJSONを使い続けるのを防げる

const CONFIG = {
  questionFiles: ["questions.json"],
  evolutionFile: "evolution.json",
  mentorsFile: "mentors.json",
  speciesFile: "species.json",
  traitsFile: "traits.json",
  mentorNamesFile: "mentor-names.json",
  proceduralMentorInterval: 6, // 固定メンターを使い切った後、何問ごとに新しい相手が現れるか
  storageKey: "love_game_state_v2"
};

function withCacheBust(url) {
  return `${url}?v=${CACHE_VERSION}`;
}

const state = {
  speciesId: null,
  total: 0,              // 13番目の指標＝愛のパワー
  perfectCount: 0,        // love=5（満点）を選んだ回数。完全体の条件のひとつ
  questionSeed: null,      // このセーブで使う13問の組み合わせを決める種（一度決まったら固定）
  attributes: {},         // 選択肢の attributes を積算した生ログ（将来の拡張用）
  answeredIds: [],
  answeredCount: 0,
  seenMentors: [],
  history: [],            // 戻るボタン用の直近の回答履歴 [{qId, delta, egoShrink, mentorId}]
  showPower: false,       // チェックを入れると、常に愛のパワーの増減・合計を表示する
  readAloud: false,       // 設問の読み上げON/OFF
  readSpeed: 1.0,          // 読み上げ速度（0.5〜2.0）
  sfxEnabled: true,        // 効果音（ファンファーレ・メンターとの出会いの音）ON/OFF。BGMとは別
  seenTutorial: false,     // 最初のチュートリアルポップアップを見たかどうか
  seenBlindExplain: false  // 「6問目から数値を伏せます」の説明ポップアップを見たかどうか
};

const COMPLETION = {
  perfectAnswersRequired: 130, // love=5の回答が何回必要か
  perfectLoveValue: 5,          // 「満点」とみなすlove値
  totalLoveRequired: 680         // 加えて、愛パワー合計が何以上必要か
};

let QUESTIONS = [];
let CURRENT_QUESTION = null; // 「もう一度読み上げる」ボタン用に、今表示中の設問を覚えておく
let EVOLUTION = [];
let MENTORS = [];
let SPECIES = [];
let TRAITS = null;
let TRAIT_TO_CATEGORIES = {}; // categoryEgoMapの逆引き（trait key -> category配列）
let MENTOR_NAMES = null;
let MAX_LOVE = 100; // questions.json から算出する理論上の最大値
let LEVEL_COUNTS = {}; // level番号 -> その水準の設問数
let LEVEL_TOTAL = 13;   // レベルの総数（進捗表示は問題数ではなくこの単位で見せる）

init();

async function init() {
  loadState();

  try {
    const qLists = await Promise.all(CONFIG.questionFiles.map(f => fetch(withCacheBust(f)).then(r => r.json())));
    const map = new Map();
    qLists.flat().forEach(q => map.set(q.id, q));
    QUESTIONS = Array.from(map.values()).sort((a, b) => a.id - b.id);

    // レベルごとに13問より多い場合は、このセーブ用に13問だけランダムに選ぶ
    // （questionSeedは初回に一度だけ決めて保存するので、以後は同じ13問になる）
    if (!state.questionSeed) {
      state.questionSeed = Math.floor(Math.random() * 1e9);
      saveState();
    }
    const byLevel = {};
    QUESTIONS.forEach(q => { (byLevel[q.level] = byLevel[q.level] || []).push(q); });
    const picked = [];
    Object.keys(byLevel).forEach(lv => {
      const list = byLevel[lv];
      if (list.length <= 13) {
        picked.push(...list);
      } else {
        const rng = makeRng(seedFrom("qpick", state.questionSeed, lv));
        const shuffled = list.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        picked.push(...shuffled.slice(0, 13));
      }
    });
    QUESTIONS = picked.sort((a, b) => a.id - b.id);

    MAX_LOVE = QUESTIONS.reduce((sum, q) => sum + Math.max(...q.choices.map(c => (c.attributes && c.attributes.love) || 0)), 0) || 100;

    LEVEL_COUNTS = {};
    QUESTIONS.forEach(q => { LEVEL_COUNTS[q.level] = (LEVEL_COUNTS[q.level] || 0) + 1; });
    LEVEL_TOTAL = Object.keys(LEVEL_COUNTS).length || 13;

    EVOLUTION = (await fetch(withCacheBust(CONFIG.evolutionFile)).then(r => r.json())).sort((a, b) => a.min - b.min);
    MENTORS = (await fetch(withCacheBust(CONFIG.mentorsFile)).then(r => r.json())).sort((a, b) => a.afterQuestions - b.afterQuestions);
    SPECIES = await fetch(withCacheBust(CONFIG.speciesFile)).then(r => r.json());
    TRAITS = await fetch(withCacheBust(CONFIG.traitsFile)).then(r => r.json());
    MENTOR_NAMES = await fetch(withCacheBust(CONFIG.mentorNamesFile)).then(r => r.json());

    // trait key -> そのtraitに関係するcategoryの一覧（categoryEgoMapの逆引き）
    TRAIT_TO_CATEGORIES = {};
    Object.entries(TRAITS.categoryEgoMap || {}).forEach(([category, keys]) => {
      keys.forEach(key => {
        (TRAIT_TO_CATEGORIES[key] = TRAIT_TO_CATEGORIES[key] || []).push(category);
      });
    });
  } catch (e) {
    document.getElementById("questionText").textContent =
      "データの読み込みに失敗しました。サーバー経由（http://〜）で開いているかご確認ください。";
    console.error(e);
    return;
  }

  if (!state.speciesId) {
    maybeShowTutorial(() => renderSpeciesSelect());
  } else {
    startGame();
  }
}

const TUTORIAL_TEXTS = [
  "FQT LOVE GARDENへ\nようこそ！🩷",
  "これは戦うゲームではありません。日常のさまざまな場面で「あなたならどうしますか？」と問いかけられる、愛を育てるゲームです。",
  "5つの選択肢に、正解・不正解はありません。助けることも、距離を置くことも、自分を優先することも、すべて愛のかたちのひとつです。",
  "あなたが選んだ宇宙どうぶつは、愛のパワーが育つにつれて、姿も色も少しずつ変化していきます。やがて、伝説の宇宙どうぶつへと近づいていきます。",
  "旅の途中で、あなたより大きな愛を持つメンターに出会うことがあります。愛には天井がありません。上には、また上がいます。",
  "「戻る」で選び直し、「保存して一旦やめる」でいつでも中断、「最初からやり直す」で最初から。読み上げやBGM・効果音も、お好みでオンオフできます。",
  "この続きは、あなたのブラウザだけに保存されます。ホーム画面に追加しておくと、同じブラウザ・同じ端末で安心して続きを楽しめます。"
];

function maybeShowTutorial(onDone) {
  if (state.seenTutorial) { onDone(); return; }
  showIntroSequence(() => {
    state.seenTutorial = true;
    saveState();
    onDone();
  }, TUTORIAL_TEXTS);
}

/* ---------------- 状態管理 ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) { /* 無視 */ }
}
function saveState() {
  try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(state)); } catch (e) {}
}

/* ---------------- 宇宙どうぶつ 選択 ---------------- */
function renderSpeciesSelect() {
  document.getElementById("selectScreen").style.display = "";
  document.getElementById("gameScreen").style.display = "none";
  applyBackgroundTheme(0);

  const tutorialBtnSelect = document.getElementById("tutorialReopenBtnSelect");
  if (!tutorialBtnSelect.dataset.bound) {
    tutorialBtnSelect.addEventListener("click", () => {
      showIntroSequence(() => {}, TUTORIAL_TEXTS);
    });
    tutorialBtnSelect.dataset.bound = "1";
  }

  const grid = document.getElementById("speciesGrid");
  grid.innerHTML = "";
  SPECIES.forEach(sp => {
    const card = document.createElement("button");
    card.className = "species-card";
    card.innerHTML = `
      <div class="species-preview" id="preview-${sp.id}"></div>
      <span class="species-name">${escapeHtml(sp.name)}</span>
      <span class="species-note">${escapeHtml(sp.personality)}</span>
    `;
    card.addEventListener("click", () => chooseSpecies(sp.id));
    grid.appendChild(card);

    // 選択画面ではまだ「とてもシンプルな姿」（進化前）だけを見せる
    document.getElementById(`preview-${sp.id}`).innerHTML = generateCreatureSVG({
      targetParts: sp.parts, progress: 0, idPrefix: `pv${sp.id}`
    });
  });
}

function chooseSpecies(id) {
  state.speciesId = id;
  saveState();
  startGame();
}

function startGame() {
  document.getElementById("selectScreen").style.display = "none";
  document.getElementById("gameScreen").style.display = "";
  const backBtn = document.getElementById("backBtn");
  const resetBtn = document.getElementById("resetBtn");
  if (!backBtn.dataset.bound) {
    backBtn.addEventListener("click", () => {
      if (confirm("直前の回答を取り消して、選び直しますか？")) undoLast();
    });
    backBtn.dataset.bound = "1";
  }
  if (!resetBtn.dataset.bound) {
    resetBtn.addEventListener("click", () => {
      if (confirm("今の宇宙どうぶつや愛のパワーはすべて消えます。最初からやり直しますか？")) resetGame();
    });
    resetBtn.dataset.bound = "1";
  }
  const saveBtn = document.getElementById("saveBtn");
  if (!saveBtn.dataset.bound) {
    saveBtn.addEventListener("click", saveAndPause);
    saveBtn.dataset.bound = "1";
  }
  const tutorialReopenBtn = document.getElementById("tutorialReopenBtn");
  if (!tutorialReopenBtn.dataset.bound) {
    tutorialReopenBtn.addEventListener("click", () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      showIntroSequence(() => {}, TUTORIAL_TEXTS);
    });
    tutorialReopenBtn.dataset.bound = "1";
  }
  setupMusicUI();
  setupReadAloudUI();
  const replayBtn = document.getElementById("replayBtn");
  if (!replayBtn.dataset.bound) {
    replayBtn.addEventListener("click", () => {
      if (CURRENT_QUESTION) speakQuestion(CURRENT_QUESTION);
    });
    replayBtn.dataset.bound = "1";
  }
  const toggle = document.getElementById("showPowerToggle");
  toggle.checked = state.showPower;
  if (!toggle.dataset.bound) {
    toggle.addEventListener("change", () => {
      state.showPower = toggle.checked;
      saveState();
      renderStage();
    });
    toggle.dataset.bound = "1";
  }
  renderStage();
  maybeShowIntroThenFirstMentor(() => renderNextQuestion());
}

/* ゲーム開始直後、まだ誰にも出会っていない場合だけ、
   4枚の大きな文字のポップアップ→最初のメンターとの出会い、という導入を挟む */
function mentorLoveFor(answeredCount) {
  // メンターの愛パワーは常に「これまでこなした設問数 × 5 + 13」で決まる
  return answeredCount * 5 + 13;
}

function maybeShowIntroThenFirstMentor(onDone) {
  const firstMentor = MENTORS.find(m => m.afterQuestions === 0);
  if (firstMentor && state.answeredCount === 0 && !state.seenMentors.includes(firstMentor.id)) {
    showIntroSequence(() => {
      state.seenMentors.push(firstMentor.id);
      saveState();
      showMentor({ ...firstMentor, love: mentorLoveFor(0) }, onDone);
    });
  } else {
    onDone();
  }
}

const INTRO_TEXTS = [
  "まだ宇宙に生まれて間もなく、挫折も苦難も味わったことのないあなたには、自分では気づかないほどの傲慢さや驕りがありました。",
  "狭い世界の中で、「自分は愛のパワーが強い」と思うこともあったでしょう。",
  "そんなあなたが、ある日、ひとつの出会いを経験します。それは、",
  "あなたの世界を大きく変えていく大切な出会いでした。"
];

function showIntroSequence(onComplete, texts) {
  const list = texts || INTRO_TEXTS;
  const overlay = document.getElementById("feedbackOverlay");
  const card = document.getElementById("feedbackCard");
  let step = 0;

  function renderStep() {
    const isLast = step === list.length - 1;
    card.innerHTML = `
      <p class="intro-popup-text">${escapeHtml(list[step])}</p>
      <button class="feedback-btn" id="introNext">${isLast ? "つづける" : "つぎへ"}</button>
    `;
    document.getElementById("introNext").addEventListener("click", () => {
      step += 1;
      if (step < list.length) {
        renderStep();
      } else {
        overlay.classList.remove("show");
        onComplete();
      }
    }, { once: true });
  }

  overlay.classList.add("show");
  renderStep();
}

/* 保存して一旦やめる。localStorageへの保存自体は毎回自動で行われているが、
   ここで明示的に保存し、「安全に閉じてよい」ことをユーザーに伝える。 */
function saveAndPause() {
  saveState();
  const overlay = document.getElementById("feedbackOverlay");
  const card = document.getElementById("feedbackCard");
  card.innerHTML = `
    <p class="eyebrow" style="text-align:center">保存しました</p>
    <p class="feedback-comment" style="text-align:center">
      ここまでの記録を保存しました。<br>
      このままアプリを閉じても大丈夫です。<br>
      次に開いたとき、続きから始まります。<br>
      ただし、ブラウザや端末が変わると<br>
      データは読み込めません。<br>
      ホーム画面に追加していれば<br>
      ブラウザが変わらず安心です。
    </p>
    <button class="feedback-btn" id="feedbackNext">続ける</button>
  `;
  overlay.classList.add("show");
  document.getElementById("feedbackNext").addEventListener("click", () => {
    overlay.classList.remove("show");
  }, { once: true });
}

/* すべてを消して、最初の宇宙どうぶつ選択画面に戻す */
function resetGame() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speciesId = null;
  state.total = 0;
  state.perfectCount = 0;
  state.attributes = {};
  state.answeredIds = [];
  state.answeredCount = 0;
  state.seenMentors = [];
  state.history = [];
  state.showPower = false;
  saveState();
  renderSpeciesSelect();
}

function getSpecies() {
  return SPECIES.find(s => s.id === state.speciesId) || SPECIES[0];
}

/* ---------------- 進化ステージ & 宇宙どうぶつ描画 ---------------- */
function currentStage() {
  let stage = EVOLUTION[0];
  for (const s of EVOLUTION) { if (state.total >= s.min) stage = s; else break; }
  return stage;
}

function renderStage() {
  const stage = currentStage();
  document.getElementById("stageName").textContent = stage.name;
  document.getElementById("stageDesc").textContent = stage.desc;

  applyBackgroundTheme(0); // 進行度による色の変化はやめて、常に元の色に固定する

  const loveEl = document.getElementById("loveTotal");
  if (state.showPower || state.answeredCount <= 5) {
    loveEl.textContent = state.total;
  } else {
    loveEl.textContent = "？？？";
  }
  document.getElementById("mentorCount").textContent = state.seenMentors.length;

  const sp = getSpecies();
  const progress = stageVisualProgress();
  document.getElementById("creatureMount").innerHTML = generateCreatureSVG({
    targetParts: sp.parts,
    progress,
    idPrefix: "main"
  });
  document.getElementById("creatureName").textContent =
    progress >= 1 ? `${sp.name}` : `育っている宇宙どうぶつ（→ ${sp.name}） ${Math.round(progress * 100)}%`;

  renderEgoPanel();
}

/* 見た目（色・パーツ）の進み具合は「愛パワーの合計」と「進化ステージ」に連動させる。
   ステージが上がるたびに大きく変化し、次のステージまでの間も、答えるたびに
   合計が少しずつ増える分だけ、色相などがなめらかに動いていく。 */
/* =========================================================
   169問（全テーマ）を通した完走度に応じて、ページ全体の背景と
   文字色を少しずつ変化させ、最後には「空の色」になるようにする。
   ========================================================= */
const BG_THEME_START = { bg0: "#140b1f", bg1: "#1f1330", bg2: "#2a1a3d", ink: "#f3ece2", inkDim: "#cfc3d9", glow1: "#ff9d81", glow2: "#ffd97a", surface: { r: 255, g: 255, b: 255 } };
const BG_THEME_END   = { bg0: "#ffe9c7", bg1: "#bfe3ff", bg2: "#eaf6ff", ink: "#2b2338", inkDim: "#5b6b7a", glow1: "#c15a34", glow2: "#a3760f", surface: { r: 43, g: 35, b: 56 } };

function overallCompletionFraction() {
  const total = QUESTIONS.length || 1;
  return Math.max(0, Math.min(1, state.answeredCount / total));
}

function lerpHexColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function applyBackgroundTheme(fraction) {
  const root = document.documentElement.style;
  root.setProperty("--bg-0", lerpHexColor(BG_THEME_START.bg0, BG_THEME_END.bg0, fraction));
  root.setProperty("--bg-1", lerpHexColor(BG_THEME_START.bg1, BG_THEME_END.bg1, fraction));
  root.setProperty("--bg-2", lerpHexColor(BG_THEME_START.bg2, BG_THEME_END.bg2, fraction));
  root.setProperty("--ink", lerpHexColor(BG_THEME_START.ink, BG_THEME_END.ink, fraction));
  root.setProperty("--ink-dim", lerpHexColor(BG_THEME_START.inkDim, BG_THEME_END.inkDim, fraction));
  root.setProperty("--glow-1", lerpHexColor(BG_THEME_START.glow1, BG_THEME_END.glow1, fraction));
  root.setProperty("--glow-2", lerpHexColor(BG_THEME_START.glow2, BG_THEME_END.glow2, fraction));

  const sA = BG_THEME_START.surface, sB = BG_THEME_END.surface;
  const r = Math.round(sA.r + (sB.r - sA.r) * fraction);
  const g = Math.round(sA.g + (sB.g - sA.g) * fraction);
  const b = Math.round(sA.b + (sB.b - sA.b) * fraction);
  root.setProperty("--surface-rgb", `${r}, ${g}, ${b}`);
}

function stageVisualProgress() {
  const stage = currentStage();
  const idx = EVOLUTION.indexOf(stage);
  const next = EVOLUTION[idx + 1];
  let fraction = 1;
  if (next && next.min > stage.min) {
    fraction = (state.total - stage.min) / (next.min - stage.min);
    fraction = Math.max(0, Math.min(1, fraction));
  }
  const overall = (idx + fraction) / (EVOLUTION.length - 1);
  return Math.max(0, Math.min(1, overall));
}

/* 「答えた設問の割合」と「愛パワーの到達度」、両方が揃って初めて完成する。
   小さい方をボトルネックとして採用する。 */
/* 完全体になる条件（二重）:
   1. love=5（満点）の回答が perfectAnswersRequired 回以上
   2. 愛パワーの合計が totalLoveRequired 以上
   両方が揃って初めて100%になる（片方だけでは完成しない）。 */
function growProgress() {
  const perfectProgress = state.perfectCount / COMPLETION.perfectAnswersRequired;
  const loveProgress = state.total / COMPLETION.totalLoveRequired;
  return Math.max(0, Math.min(1, Math.min(perfectProgress, loveProgress)));
}

/* 地球人ぽい指標は、保存された数値を引き算していく方式ではなく、
   今の状態から毎回その場で計算する方式にしてある。
   値 = 初期値10 ×（1 − 「愛パワーの680への到達度」 × 「関係カテゴリーの回答済み割合」）
   これにより、全設問に答え終えても愛パワーが680に届いていなければ0にはならず、
   680に届き、かつ関係する設問をすべて答えていて、初めて0になる。 */
function currentEgoValue(traitKey) {
  const categories = TRAIT_TO_CATEGORIES[traitKey] || [];
  if (categories.length === 0) return TRAITS.initialEgoValue;

  const relevantQuestions = QUESTIONS.filter(q => categories.includes(q.category));
  if (relevantQuestions.length === 0) return TRAITS.initialEgoValue;

  const answeredRelevant = relevantQuestions.filter(q => state.answeredIds.includes(q.id)).length;
  const categoryEngagement = answeredRelevant / relevantQuestions.length;
  const overallProgress = Math.min(1, state.total / COMPLETION.totalLoveRequired);

  const value = TRAITS.initialEgoValue * (1 - overallProgress * categoryEngagement);
  return Math.max(0, value);
}

function renderEgoPanel() {
  const wrap = document.getElementById("egoPanel");
  wrap.innerHTML = "";
  TRAITS.egoTraits.forEach(t => {
    const val = currentEgoValue(t.key);
    const pct = Math.min(100, (val / TRAITS.initialEgoValue) * 100);
    const row = document.createElement("div");
    row.className = "ego-row";
    row.innerHTML = `<span class="ego-label">${escapeHtml(t.label)}</span>
      <span class="ego-bar"><span style="width:${pct}%"></span></span>`;
    wrap.appendChild(row);
  });
}

/* ---------------- 設問の出題 ---------------- */
function nextUnanswered() { return QUESTIONS.find(q => !state.answeredIds.includes(q.id)); }

function renderNextQuestion() {
  updateProgress();
  const q = nextUnanswered();
  if (!q) { renderEnd(); return; }
  CURRENT_QUESTION = q;

  document.getElementById("questionCard").style.display = "";
  document.getElementById("questionCategory").textContent = `テーマ${q.level} ・ ${q.category}`;
  document.getElementById("questionText").textContent = q.question;
  document.getElementById("replayBtn").style.display = "";

  if (state.readAloud) speakQuestion(q);

  const wrap = document.getElementById("choices");
  wrap.innerHTML = "";
  q.choices.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `<span class="letter">${c.id}</span>${escapeHtml(c.text)}`;
    btn.addEventListener("click", () => answer(q, c));
    wrap.appendChild(btn);
  });

  const backBtn = document.getElementById("backBtn");
  backBtn.style.display = state.history.length > 0 ? "" : "none";
}

function updateProgress() {
  let completedLevels = 0;
  let currentLevel = LEVEL_TOTAL;
  let currentLevelFraction = 0;
  let doneInCurrentLevel = 0;
  let totalInCurrentLevel = 0;

  for (let lv = 1; lv <= LEVEL_TOTAL; lv++) {
    const totalInLevel = LEVEL_COUNTS[lv] || 0;
    if (totalInLevel === 0) continue;
    const doneInLevel = QUESTIONS.filter(q => q.level === lv && state.answeredIds.includes(q.id)).length;
    if (doneInLevel >= totalInLevel) {
      completedLevels++;
    } else {
      currentLevel = lv;
      currentLevelFraction = doneInLevel / totalInLevel;
      doneInCurrentLevel = doneInLevel;
      totalInCurrentLevel = totalInLevel;
      break;
    }
    if (lv === LEVEL_TOTAL) {
      currentLevel = LEVEL_TOTAL;
      doneInCurrentLevel = totalInLevel;
      totalInCurrentLevel = totalInLevel;
    }
  }

  // バーも文字も「今のレベルの中で何問目か」で揃える（LEVEL自体は設問カードの上に別途表示）
  const withinLevelFraction = totalInCurrentLevel > 0 ? doneInCurrentLevel / totalInCurrentLevel : (completedLevels >= LEVEL_TOTAL ? 1 : 0);
  document.getElementById("progressFill").style.width = (Math.min(1, withinLevelFraction) * 100) + "%";
  document.getElementById("progressLabel").textContent =
    completedLevels >= LEVEL_TOTAL
      ? "すべてのテーマを完了しました"
      : `このテーマ ${doneInCurrentLevel + 1} / ${totalInCurrentLevel} 問目`;
}

/* ---------------- 回答処理 ---------------- */
function answer(question, choice) {
  const beforeStage = currentStage();
  const delta = (choice.attributes && choice.attributes.love) || 0;
  const isPerfect = delta === COMPLETION.perfectLoveValue;

  state.total += delta;
  if (isPerfect) state.perfectCount += 1;
  for (const [k, v] of Object.entries(choice.attributes || {})) {
    state.attributes[k] = (state.attributes[k] || 0) + v;
  }

  state.answeredIds.push(question.id);
  state.answeredCount += 1;

  const afterStage = currentStage();
  const evolved = afterStage !== beforeStage;

  const historyEntry = { qId: question.id, delta, isPerfect, mentorId: null };
  state.history.push(historyEntry);
  saveState();

  showFeedback({ delta, comment: choice.comment, evolved, stage: afterStage }, () => {
    renderStage();
    proceedAfterAnswer();
  });
}

function proceedAfterAnswer() {
  if (state.answeredCount === 6 && !state.showPower && !state.seenBlindExplain) {
    state.seenBlindExplain = true;
    saveState();
    showBlindExplainPopup(() => proceedToMentorOrNext());
    return;
  }
  proceedToMentorOrNext();
}

function proceedToMentorOrNext() {
  const mentor = nextMentorFor(state.answeredCount);
  if (mentor) {
    state.seenMentors.push(mentor.id);
    const lastEntry = state.history[state.history.length - 1];
    if (lastEntry) lastEntry.mentorId = mentor.id; // 戻る操作でこのメンター遭遇も取り消せるように記録
    saveState();
    showMentor(mentor, () => renderNextQuestion());
  } else {
    renderNextQuestion();
  }
}

function showBlindExplainPopup(onClose) {
  const overlay = document.getElementById("feedbackOverlay");
  const card = document.getElementById("feedbackCard");
  card.innerHTML = `
    <p class="eyebrow" style="text-align:center">お知らせ</p>
    <p class="feedback-comment">
      6問目からは、愛のパワーの数値を伏せています。<br><br>
      数字を気にせず、その場面での自分の気持ちに集中してもらうためです。<br>
      進化の瞬間には、ちゃんとお知らせします。<br><br>
      数値をずっと見ていたい場合は、「愛のパワー指標を表示する」のチェックでいつでも見られます。
    </p>
    <button class="feedback-btn" id="feedbackNext">分かった</button>
  `;
  overlay.classList.add("show");
  document.getElementById("feedbackNext").addEventListener("click", () => {
    overlay.classList.remove("show");
    onClose();
  }, { once: true });
}

/* 直前の回答を取り消して、その設問を選び直せるようにする */
function undoLast() {
  const entry = state.history.pop();
  if (!entry) return;

  state.total -= entry.delta;
  if (entry.isPerfect) state.perfectCount = Math.max(0, state.perfectCount - 1);
  const idx = state.answeredIds.lastIndexOf(entry.qId);
  if (idx !== -1) state.answeredIds.splice(idx, 1);
  state.answeredCount = Math.max(0, state.answeredCount - 1);
  if (entry.mentorId) {
    const mi = state.seenMentors.lastIndexOf(entry.mentorId);
    if (mi !== -1) state.seenMentors.splice(mi, 1);
  }
  saveState();
  renderStage();
  renderNextQuestion();
}

/* 固定のメンターを使い切った後は、青天井（終わりのない）メンターを毎回生成する。
   ドラゴンボールの「上には上がいる」の発想: 誰か一人を「最強」として固定しない。 */
function nextMentorFor(answeredCount) {
  const mentorLove = mentorLoveFor(answeredCount);

  const fixed = MENTORS.find(r => r.afterQuestions === answeredCount && !state.seenMentors.includes(r.id));
  if (fixed) return { ...fixed, love: mentorLove };

  const lastFixed = MENTORS[MENTORS.length - 1];
  if (!lastFixed || answeredCount <= lastFixed.afterQuestions) return null;
  if ((answeredCount - lastFixed.afterQuestions) % CONFIG.proceduralMentorInterval !== 0) return null;

  const rng = makeRng(seedFrom("mentor", state.speciesId, answeredCount, state.total));
  const name = pick(rng, MENTOR_NAMES.prefixes) + pick(rng, MENTOR_NAMES.suffixes);
  const parts = {
    body: Math.floor(rng() * 20), ear: Math.floor(rng() * 20), eye: Math.floor(rng() * 20),
    mouth: Math.floor(rng() * 15), nose: Math.floor(rng() * 10), tail: Math.floor(rng() * 20),
    wing: Math.floor(rng() * 10), horn: Math.floor(rng() * 10), antenna: Math.floor(rng() * 10),
    hand: Math.floor(rng() * 15), foot: Math.floor(rng() * 15), pattern: Math.floor(rng() * 30),
    background: Math.floor(rng() * 20), color: Math.floor(rng() * 68), star: Math.floor(rng() * 15)
  };
  return {
    id: `proc-${answeredCount}`,
    name, love: mentorLove, parts,
    message: "この道に終わりはありません。あなたより大きな愛を持つ存在は、これからも現れ続けます。"
  };
}

/* ---------------- フィードバック演出 ---------------- */
function showFeedback({ delta, comment, evolved, stage }, onClose) {
  const overlay = document.getElementById("feedbackOverlay");
  const card = document.getElementById("feedbackCard");
  const showPoints = state.showPower || state.answeredCount <= 5; // チェックON、または最初の5問だけ表示

  card.innerHTML = `
    ${showPoints ? `<p class="feedback-delta">愛のパワー ${delta >= 0 ? "+" : ""}${delta} ❤</p>` : ""}
    <p class="feedback-comment">${escapeHtml(comment || "")}</p>
    <button class="feedback-btn" id="feedbackNext">つづける</button>
  `;
  overlay.classList.add("show");
  document.getElementById("feedbackNext").addEventListener("click", () => {
    overlay.classList.remove("show");
    if (evolved) {
      showEvolutionPopup(stage, onClose);
    } else {
      onClose();
    }
  }, { once: true });
}

/* 進化の瞬間 — 独立した派手なポップアップ＋（BGMが有効なら）ファンファーレ */
function showEvolutionPopup(stage, onClose) {
  const overlay = document.getElementById("feedbackOverlay");
  const card = document.getElementById("feedbackCard");

  card.innerHTML = `
    <div class="evolution-popup">
      <p class="evolution-star">✧･ﾟ: *✧･ﾟ:*</p>
      <p class="evolution-headline">進化しました</p>
      <p class="evolution-stage-name">${escapeHtml(stage.name)}</p>
      <p class="evolution-threshold">愛のパワーが ${stage.min} を超えました！</p>
      <p class="evolution-total-big">愛のパワー合計 <b>${state.total}</b></p>
      <p class="evolution-star">✧･ﾟ: *✧･ﾟ:*</p>
      <button class="feedback-btn" id="feedbackNext">つづける</button>
    </div>
  `;
  overlay.classList.add("show");
  playFanfareIfAllowed();
  document.getElementById("feedbackNext").addEventListener("click", () => {
    overlay.classList.remove("show");
    onClose();
  }, { once: true });
}

/* BGMがすでに許可（一度でも再生開始してオーディオがアンロック済み）されている場合だけ、
   同じ音声グラフを使って短いファンファーレを鳴らす */
/* BGMや効果音の再生は、効果音トグルがONの場合だけ行う（music.js側の豪華なファンファーレを使う） */
function playFanfareIfAllowed() {
  if (!state.sfxEnabled) return;
  try { playFanfare(); } catch (e) { /* 鳴らせなくても致命的ではないので無視 */ }
}

function playMentorChimeIfAllowed() {
  if (!state.sfxEnabled) return;
  try { playMentorChime(); } catch (e) { /* 無視 */ }
}

/* ---------------- メンター演出 ---------------- */
function showMentor(mentor, onClose) {
  const overlay = document.getElementById("feedbackOverlay");
  const card = document.getElementById("feedbackCard");
  const portraitSvg = mentor.parts
    ? generateCreatureSVG({ targetParts: mentor.parts, progress: 1, idPrefix: `mentor-${mentor.id}` })
    : "";
  card.innerHTML = `
    ${mentor.intro ? `<p class="mentor-intro">${escapeHtml(mentor.intro)}</p>` : ""}
    <p class="eyebrow" style="text-align:center">あなたより大きな愛を持つメンターに出会いました</p>
    <p class="mentor-name">${escapeHtml(mentor.name)}</p>
    ${portraitSvg ? `<div class="mentor-portrait">${portraitSvg}</div>` : ""}
    <div class="mentor-compare">
      <span>あなたの愛<b>${state.total}</b></span>
      <span>${escapeHtml(mentor.name)}の愛<b>${mentor.love}</b></span>
    </div>
    <p class="feedback-comment">${escapeHtml(mentor.message)}</p>
    <p class="mentor-asks">その${escapeHtml(mentor.name)}から、そっと問いかけられます。</p>
    <button class="feedback-btn" id="feedbackNext">問いに答える</button>
  `;
  overlay.classList.add("show");
  playMentorChimeIfAllowed();
  document.getElementById("feedbackNext").addEventListener("click", () => {
    overlay.classList.remove("show");
    onClose();
  }, { once: true });
}

/* =========================================================
   🚀 ホーム画面追加を促すポップアップ（FQT LIFE COUNTERと同じ仕組み）
   ・通常のブラウザアクセス時のみ表示（ホーム画面から起動時は表示しない）
   ・初回訪問では出さず、2回目以降のアクセスで表示
   ・「追加しました」「あとで」の2択。しつこく出ないよう配慮
   ========================================================= */
(function initPwaPrompt() {
  const KEY_ADDED = "loveGarden_pwaAdded";
  const KEY_LATER = "loveGarden_pwaLater";
  const KEY_VISIT_COUNT = "loveGarden_pwaVisitCount";
  const KEY_LAST_MESSAGE_INDEX = "loveGarden_pwaLastMessageIndex";
  const KEY_LAST_MESSAGE_DATE = "loveGarden_pwaLastMessageDate";
  const KEY_LAST_SHOWN_DATE = "loveGarden_pwaLastShownDate";

  const LATER_COOLDOWN_DAYS = 3;
  const MIN_VISIT_COUNT_TO_SHOW = 1;
  const SHOW_DELAY_MS = 4000;

  const pwaMessages = [
    "🌱ホーム画面に追加して、いつでも愛を育てにきてください。",
    "🌸もうホーム画面に追加しましたか？続きはいつでも開けます。",
    "✨宇宙どうぶつの成長を見逃さないために、ホーム画面に追加しよう。",
    "💫メンターとの出会いを、いつでも思い出せるように。",
    "🌙今日の愛の問いに、すぐ向き合えるように。",
    "🎐FQT LOVE GARDENを、毎日の小さな習慣に。",
    "🕊️あなたの愛の物語、いつでも続きから始められます。",
    "🌷ホーム画面に追加して、育っていく姿を見守ろう。",
    "🪞メンターとの再会は、ホーム画面からすぐそこに。",
    "🌾今日はどんな愛を選びますか？ホーム画面から始めよう。",
    "🎶癒しのBGMと一緒に、いつでも愛を育てに。",
    "🌈積み重ねてきた愛の記録を、いつでも確認できるように。",
    "💐あなたの愛の庭、ホーム画面に追加してすぐ開けるように。"
  ];

  function isStandaloneMode() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function setPwaAdded() { try { localStorage.setItem(KEY_ADDED, "true"); } catch (e) {} }
  function setPwaLater() { try { localStorage.setItem(KEY_LATER, new Date().toISOString()); } catch (e) {} }
  function getPwaStatus() {
    try {
      return { added: localStorage.getItem(KEY_ADDED) === "true", laterAt: localStorage.getItem(KEY_LATER) };
    } catch (e) { return { added: false, laterAt: null }; }
  }
  function bumpVisitCount() {
    try {
      const next = Number(localStorage.getItem(KEY_VISIT_COUNT) || "0") + 1;
      localStorage.setItem(KEY_VISIT_COUNT, String(next));
      return next;
    } catch (e) { return MIN_VISIT_COUNT_TO_SHOW; }
  }
  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  function shouldShowPwaPrompt() {
    if (isStandaloneMode()) { setPwaAdded(); return false; }
    const status = getPwaStatus();
    if (status.added) return false;
    if (status.laterAt) {
      const daysSince = (Date.now() - new Date(status.laterAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < LATER_COOLDOWN_DAYS) return false;
    }
    try { if (localStorage.getItem(KEY_LAST_SHOWN_DATE) === todayStr()) return false; } catch (e) {}
    const visitCount = bumpVisitCount();
    if (visitCount < MIN_VISIT_COUNT_TO_SHOW) return false;
    return true;
  }
  function pickPwaMessage() {
    const today = todayStr();
    let lastDate = null, rawLastIndex = null;
    try {
      lastDate = localStorage.getItem(KEY_LAST_MESSAGE_DATE);
      rawLastIndex = localStorage.getItem(KEY_LAST_MESSAGE_INDEX);
    } catch (e) {}
    const lastIndex = rawLastIndex === null ? null : Number(rawLastIndex);
    const nextIndex = (lastDate === today && lastIndex !== null && !isNaN(lastIndex))
      ? lastIndex
      : (lastIndex === null || isNaN(lastIndex) ? 0 : (lastIndex + 1) % pwaMessages.length);
    try {
      localStorage.setItem(KEY_LAST_MESSAGE_INDEX, String(nextIndex));
      localStorage.setItem(KEY_LAST_MESSAGE_DATE, today);
    } catch (e) {}
    return pwaMessages[nextIndex];
  }

  function showPwaPrompt() {
    const overlay = document.getElementById("pwaPromptOverlay");
    const card = document.getElementById("pwaPromptCard");
    if (!overlay || !card) return;
    card.innerHTML = `
      <p style="font-size:28px;text-align:center;margin:0 0 6px">🛸</p>
      <p class="feedback-comment" style="text-align:center">${pickPwaMessage()}</p>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button class="ghost-btn" id="pwaPromptLaterBtn" style="flex:1">あとで</button>
        <button class="feedback-btn" id="pwaPromptAddedBtn" style="flex:1">追加しました</button>
      </div>
    `;
    overlay.classList.add("show");
    try { localStorage.setItem(KEY_LAST_SHOWN_DATE, todayStr()); } catch (e) {}
    document.getElementById("pwaPromptAddedBtn").addEventListener("click", () => {
      setPwaAdded();
      overlay.classList.remove("show");
    }, { once: true });
    document.getElementById("pwaPromptLaterBtn").addEventListener("click", () => {
      setPwaLater();
      overlay.classList.remove("show");
    }, { once: true });
  }

  if (shouldShowPwaPrompt()) {
    setTimeout(showPwaPrompt, SHOW_DELAY_MS);
  }
})();

/* ---------------- 終了 ---------------- */
function renderEnd() {
  const stage = currentStage();
  document.getElementById("questionCategory").textContent = "";
  document.getElementById("questionText").innerHTML =
    `今、あなたの愛は「<strong>${escapeHtml(stage.name)}</strong>」まで育ちました。<br><br>
     けれど、愛には天井がありません。今はここまでの問いを歩き終えましたが、
     新しい問いが追加されるたび、あなたよりさらに大きな愛を持つ存在に出会うたび、
     この物語はまだ先へ続いていきます。`;
  document.getElementById("choices").innerHTML = "";
  document.getElementById("backBtn").style.display = state.history.length > 0 ? "" : "none";
  document.getElementById("replayBtn").style.display = "none";
  CURRENT_QUESTION = null;
}

/* ---------------- 疑似乱数（メンター生成専用） ---------------- */
function seedFrom(...parts) {
  const str = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function makeRng(seed) {
  let s = seed || 1;
  return function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967295;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/* ---------------- 設問の読み上げ ---------------- */
function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // 前の読み上げが残っていたら止める
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  utter.rate = state.readSpeed;
  window.speechSynthesis.speak(utter);
}

// 設問文に続けて、A〜Eの選択肢もそのまま読み上げる
function speakQuestion(q) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const parts = [q.question, ...q.choices.map(c => `${c.id}。${c.text}`)];
  parts.forEach(text => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = state.readSpeed;
    window.speechSynthesis.speak(utter); // cancelしない限り自動でキューに積まれ、順番に読み上げられる
  });
}

function setupReadAloudUI() {
  const toggle = document.getElementById("readAloudToggle");
  const speedRow = document.getElementById("readSpeedRow");
  const speedSlider = document.getElementById("readSpeedSlider");
  const speedLabel = document.getElementById("readSpeedLabel");
  if (toggle.dataset.bound) return;

  toggle.checked = state.readAloud;
  speedSlider.value = state.readSpeed;
  speedLabel.textContent = `${state.readSpeed.toFixed(1)}x`;
  speedRow.style.display = state.readAloud ? "" : "none";

  toggle.addEventListener("change", () => {
    state.readAloud = toggle.checked;
    speedRow.style.display = state.readAloud ? "" : "none";
    saveState();
    if (state.readAloud) {
      const q = nextUnanswered();
      if (q) speakQuestion(q);
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  });

  speedSlider.addEventListener("input", () => {
    state.readSpeed = Number(speedSlider.value);
    speedLabel.textContent = `${state.readSpeed.toFixed(1)}x`;
    saveState();
  });

  toggle.dataset.bound = "1";
}

/* ---------------- 癒しの音楽（FQT LIFE COUNTERと同じ操作感） ---------------- */
function setupMusicUI() {
  const select = document.getElementById("musicSelect");
  const playBtn = document.getElementById("musicPlayBtn");
  const sleepSelect = document.getElementById("musicSleepSelect");
  const musicStatus = document.getElementById("musicStatus");
  const sfxToggle = document.getElementById("sfxToggle");
  sfxToggle.checked = state.sfxEnabled;
  if (!sfxToggle.dataset.bound) {
    sfxToggle.addEventListener("change", () => {
      state.sfxEnabled = sfxToggle.checked;
      saveState();
      if (state.sfxEnabled) { try { ensureSfxAudio(); } catch (e) {} }
    });
    sfxToggle.dataset.bound = "1";
  }
  if (select.dataset.bound) return;

  MUSIC_TRACKS.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });

  playBtn.addEventListener("click", () => {
    try {
      if (bgm.playing) {
        stopTrack();
        playBtn.textContent = "🎵　癒しのBGMを再生";
        playBtn.classList.remove("active");
        clearSleepTimer();
        musicStatus.textContent = "";
      } else {
        playTrack(select.value || MUSIC_TRACKS[0].id);
        playBtn.textContent = "🔇　BGMを停止";
        playBtn.classList.add("active");
        musicStatus.textContent = "▶️ 再生中…";
        applySleepTimer(Number(sleepSelect.value), () => {
          playBtn.textContent = "🎵　癒しのBGMを再生";
          playBtn.classList.remove("active");
          musicStatus.textContent = "";
        });
        setTimeout(() => {
          if (bgm.ctx && bgm.ctx.state === "suspended") {
            musicStatus.textContent = "🔇 音声がブロックされています。もう一度押してください。";
          }
        }, 500);
      }
    } catch (err) {
      musicStatus.textContent = `エラー：${err.message}`;
      console.error(err);
    }
  });

  // 音色プリセットを変更した時：再生中ならその場で音色を切り替える
  select.addEventListener("change", () => {
    if (bgm.playing) playTrack(select.value);
  });

  // スリープタイマーを変更した時：再生中なら新しい時間で数え直す
  sleepSelect.addEventListener("change", () => {
    if (bgm.playing) {
      applySleepTimer(Number(sleepSelect.value), () => {
        playBtn.textContent = "🎵　癒しのBGMを再生";
        playBtn.classList.remove("active");
      });
    }
  });

  select.dataset.bound = "1";
}

/* ---------------- ユーティリティ ---------------- */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
