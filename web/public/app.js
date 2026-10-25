// エレベータ操作盤。状態は SSE（/api/stream）で受け、操作は API で PLC に送る
const Cmd = { CarCall: 1, HallCall: 2, DoorOpen: 3, DoorClose: 4 };
const State = { Idle: 0, DoorOpening: 1, DoorOpen: 2, DoorClosing: 3, Moving: 4, Overload: 5 };
const Direction = { Up: 1, Down: 2 };
const STATE_TEXT = {
  [State.Idle]: "停止中",
  [State.DoorOpening]: "扉が開きます",
  [State.DoorOpen]: "扉が開いています",
  [State.DoorClosing]: "扉が閉まります",
  [State.Moving]: "移動中",
  [State.Overload]: "重量オーバー",
};
// 状態バッジの色（DESIGN.md: ok=エメラルド、active=バイオレット、attention=アンバー、alarm=ローズ）
const STATE_TONE = {
  [State.Idle]: "ok",
  [State.DoorOpening]: "attention",
  [State.DoorOpen]: "active",
  [State.DoorClosing]: "attention",
  [State.Moving]: "active",
  [State.Overload]: "alarm",
};
// 乗り降りできるのは扉が開いている（開きかけ・閉まりかけを含む）間だけ
const BOARDING_STATES = [State.DoorOpening, State.DoorOpen, State.DoorClosing, State.Overload];
const GAUGE_RANGE = 1.25; // ゲージの右端 = 定格の 125%

const el = (id) => document.getElementById(id);
const rowPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row"));

let floorCount = 0;
let latest = null;
let passengers = { persons: 0, loadKg: 0, initialized: false };

// ---- 階の行とボタンを作る（階数は PLC から受け取る） ----
function build(count) {
  floorCount = count;
  const floors = el("floors");
  const cop = el("carButtons");
  floors.replaceChildren();
  cop.replaceChildren();
  el("shaft").style.height = `${count * rowPx()}px`;

  for (let f = count; f >= 1; f--) {
    const row = document.createElement("div");
    row.className = "floor-row";
    row.dataset.floor = String(f);
    row.innerHTML = `<span class="floor-row__label">${f}F</span>
      <button class="hall-btn" aria-label="${f}階で呼ぶ"><span class="hall-btn__lamp"></span>呼ぶ</button>`;
    row.querySelector("button").addEventListener("click", () => command(Cmd.HallCall, f));
    floors.append(row);
  }

  for (let f = 1; f <= count; f++) {   // 操作盤のボタンは小さい階から並べる
    const btn = document.createElement("button");
    btn.className = "car-btn";
    btn.dataset.floor = String(f);
    btn.textContent = String(f);
    btn.setAttribute("aria-label", `${f}階へ`);
    btn.addEventListener("click", () => command(Cmd.CarCall, f));
    cop.append(btn);
  }
}

// ---- 画面の更新 ----
function render(d) {
  latest = d;
  const lamp = el("linkLamp");
  lamp.classList.toggle("is-on", d.connected);
  lamp.classList.toggle("is-alarm", !d.connected);
  el("linkText").textContent = d.connected ? "接続中" : "未接続";
  if (!d.connected) {
    el("errorText").textContent = d.error ? `PLC につながりません: ${d.error}` : "";
    return;
  }
  el("errorText").textContent = "";

  if (d.floorCount && d.floorCount !== floorCount) build(d.floorCount);

  // かごと扉
  const row = rowPx();
  el("car").style.transform = `translateY(${(floorCount - d.position) * row + 5}px)`;
  el("car").classList.toggle("is-alarm", d.buzzer);
  const open = d.doorPct / 100;
  el("doorLeft").style.transform = `translateX(${-open * 100}%)`;
  el("doorRight").style.transform = `translateX(${open * 100}%)`;
  renderPeople(d.persons);

  // 階ごとのランプ
  for (const r of el("floors").children) {
    const f = Number(r.dataset.floor);
    r.classList.toggle("is-here", f === d.floor);
    r.querySelector(".hall-btn").classList.toggle("is-lit", (d.hallCalls & (1 << (f - 1))) !== 0);
  }
  for (const b of el("carButtons").children) {
    const f = Number(b.dataset.floor);
    b.classList.toggle("is-lit", (d.carCalls & (1 << (f - 1))) !== 0);
  }

  // インジケータ
  el("floorDisplay").textContent = String(d.floor);
  el("arrowUp").classList.toggle("is-lit", d.direction === Direction.Up);
  el("arrowDown").classList.toggle("is-lit", d.direction === Direction.Down);
  el("stateText").textContent = STATE_TEXT[d.state] ?? `不明 (${d.state})`;
  el("stateText").dataset.tone = STATE_TONE[d.state] ?? "";

  // 計測値
  el("telePos").textContent = d.position.toFixed(2);
  el("teleDoor").textContent = String(d.doorPct);
  el("teleLoad").textContent = d.maxLoadKg ? String(Math.round((d.loadKg / d.maxLoadKg) * 100)) : "–";
  el("teleLoad").parentElement.classList.toggle("is-alarm", d.overload);
  el("teleBeat").textContent = String(d.heartbeat).padStart(5, "0");

  // 乗客
  if (!passengers.initialized) {
    passengers = { persons: d.persons, loadKg: d.loadKg, initialized: true };
    syncPassengerInputs();
  }
  const canBoard = BOARDING_STATES.includes(d.state);
  el("passengerPanel").classList.toggle("is-locked", !canBoard);
  el("passengerHint").textContent = canBoard
    ? "人数と重量を変えると、すぐに PLC に送ります"
    : "扉が開いているときに乗り降りできます";
  for (const id of ["persons", "personsMinus", "personsPlus", "loadKg", "boardOne", "alightOne", "alightAll"]) {
    el(id).disabled = !canBoard;
  }

  const ratio = d.maxLoadKg ? d.loadKg / d.maxLoadKg : 0;
  el("gaugeFill").style.width = `${Math.min(100, (ratio / GAUGE_RANGE) * 100)}%`;
  el("gaugeFill").classList.toggle("is-over", d.overload);
  el("loadText").textContent = `${d.loadKg} / ${d.maxLoadKg} kg`;
  el("personsText").textContent = `${d.persons} / ${d.maxPersons} 人`;

  el("alarm").classList.toggle("is-on", d.buzzer);
  buzzer(d.buzzer && el("soundToggle").checked);
}

