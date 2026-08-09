/* ============================================================================
 * 一級建築士 設計製図試験 ─ 作業時間計測タイマー（PWA版）
 * ----------------------------------------------------------------------------
 *  ■ 編集するのは、このファイルの CONFIG と TASKS だけ。
 *
 *  ■ 項目スキーマ
 *    { phase: "フェーズ名", name: "項目名", std: 標準時間（分／0で実測のみ）,
 *      sheet: "図面名" }   ← sheet は任意。付けると図面単体の計測と図面別集計が有効になる
 *    id は読み込み時に自動で振られる。
 *
 *  ■ 設計上の要点
 *    ・経過時間は Date.now() の絶対時刻から毎回算出する（差分の加算はしない）。
 *      画面が消えても、復帰時に正しい経過時間へ自動補正される。
 *    ・Wake Lock API で画面スリープを抑止する（対応端末のみ）。
 *    ・記録は localStorage に保存する。ブラウザのサイトデータを消すと失われる。
 * ========================================================================== */

// ============================================================================
// CONFIG ─ ここを書き換える
// ============================================================================
const CONFIG = {
  examTitle: "一級建築士",
  subject: "設計製図",
  totalMinutes: 390, // 総試験時間（分）＝ 6時間30分
};

// ============================================================================
// TASKS ─ 計測項目。記載順がそのまま計測順になる
// ============================================================================
const TASKS_SRC = [
  { phase: "エスキス", name: "課題文読解・条件整理", std: 20 },
  { phase: "エスキス", name: "面積表・ゾーニング検討", std: 25 },
  { phase: "エスキス", name: "1/400 プランニング", std: 45 },
  { phase: "エスキス", name: "断面・構造・設備の検討", std: 20 },
  { phase: "エスキス", name: "エスキス確定・条件チェック", std: 20 },

  { phase: "記述", name: "計画の要点等の記述", std: 60 },

  { phase: "作図", name: "面積表", std: 4 },
  { phase: "作図", sheet: "平面図", name: "通り芯 / 寸法線", std: 6 },
  { phase: "作図", sheet: "平面図", name: "柱の図示", std: 5 },
  { phase: "作図", sheet: "平面図", name: "1F：外壁 / 内壁の図示", std: 20 },
  { phase: "作図", sheet: "平面図", name: "2F：外壁 / 内壁の図示", std: 20 },
  { phase: "作図", sheet: "平面図", name: "3F（基準階）：外壁 / 内壁の図示", std: 20 },
  { phase: "作図", sheet: "平面図", name: "EV / 階段 / 便所 / PS / DS / EPS", std: 10 },
  { phase: "作図", sheet: "平面図", name: "室名 / 什器 / 断面線", std: 35 },
  { phase: "作図", sheet: "平面図", name: "外構（駐車場 / 駐輪場 / 植栽 / テラス / 広場）", std: 10 },
  { phase: "作図", sheet: "平面図", name: "法規チェック（延焼ライン / 歩行経路 / 歩行・重複距離）", std: 10 },
  { phase: "作図", sheet: "断面図", name: "通り芯 / 寸法線 / 斜線制限", std: 3 },
  { phase: "作図", sheet: "断面図", name: "床高 / 基礎底盤 / スラブ 下書き", std: 5 },
  { phase: "作図", sheet: "断面図", name: "梁幅 / 梁せい 下書き", std: 4 },
  { phase: "作図", sheet: "断面図", name: "開口部 / 間仕切り 下書き", std: 3 },
  { phase: "作図", sheet: "断面図", name: "断面部仕上げ", std: 10 },
  { phase: "作図", sheet: "断面図", name: "天井 / 天井高さ / 屋上設備スペース", std: 5 },
  { phase: "作図", name: "補足説明 / 外構書込み", std: 10 },

  { phase: "見直し", name: "全体チェック・法規確認", std: 20 },
];

// ============================================================================
// 以下、ロジック（通常は編集不要）
// ============================================================================
const TASKS = TASKS_SRC.map((t, i) => ({ id: i + 1, ...t }));
const STORAGE_KEY = "seizu-timer-records";

const PHASES = TASKS.reduce((a, t) => (a.includes(t.phase) ? a : [...a, t.phase]), []);
const SHEETS = TASKS.reduce((a, t) => (!t.sheet || a.includes(t.sheet) ? a : [...a, t.sheet]), []);

const modeKey = (m) =>
  m.type === "full" ? "full" : m.type === "sheet" ? "sheet:" + m.sheet : "phase:" + m.phase;
const modeLabel = (m) =>
  m.type === "full" ? "通し計測" : m.type === "sheet" ? m.sheet + "（単体）" : m.phase + "（単体）";
const tasksOf = (m) =>
  m.type === "full"
    ? TASKS
    : m.type === "sheet"
    ? TASKS.filter((t) => t.sheet === m.sheet)
    : TASKS.filter((t) => t.phase === m.phase);

// ── 時間フォーマット ────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const fmtMS = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return pad(Math.floor(s / 60)) + ":" + pad(s % 60);
};
const fmtHMS = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 3600) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
};
const fmtDiff = (sec) => {
  const s = Math.round(sec);
  return (s > 0 ? "+" : s < 0 ? "−" : "±") + fmtMS(Math.abs(s));
};
const fmtClock = (ms) => {
  const d = new Date(ms);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
};
const fmtDate = (iso) => {
  const d = new Date(iso);
  return (
    d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
  );
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── 集計 ────────────────────────────────────────────────────────
function summarize(laps) {
  const done = laps.filter((l) => !l.skipped);
  const actual = done.reduce((a, l) => a + l.sec, 0);
  const std = done.reduce((a, l) => a + l.std * 60, 0);
  return { actual, std, diff: actual - std };
}
function groupBy(laps, key) {
  const map = new Map();
  laps.forEach((l) => {
    const k = l[key];
    if (!k) return; // sheet を持たない項目は図面別集計から外す
    if (!map.has(k)) map.set(k, { label: k, actual: 0, std: 0 });
    const e = map.get(k);
    if (!l.skipped) {
      e.actual += l.sec;
      e.std += l.std * 60;
    }
  });
  return [...map.values()];
}

// ── 保存 ────────────────────────────────────────────────────────
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
function saveRecords(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// 状態
// ============================================================================
const S = {
  screen: "home", // home | ready | run | result | history
  mode: null,
  tasks: [],
  record: null,
  records: loadRecords(),
  storeError: false,
  historyFilter: "all",
  // 計測用
  idx: 0,
  laps: [],
  startAt: 0,
  lapStartAt: 0,
  pausedTotal: 0, // 計測全体の中断累計（ms）
  lapPaused: 0,   // 現在の項目における中断累計（ms）
  pauseAt: null,  // 中断中ならその開始時刻
  alerted: new Set(),
};

const $main = document.getElementById("main");
const $dialog = document.getElementById("dialog-root");
const $headHome = document.getElementById("head-home");
document.getElementById("head-title").textContent = CONFIG.examTitle + "　" + CONFIG.subject;

let tickTimer = null;
let wakeLock = null;

// ============================================================================
// 画面遷移
// ============================================================================
function go(screen) {
  S.screen = screen;
  if (screen !== "run") stopTick();
  $headHome.hidden = screen === "home";
  render();
}

function render() {
  const r = {
    home: renderHome,
    ready: renderReady,
    run: renderRun,
    result: renderResult,
    history: renderHistory,
  }[S.screen];
  $main.className = S.screen === "run" || S.screen === "ready" ? "fixed" : "";
  $main.innerHTML = "";
  r();
  $main.scrollTop = 0;
}

$headHome.onclick = () => {
  if (S.screen === "run") askAbort();
  else go("home");
};

// ============================================================================
// ホーム
// ============================================================================
function renderHome() {
  const totalStd = TASKS.reduce((a, t) => a + t.std, 0);
  const sub = (list, type, keyName) =>
    list
      .map((v) => {
        const items = TASKS.filter((t) => t[keyName] === v);
        const std = items.reduce((a, t) => a + t.std, 0);
        return `<button class="mode-sub" data-type="${type}" data-value="${esc(v)}">
          <b>${esc(v)}</b><span>${items.length} 項目 / ${std}分</span></button>`;
      })
      .join("");

  $main.innerHTML = `<div class="wrap pad">
    <div class="eyebrow">SELECT MODE / 計測モード</div>
    <p class="lead">通しで本番の配分を確かめるか、フェーズや図面を選んで反復するかを選びます。モードを選んだ次の画面で計測を開始します。</p>

    <div class="mt5">
      <button class="mode-main" data-type="full">
        <div class="t"><b>通し計測</b><span>${Math.floor(CONFIG.totalMinutes / 60)}h${pad(CONFIG.totalMinutes % 60)}</span></div>
        <div class="s">全 ${TASKS.length} 項目 ／ 標準配分 ${totalStd} 分 ／ 終了予測時刻を表示</div>
      </button>
    </div>

    <div class="mt5 eyebrow">PHASE ONLY / フェーズ単体</div>
    <div class="grid2 mt2">${sub(PHASES, "phase", "phase")}</div>

    ${SHEETS.length ? `<div class="mt5 eyebrow">SHEET ONLY / 図面単体</div>
    <div class="grid2 mt2">${sub(SHEETS, "sheet", "sheet")}</div>` : ""}

    <div class="mt8"><button class="btn btn-quiet btn-full" id="to-history">計測履歴を見る（${S.records.length} 件）</button></div>
  </div>`;

  $main.querySelectorAll("[data-type]").forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.type;
      select(t === "full" ? { type: "full" } : t === "phase" ? { type: "phase", phase: b.dataset.value } : { type: "sheet", sheet: b.dataset.value });
    };
  });
  document.getElementById("to-history").onclick = () => go("history");
}