function renderPeople(count) {
  const box = el("carPeople");
  const shown = Math.min(count, 14);
  if (box.childElementCount === shown) return;
  box.replaceChildren(...Array.from({ length: shown }, () => {
    const p = document.createElement("span");
    p.className = "person";
    return p;
  }));
}

// ---- 送信 ----
async function post(url, body) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) el("errorText").textContent = data.error;
  } catch (e) {
    el("errorText").textContent = String(e);
  }
}

function command(code, floor = 0) {
  return post("/api/command", { code, floor });
}

let passengerTimer = null;
function sendPassengers() {
  clearTimeout(passengerTimer);
  passengerTimer = setTimeout(() => post("/api/passengers", passengers), 150);
}

function syncPassengerInputs() {
  el("persons").value = String(passengers.persons);
  el("loadKg").value = String(passengers.loadKg);
}

function changePassengers(deltaPersons) {
  const per = Math.max(1, Number(el("perPerson").value) || 65);
  const persons = Math.max(0, passengers.persons + deltaPersons);
  const loadKg = Math.max(0, passengers.loadKg + (persons - passengers.persons) * per);
  passengers = { ...passengers, persons, loadKg };
  syncPassengerInputs();
  sendPassengers();
}

el("personsPlus").addEventListener("click", () => changePassengers(1));
el("personsMinus").addEventListener("click", () => changePassengers(-1));
el("boardOne").addEventListener("click", () => changePassengers(1));
el("alightOne").addEventListener("click", () => changePassengers(-1));
el("alightAll").addEventListener("click", () => {
  passengers = { ...passengers, persons: 0, loadKg: 0 };
  syncPassengerInputs();
  sendPassengers();
});
el("persons").addEventListener("change", () => {
  passengers = { ...passengers, persons: Math.max(0, Number(el("persons").value) || 0) };
  sendPassengers();
});
el("loadKg").addEventListener("change", () => {
  passengers = { ...passengers, loadKg: Math.max(0, Number(el("loadKg").value) || 0) };
  sendPassengers();
});
el("openBtn").addEventListener("click", () => command(Cmd.DoorOpen));
el("closeBtn").addEventListener("click", () => command(Cmd.DoorClose));

// ---- ブザー（「音」にチェックを入れたときだけ鳴らす） ----
let audio = null;
function buzzer(on) {
  if (on && !audio) {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const timer = setInterval(() => {
      gain.gain.value = gain.gain.value > 0 ? 0 : 0.08;   // ピッ、ピッと断続的に鳴らす
    }, 300);
    audio = { ctx, timer };
  } else if (!on && audio) {
    clearInterval(audio.timer);
    audio.ctx.close();
    audio = null;
  }
}

// ---- 受信 ----
const source = new EventSource("/api/stream");
source.onmessage = (ev) => render(JSON.parse(ev.data));
source.onerror = () => {
  el("linkLamp").classList.remove("is-on");
  el("linkLamp").classList.add("is-alarm");
  el("linkText").textContent = "再接続中…";
};