// モードを選ぶと準備画面へ。計測は「計測を開始」を押した時点で始まる
function select(mode) {
  S.mode = mode;
  S.tasks = tasksOf(mode);
  S.record = null;
  go("ready");
}

// ============================================================================
// 準備画面
// ============================================================================
function renderReady() {
  const totalStd = S.tasks.reduce((a, t) => a + t.std, 0);
  const limit = S.mode.type === "full" ? CONFIG.totalMinutes : totalStd;

  const items = S.tasks
    .map((t, i) => {
      const tag = t.sheet && S.mode.type !== "sheet" ? `<span class="tag">${esc(t.sheet)}</span>` : "";
      const ph = S.mode.type === "full" && !t.sheet ? `<span class="sub" style="font-size:10px;margin-left:6px">${esc(t.phase)}</span>` : "";
      return `<div class="item${i === 0 ? " first" : ""}">
        <span class="no">${pad(i + 1)}</span>
        <span class="nm">${tag}${esc(t.name)}${ph}</span>
        <span class="tm">${t.std ? t.std + "分" : "実測"}</span></div>`;
    })
    .join("");

  $main.innerHTML = `<div class="run">
    <div class="scroll"><div class="wrap pad">
      <div class="eyebrow">READY / 計測の準備</div>
      <h2 style="margin:4px 0 0;font-size:22px;line-height:1.25">${esc(modeLabel(S.mode))}</h2>

      <div class="row mt3">
        <div class="stat"><i>項目数</i><b>${S.tasks.length}</b></div>
        <div class="stat"><i>標準配分</i><b>${fmtHMS(totalStd * 60)}</b></div>
        <div class="stat"><i>持ち時間</i><b>${fmtHMS(limit * 60)}</b></div>
      </div>
      ${limit > totalStd ? `<div class="note">予備時間 ${fmtMS((limit - totalStd) * 60)}</div>` : ""}

      <div class="mt5 eyebrow">ORDER / 計測する順番</div>
      <div class="mt2">${items}</div>
    </div></div>
    <div class="run-foot"><div class="wrap">
      <button class="btn-primary" id="begin">計測を開始</button>
      <div class="mt2"><button class="btn btn-quiet btn-full" id="back-home">モードを選び直す</button></div>
    </div></div>
  </div>`;

  document.getElementById("begin").onclick = beginRun;
  document.getElementById("back-home").onclick = () => go("home");
}

// ============================================================================
// 計測画面
// ============================================================================
function beginRun() {
  const t = Date.now();
  S.idx = 0;
  S.laps = [];
  S.startAt = t;
  S.lapStartAt = t;
  S.pausedTotal = 0;
  S.lapPaused = 0;
  S.pauseAt = null;
  S.alerted = new Set();
  go("run");
  startTick();
  requestWakeLock();
}

function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  navigator.wakeLock
    .request("screen")
    .then((l) => (wakeLock = l))
    .catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.screen === "run") requestWakeLock();
});

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
function startTick() {
  stopTick();
  tickTimer = setInterval(tick, 200);
}
function stopTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  releaseWakeLock();
}

const R = {}; // 計測画面の要素参照

function renderRun() {
  $main.innerHTML = `<div class="run">
    <div class="run-top"><div class="wrap">
      <div class="cols">
        <div>
          <div class="eyebrow">${S.mode.type === "full" ? "TOTAL / 残り" : "SCOPE / 残り"}</div>
          <div class="big" id="r-remain">0:00:00</div>
          <div class="tiny" id="r-elapsed"></div>
        </div>
        <div style="text-align:right">
          <div class="eyebrow">PACE</div>
          <div class="pace" id="r-pace">±00:00</div>
          <div class="tiny" id="r-pace-label" style="color:var(--sub)"></div>
        </div>
      </div>
      <div class="progress">
        <span class="mono" style="font-size:11px;color:var(--sub-dark)" id="r-count"></span>
        <span class="track"><i id="r-progress" style="width:0%"></i></span>
      </div>
    </div></div>

    <div class="run-mid"><div class="wrap" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0">
      <div class="laps" id="r-laps"></div>
      <div style="flex:0 0 auto">
        <div class="now" id="r-now">
          <div class="ph" id="r-phase"></div>
          <div class="nm" id="r-name"></div>
          <div class="tm" id="r-lap">00:00</div>
          <div class="std" id="r-std"></div>
          <div class="track" id="r-lapbar-wrap" hidden><i id="r-lapbar" style="width:0%"></i></div>
        </div>
        <div class="next" id="r-next"></div>
        <div class="paused-note" id="r-paused" hidden>一時停止中 — 中断時間は総時間から除外されます</div>
      </div>
    </div></div>

    <div class="run-foot"><div class="wrap">
      <button class="btn-primary" id="r-next-btn">次へ ›</button>
      <div class="row mt2">
        <button class="btn btn-quiet" id="r-undo">1手戻す</button>
        <button class="btn btn-quiet" id="r-pause">一時停止</button>
        <button class="btn btn-quiet" id="r-skip">スキップ</button>
      </div>
    </div></div>
  </div>`;

  ["remain", "elapsed", "pace", "pace-label", "count", "progress", "laps", "now", "phase", "name", "lap", "std", "lapbar-wrap", "lapbar", "next", "paused", "next-btn", "undo", "pause", "skip"].forEach(
    (k) => (R[k] = document.getElementById("r-" + k))
  );

  R["next-btn"].onclick = () => commit(false);
  R.skip.onclick = () => commit(true);
  R.undo.onclick = undo;
  R.pause.onclick = togglePause;

  renderLaps();
  tick();
}

function renderLaps() {
  if (!S.laps.length) {
    R.laps.innerHTML = `<div class="laps-empty">完了した作業がここに積み上がります</div>`;
    return;
  }
  R.laps.innerHTML = S.laps
    .map((l, i) => {
      const d = l.std > 0 && !l.skipped ? l.sec - l.std * 60 : null;
      const cls = l.skipped ? "skip" : d === null ? "" : d > 0 ? "over" : "under";
      const dc = d === null ? "sub" : d > 0 ? "bad" : "good";
      return `<div class="lap ${cls}">
        <span class="no">${pad(i + 1)}</span>
        <span class="nm">${l.sheet ? `<em>${esc(l.sheet)}</em>` : ""}${esc(l.name)}</span>
        <span class="tm">${l.skipped ? "スキップ" : fmtMS(l.sec)}</span>
        <span class="df ${dc}">${d === null ? "—" : fmtDiff(d)}</span>
      </div>`;
    })
    .join("");
  R.laps.scrollTop = R.laps.scrollHeight; // 最新の1件が見える位置へ
}

function tick() {
  if (S.screen !== "run" || !R.lap) return;
  const now = Date.now();
  const task = S.tasks[S.idx];
  const isLast = S.idx === S.tasks.length - 1;
  const paused = S.pauseAt !== null;
  const pauseNow = paused ? now - S.pauseAt : 0;

  const totalSec = Math.max(0, (now - S.startAt - S.pausedTotal - pauseNow) / 1000);
  const lapSec = Math.max(0, (now - S.lapStartAt - S.lapPaused - pauseNow) / 1000);
  const stdSec = task.std * 60;
  const over = stdSec > 0 && lapSec > stdSec;

  if (over && !S.alerted.has(S.idx)) {
    S.alerted.add(S.idx);
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  }

  const doneStd = S.laps.reduce((a, l) => a + (l.skipped ? 0 : l.std * 60), 0);
  const doneActual = S.laps.reduce((a, l) => a + l.sec, 0);
  const pace = doneActual - doneStd + Math.max(0, lapSec - stdSec);

  const restStd = S.tasks.slice(S.idx + 1).reduce((a, t) => a + t.std * 60, 0);
  const eta = now + (Math.max(0, stdSec - lapSec) + restStd) * 1000;

  const scopeStd = S.tasks.reduce((a, t) => a + t.std * 60, 0);
  const limit = S.mode.type === "full" ? CONFIG.totalMinutes * 60 : scopeStd;
  const remain = limit - totalSec;

  R.remain.textContent = (remain < 0 ? "−" : "") + fmtHMS(Math.abs(remain));
  R.remain.style.color = remain < 0 ? "var(--bad)" : "var(--ink)";
  R.elapsed.textContent =
    "経過 " + fmtHMS(totalSec) + (S.mode.type === "full" ? " ／ 終了予測 " + fmtClock(eta) : "");

  R.pace.textContent = fmtDiff(pace);
  R.pace.style.color = pace > 0 ? "var(--bad)" : pace < 0 ? "var(--good)" : "var(--sub)";
  R["pace-label"].textContent = pace > 0 ? "借金" : pace < 0 ? "貯金" : "標準どおり";

  R.count.textContent = pad(S.idx + 1) + "/" + pad(S.tasks.length);
  const prog = ((S.idx + Math.min(1, stdSec ? lapSec / stdSec : 0)) / S.tasks.length) * 100;
  R.progress.style.width = Math.min(100, prog) + "%";

  R.now.className = "now" + (over ? " over" : "");
  R.phase.textContent = task.phase + (task.sheet ? " ／ " + task.sheet : "");
  R.name.textContent = task.name;
  R.lap.textContent = fmtMS(lapSec);
  R.std.textContent = stdSec
    ? over
      ? "標準 " + fmtMS(stdSec) + " を " + fmtMS(lapSec - stdSec) + " 超過"
      : "標準 " + fmtMS(stdSec) + " ／ 残り " + fmtMS(stdSec - lapSec)
    : "標準時間なし（実測のみ）";
  R["lapbar-wrap"].hidden = !stdSec;
  if (stdSec) {
    R.lapbar.style.width = Math.min(100, (lapSec / stdSec) * 100) + "%";
    R.lapbar.style.background = over ? "var(--bad)" : "var(--ink)";
  }

  const nx = S.tasks[S.idx + 1];
  R.next.textContent = nx ? "次：" + nx.name : "これが最後の項目です";
  R.paused.hidden = !paused;
  R["next-btn"].textContent = isLast ? "完了" : "次へ ›";
  R["next-btn"].disabled = paused;
  R.skip.disabled = paused;
  R.undo.disabled = S.laps.length === 0;
  R.pause.textContent = paused ? "再開" : "一時停止";
}

function commit(skipped) {
  const stamp = Date.now();
  const paused = S.pauseAt !== null;
  const pauseNow = paused ? stamp - S.pauseAt : 0;
  const task = S.tasks[S.idx];
  const sec = skipped ? 0 : Math.max(0, (stamp - S.lapStartAt - S.lapPaused - pauseNow) / 1000);
  S.laps.push({
    id: task.id, phase: task.phase, sheet: task.sheet, name: task.name, std: task.std, sec, skipped,
  });

  if (S.idx === S.tasks.length - 1) {
    finish({
      mode: S.mode,
      laps: S.laps,
      totalSec: Math.max(0, (stamp - S.startAt - S.pausedTotal - pauseNow) / 1000),
      pausedSec: (S.pausedTotal + pauseNow) / 1000,
      date: new Date().toISOString(),
    });
    return;
  }

  S.idx += 1;
  if (paused) {
    // 中断中に項目が切り替わった場合は、ここまでの中断を確定させる
    S.pausedTotal += pauseNow;
    S.lapPaused += pauseNow;
    S.pauseAt = stamp;
  }
  // スキップ時は「実施していない」ので、経過時間も中断累計も次項目へ繰り越す
  if (!skipped) {
    S.lapStartAt = stamp;
    S.lapPaused = 0;
  }
  renderLaps();
  tick();
}

function undo() {
  if (!S.laps.length) return;
  const last = S.laps.pop();
  S.idx -= 1;
  S.alerted.delete(S.idx);
  const now = Date.now();
  const pauseNow = S.pauseAt !== null ? now - S.pauseAt : 0;
  // 直前ラップの経過時間を復元した状態で再開する
  S.lapPaused = 0;
  S.lapStartAt = now - last.sec * 1000 - pauseNow;
  renderLaps();
  tick();
}

function togglePause() {
  if (S.pauseAt !== null) {
    const d = Date.now() - S.pauseAt;
    S.pausedTotal += d; // 総時間から除外
    S.lapPaused += d;   // 現在の項目の経過からも除外
    S.pauseAt = null;
  } else {
    S.pauseAt = Date.now();
  }
  tick();
}

function finish(record) {
  S.record = record;
  const next = [record, ...S.records].slice(0, 100);
  S.records = next;
  S.storeError = !saveRecords(next);
  go("result");
}

// ============================================================================
// 結果画面
// ============================================================================
function compareTargets(record) {
  const key = modeKey(record.mode);
  const same = S.records.filter((r) => modeKey(r.mode) === key && r.date !== record.date);
  if (!same.length) return { prev: null, best: null };
  const prev = [...same].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const best = [...same].sort((a, b) => a.totalSec - b.totalSec)[0];
  return { prev, best };
}

function breakGroup(title, rows) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => Math.max(r.actual, r.std)), 1);
  const body = rows
    .map(
      (r) => `<div class="brk">
      <div class="hd"><span>${esc(r.label)}</span>
        <span class="mono">${fmtMS(r.actual)}<span class="sub"> / ${fmtMS(r.std)}</span></span></div>
      <div class="b1"><i style="width:${(r.actual / max) * 100}%;background:${r.actual > r.std ? "var(--bad)" : "var(--ink)"}"></i></div>
      <div class="b2"><i style="width:${(r.std / max) * 100}%;background:var(--rule)"></i></div>
    </div>`
    )
    .join("");
  return `<div class="mt5"><div class="eyebrow">${title}</div>${body}
    <div class="note">上段＝実績／下段＝標準</div></div>`;
}

function buildShareText(record) {
  const sum = summarize(record.laps);
  const lines = [
    CONFIG.examTitle + " " + CONFIG.subject + " 計測結果",
    fmtDate(record.date) + " ／ " + modeLabel(record.mode),
    "総時間 " + fmtHMS(record.totalSec) + "（中断 " + fmtMS(record.pausedSec) + "）",
    "標準比 " + fmtDiff(sum.diff),
    "",
    "項目\t標準\t実績\t差",
  ];
  record.laps.forEach((l) => {
    const nm = l.sheet ? "【" + l.sheet + "】" + l.name : l.name;
    lines.push(
      l.skipped
        ? nm + "\t" + fmtMS(l.std * 60) + "\tスキップ\t—"
        : nm + "\t" + fmtMS(l.std * 60) + "\t" + fmtMS(l.sec) + "\t" + (l.std ? fmtDiff(l.sec - l.std * 60) : "—")
    );
  });
  return lines.join("\n");
}

function renderResult() {
  const record = S.record;
  const sum = summarize(record.laps);
  const { prev, best } = compareTargets(record);
  const prevMap = new Map((prev ? prev.laps : []).map((l) => [l.id, l]));
  const bestMap = new Map((best ? best.laps : []).map((l) => [l.id, l]));

  const worst = record.laps
    .filter((l) => !l.skipped && l.std > 0)
    .map((l) => ({ ...l, diff: l.sec - l.std * 60 }))
    .filter((l) => l.diff > 0)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  const rows = record.laps
    .map((l) => {
      const d = l.std > 0 && !l.skipped ? l.sec - l.std * 60 : null;
      const pv = prevMap.get(l.id), bv = bestMap.get(l.id);
      const dStyle =
        d === null ? "color:var(--sub)" : d > 0 ? "color:var(--bad);background:var(--bad-bg)" : "color:var(--good);background:var(--good-bg)";
      return `<tr>
        <td><div class="ph">${esc(l.phase)}${l.sheet ? " ／ " + esc(l.sheet) : ""}</div>${esc(l.name)}</td>
        <td class="mono sub">${l.std ? fmtMS(l.std * 60) : "—"}</td>
        <td class="mono">${l.skipped ? "—" : fmtMS(l.sec)}</td>
        <td class="mono" style="${dStyle}">${l.skipped ? "スキップ" : d === null ? "—" : fmtDiff(d)}</td>
        ${prev ? `<td class="mono sub">${pv && !pv.skipped ? fmtMS(pv.sec) : "—"}</td>` : ""}
        ${best ? `<td class="mono sub">${bv && !bv.skipped ? fmtMS(bv.sec) : "—"}</td>` : ""}
      </tr>`;
    })
    .join("");

  $main.innerHTML = `<div class="wrap pad">
    <div class="eyebrow">RESULT / 計測結果</div>
    <div class="lead" style="margin-top:4px">${fmtDate(record.date)} ／ ${esc(modeLabel(record.mode))}</div>

    <div class="sum mt3">
      <div class="cols">
        <div><div class="l">総時間</div><div class="big">${fmtHMS(record.totalSec)}</div></div>
        <div style="text-align:right"><div class="l">標準比</div>
          <div class="pace" style="color:${sum.diff > 0 ? "var(--bad)" : "var(--good)"}">${fmtDiff(sum.diff)}</div></div>
      </div>
      <div class="tiny">標準 ${fmtHMS(sum.std)} ／ 中断 ${fmtMS(record.pausedSec)}</div>
    </div>

    ${worst.length ? `<div class="mt5"><div class="eyebrow">OVERRUN / 超過が大きい項目</div>
      ${worst.map((l) => `<div class="worst"><span>${esc(l.name)}</span><span>${fmtDiff(l.diff)}</span></div>`).join("")}</div>` : ""}

    ${breakGroup("BY PHASE / フェーズ別", groupBy(record.laps, "phase"))}
    ${breakGroup("BY SHEET / 図面別", groupBy(record.laps, "sheet"))}

    <div class="mt5"><div class="eyebrow">DETAIL / 項目別</div>
      <div class="tbl-wrap"><table><thead><tr>
        <th>項目</th><th>標準</th><th>実績</th><th>差</th>
        ${prev ? "<th>前回</th>" : ""}${best ? "<th>ベスト</th>" : ""}
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>

    <div class="mt5"><button class="btn btn-quiet btn-full" id="copy">結果をテキストで書き出す</button>
      <div id="copy-area"></div></div>

    ${S.storeError ? `<div class="note bad" style="text-align:center">記録を保存できませんでした。画面を閉じる前に結果を書き出してください。</div>` : ""}

    <div class="row mt3" style="padding-bottom:8px">
      <button class="btn" id="retry">同じ条件でもう一度</button>
      <button class="btn btn-solid" id="home">ホームへ</button>
    </div>
  </div>`;

  document.getElementById("retry").onclick = () => select(record.mode);
  document.getElementById("home").onclick = () => go("home");
  document.getElementById("copy").onclick = async (e) => {
    const text = buildShareText(record);
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = "コピーしました";
    } catch (err) {
      e.target.textContent = "下の枠から手動でコピー";
      const area = document.getElementById("copy-area");
      area.innerHTML = `<textarea readonly></textarea>`;
      const ta = area.querySelector("textarea");
      ta.value = text;
      ta.focus();
      ta.select();
    }
    setTimeout(() => (e.target.textContent = "結果をテキストで書き出す"), 2500);
  };
}

// ============================================================================
// 履歴
// ============================================================================
function renderHistory() {
  const keys = ["all", "full", ...PHASES.map((p) => "phase:" + p), ...SHEETS.map((s) => "sheet:" + s)];
  const label = (k) => (k === "all" ? "すべて" : k === "full" ? "通し" : k.slice(6));
  const list = S.records.filter((r) => S.historyFilter === "all" || modeKey(r.mode) === S.historyFilter);

  $main.innerHTML = `<div class="wrap pad">
    <div class="eyebrow">HISTORY / 計測履歴</div>
    <div class="mt3">${keys
      .map((k) => `<button class="chip${S.historyFilter === k ? " on" : ""}" data-k="${esc(k)}">${esc(label(k))}</button>`)
      .join("")}</div>

    ${list.length === 0
      ? `<div class="empty">この条件の記録はまだありません。<br>ホームから計測を始めてください。</div>`
      : list
          .map((r) => {
            const s = summarize(r.laps);
            return `<div class="rec">
              <button data-open="${esc(r.date)}">
                <div class="d">${fmtDate(r.date)}</div>
                <div class="m">${esc(modeLabel(r.mode))}</div>
              </button>
              <div class="r">
                <div class="mono" style="font-size:14px;font-weight:500">${fmtHMS(r.totalSec)}</div>
                <div class="mono ${s.diff > 0 ? "bad" : "good"}" style="font-size:11px">${fmtDiff(s.diff)}</div>
              </div>
              <button class="del" data-del="${esc(r.date)}" aria-label="この記録を削除">×</button>
            </div>`;
          })
          .join("")}

    <div class="mt5" style="padding-bottom:8px">
      <button class="btn btn-solid btn-full" id="home">ホームへ</button></div>
  </div>`;

  $main.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { S.historyFilter = b.dataset.k; render(); }));
  $main.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => {
    S.record = S.records.find((r) => r.date === b.dataset.open);
    S.storeError = false;
    go("result");
  }));
  $main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    S.records = S.records.filter((r) => r.date !== b.dataset.del);
    saveRecords(S.records);
    render();
  }));
  document.getElementById("home").onclick = () => go("home");
}

// ============================================================================
// 中止確認ダイアログ
// ============================================================================
function askAbort() {
  $dialog.innerHTML = `<div class="overlay" id="ov"><div class="dialog" id="dg">
    <h2>計測を中止しますか？</h2>
    <p>ホームに戻ると、ここまでの計測は記録されずに破棄されます。</p>
    <div class="row mt3">
      <button class="btn" id="keep">計測を続ける</button>
      <button class="btn btn-danger" id="abort">中止してホームへ</button>
    </div>
  </div></div>`;
  const close = () => ($dialog.innerHTML = "");
  document.getElementById("ov").onclick = close;
  document.getElementById("dg").onclick = (e) => e.stopPropagation();
  document.getElementById("keep").onclick = close;
  document.getElementById("abort").onclick = () => { close(); go("home"); };
}

// ============================================================================
// 起動
// ============================================================================
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
