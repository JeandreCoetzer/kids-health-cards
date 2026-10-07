/*
 * Kids Health Cards for Home Assistant
 * Mobile-friendly cards for logging medicine, temperature and breastfeeding per child.
 * Entities are found by a per-child prefix (e.g. prefix: kid1 -> input_select.kid1_medicine).
 * MIT License
 */
const KH_VERSION = "0.3.0";

/* ---------- shared helpers ---------- */
const khPad = (n) => String(n).padStart(2, "0");
const khHM = (ts) => { const d = new Date(ts * 1000); return `${khPad(d.getHours())}:${khPad(d.getMinutes())}`; };
const khState = (hass, id) => (id && hass && hass.states[id]) || null;
const khNum = (hass, id, def = 0) => { const s = khState(hass, id); const v = s ? parseFloat(s.state) : NaN; return isFinite(v) ? v : def; };
const khTs = (hass, id) => { const s = khState(hass, id); const t = s && s.attributes ? Number(s.attributes.timestamp) : NaN; return isFinite(t) && t > 86400 ? t : 0; };
const khAgo = (secs) => {
  if (secs < 60) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} m ago`;
};
const khEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const khMedKey = (name) => (name === "Other" ? "other_medicine" : String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_"));

const KH_BASE_CSS = `
  :host { display: block; }
  ha-card { padding: 16px; border-radius: var(--ha-card-border-radius, 22px); box-sizing: border-box; }
  .title { font-size: 18px; font-weight: 700; color: var(--primary-text-color); margin: 0 0 12px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .title small { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  .lbl { font-size: 12px; font-weight: 600; color: var(--secondary-text-color); margin: 0 0 6px; }
  .pill { background: var(--secondary-background-color); border-radius: 14px; min-height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 4px; box-sizing: border-box; color: var(--primary-text-color); }
  .pill .val { font-weight: 700; font-size: 16px; font-variant-numeric: tabular-nums; }
  .pill.big { min-height: 56px; }
  .pill.big .val { font-size: 24px; }
  button { font-family: inherit; }
  .icon-btn { width: 44px; height: 44px; border: none; background: transparent; color: var(--primary-text-color); font-size: 24px; line-height: 1; border-radius: 22px; cursor: pointer; }
  .icon-btn:active { background: rgba(127,127,127,0.18); }
  .action { width: 100%; min-height: 52px; border: none; border-radius: 16px; color: #fff; font-weight: 700; font-size: 16px; cursor: pointer; margin-top: 12px; transition: filter .15s, opacity .15s; }
  .action:active { filter: brightness(0.9); }
  .action[disabled] { opacity: 0.45; cursor: default; }
  .note { font-size: 12px; color: var(--secondary-text-color); margin-top: 8px; }
`;

class KhBase extends HTMLElement {
  setConfig(config) {
    if (!config || !config.prefix) throw new Error(`${this.localName}: 'prefix' is required (e.g. prefix: kid1)`);
    this._config = config;
    this._p = config.prefix;
    if (this._built) this._update();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._built = true; this.attachShadow({ mode: "open" }); this._build(); }
    this._update();
  }
  connectedCallback() {
    clearInterval(this._tick);
    if (this._tickMs) this._tick = setInterval(() => this._built && this._update(), this._tickMs);
  }
  disconnectedCallback() { clearInterval(this._tick); }
  $(sel) { return this.shadowRoot.querySelector(sel); }
  call(domain, service, data) { return this._hass.callService(domain, service, data); }
  flash(btn, text, ms = 1800) {
    btn._flash = text;
    this._update();
    clearTimeout(btn._flashT);
    btn._flashT = setTimeout(() => { btn._flash = null; this._update(); }, ms);
  }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
}

/* ---------- Status tiles ---------- */
class KhStatusCard extends KhBase {
  constructor() { super(); this._tickMs = 30000; }
  _build() {
    this.shadowRoot.innerHTML = `
      <style>${KH_BASE_CSS}
        .grid { display: grid; grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 8px; }
        .tile { background: var(--ha-card-background, var(--card-background-color)); border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 3px; box-shadow: var(--ha-card-box-shadow, none); border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, transparent)); min-width: 0; }
        .tile ha-icon { --mdc-icon-size: 22px; }
        .big { font-size: 22px; font-weight: 700; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
        .name { font-size: 15px; font-weight: 700; color: var(--primary-text-color); }
        .sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ok { font-size: 12px; font-weight: 600; color: #2E9E5B; }
        .wait { font-size: 12px; font-weight: 600; color: #E67E22; }
        .fever { background: rgba(229,57,53,0.16); }
        .fever .big, .fever .sub { color: #E53935; font-weight: 700; }
      </style>
      <div class="grid"></div>`;
  }
  _feedTile() {
    const h = this._hass, p = this._p, now = Date.now() / 1000;
    const running = (khState(h, `input_boolean.${p}_breastfeeding`) || {}).state === "on";
    const ts = khTs(h, `input_datetime.${p}_last_feed`);
    const n = khNum(h, `counter.${p}_feeds_today`, 0);
    const ml = khNum(h, `input_number.${p}_bottle_today`, 0);
    const detail = ((khState(h, `input_text.${p}_last_feed_detail`) || {}).state || "").replace(/^(unknown|unavailable)$/, "");
    let sub, line;
    if (running) { sub = `Feeding now · ${(khState(h, `input_select.${p}_breast_side`) || {}).state || ""}`; line = `<div class="wait">In progress</div>`; }
    else if (ts) { sub = `${khAgo(now - ts)}${detail ? " · " + detail : ""}`; line = `<div class="sub">${n} today${ml > 0 ? " · " + Math.round(ml) + " mL" : ""}</div>`; }
    else { sub = "No feeds yet"; line = ""; }
    return `<div class="tile"><ha-icon icon="mdi:baby-bottle-outline" style="color:${running ? "#E67E22" : "#2F6FC9"}"></ha-icon>
      <div class="name">Fed</div><div class="sub">${khEsc(sub)}</div>${line}</div>`;
  }
  _nappyTile() {
    const h = this._hass, p = this._p, now = Date.now() / 1000;
    const w = khNum(h, `counter.${p}_wet_today`, 0), d = khNum(h, `counter.${p}_dirty_today`, 0), b = khNum(h, `counter.${p}_wet_and_dirty_today`, 0);
    const ts = khTs(h, `input_datetime.${p}_last_nappy`);
    const parts = [w && `${w} wet`, d && `${d} dirty`, b && `${b} both`].filter(Boolean).join(" · ");
    return `<div class="tile"><ha-icon icon="mdi:human-baby-changing-table" style="color:#11807A"></ha-icon>
      <div class="name">Nappy</div><div class="sub">${khEsc(ts ? khAgo(now - ts) : "None yet")}</div><div class="sub">${khEsc(`${w + d + b} today${parts ? " · " + parts : ""}`)}</div></div>`;
  }
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, p = this._p, c = this._config;
    const meds = c.medicines || ["Panadol", "Nurofen"];
    const colors = Object.assign({ Panadol: "#7C5CC4", Nurofen: "#D97706" }, c.colors || {});
    const icons = Object.assign({ Panadol: "mdi:pill", Nurofen: "mdi:bottle-tonic-plus" }, c.icons || {});
    const fever = c.fever || 38;
    const now = Date.now() / 1000;
    const order = c.tiles || [...(c.show_temperature !== false ? ["temperature"] : []), ...meds.map((m) => "medicine:" + m)];
    let html = "";
    const tempTile = () => {
      const t = khNum(h, `input_number.${p}_temperature`, 37);
      const ts = khTs(h, `input_datetime.${p}_temperature_last_logged`);
      const isF = t >= fever;
      const sub = !ts || now - ts >= 86400 ? "Default · no reading" : `${isF ? "Fever" : "Normal"} · ${khHM(ts)}`;
      html += `<div class="tile ${isF ? "fever" : ""}"><ha-icon icon="mdi:thermometer" style="color:${isF ? "#E53935" : "#2E9E5B"}"></ha-icon>
        <div class="big">${t.toFixed(1)}°</div><div class="sub">${khEsc(sub)}</div></div>`;
    };
    const medTile = (m) => {
      const k = khMedKey(m);
      const ts = khTs(h, `input_datetime.${p}_${k}_last`);
      const n = khNum(h, `counter.${p}_${k}_today`, 0);
      const mx = khNum(h, `input_number.${k}_max_daily`, 0);
      const gap = khNum(h, `input_number.${k}_min_gap`, 0);
      let sub = "Not given", line = "";
      if (ts) {
        sub = `${khHM(ts)} · ${n}${mx > 0 ? "/" + mx : ""} today`;
        if (gap > 0) {
          const nxt = ts + gap * 3600;
          line = nxt > now ? `<div class="wait">Wait · ${khHM(nxt)}</div>` : `<div class="ok">OK to give</div>`;
        }
      }
      html += `<div class="tile"><ha-icon icon="${khEsc(icons[m] || "mdi:pill-multiple")}" style="color:${khEsc(colors[m] || "#7C5CC4")}"></ha-icon>
        <div class="name">${khEsc(m)}</div><div class="sub">${khEsc(sub)}</div>${line}</div>`;
    };
    for (const x of order) {
      if (x === "temperature") tempTile();
      else if (x === "feed") html += this._feedTile();
      else if (x === "nappy") html += this._nappyTile();
      else if (x.startsWith("medicine:")) medTile(x.slice(9));
    }
    const grid = this.$(".grid");
    grid.style.setProperty("--cols", String(Math.max(1, order.length)));
    if (grid._html !== html) { grid.innerHTML = html; grid._html = html; }
  }
  getCardSize() { return 2; }
}

/* ---------- Give medicine ---------- */
class KhMedicineCard extends KhBase {
  constructor() { super(); this._tickMs = 20000; }
  _ids() {
    const p = this._p;
    return {
      sel: `input_select.${p}_medicine`, other: `input_text.${p}_medicine_other`, dose: `input_number.${p}_medicine_dose`,
      time: `input_datetime.${p}_given_at_time`, custom: `input_boolean.${p}_given_at_custom`, script: `script.${p}_log_medicine`,
    };
  }
  _build() {
    const accent = (this._config && this._config.accent) || "#6A4BB5";
    this.shadowRoot.innerHTML = `
      <style>${KH_BASE_CSS}
        .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .chip { min-height: 44px; padding: 0 16px; border-radius: 22px; border: 2px solid transparent; background: var(--secondary-background-color); color: var(--primary-text-color); font-weight: 600; font-size: 14px; cursor: pointer; }
        .chip.on { border-color: ${accent}; background: ${accent}2E; color: var(--primary-text-color); }
        .other { margin-bottom: 12px; }
        .other input { width: 100%; box-sizing: border-box; min-height: 44px; border-radius: 12px; border: 1px solid var(--divider-color); background: var(--secondary-background-color); color: var(--primary-text-color); padding: 0 12px; font: inherit; }
        .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .given { position: relative; justify-content: center; cursor: pointer; }
        .given .val { pointer-events: none; }
        .given.picked { box-shadow: inset 0 0 0 2px #E67E22; }
        .given input[type=time] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; }
        .given .reset { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; font-size: 18px; z-index: 2; }
        .warn { margin-top: 12px; background: rgba(230,126,34,0.15); color: var(--primary-text-color); border-radius: 12px; padding: 10px 12px; font-size: 13px; }
        .warn b { color: #E67E22; }
        .action.med { background: ${accent}; }
        .action.armed { filter: brightness(0.8); }
      </style>
      <ha-card>
        <div class="title"></div>
        <div class="chips"></div>
        <div class="other" hidden><input type="text" maxlength="40" placeholder="Medicine name"></div>
        <div class="row">
          <div><div class="lbl">Dose</div>
            <div class="pill"><button class="icon-btn minus" aria-label="Decrease dose">−</button><span class="val dose"></span><button class="icon-btn plus" aria-label="Increase dose">+</button></div></div>
          <div><div class="lbl">Given at</div>
            <div class="pill given"><span class="val gval"></span><input type="time" aria-label="Given at time"><button class="icon-btn reset" hidden aria-label="Use now">×</button></div></div>
        </div>
        <div class="warn" hidden></div>
        <button class="action med"></button>
      </ha-card>`;
    const ids = () => this._ids();
    this.$(".minus").addEventListener("click", () => this.call("input_number", "decrement", { entity_id: ids().dose }));
    this.$(".plus").addEventListener("click", () => this.call("input_number", "increment", { entity_id: ids().dose }));
    const other = this.$(".other input");
    other.addEventListener("change", () => this.call("input_text", "set_value", { entity_id: ids().other, value: other.value.trim() }));
    const tin = this.$(".given input");
    tin.addEventListener("click", () => {
      tin.value = this._givenHM();
      try { if (tin.showPicker) tin.showPicker(); } catch (e) { /* picker opens natively on most mobiles */ }
    });
    tin.addEventListener("change", () => {
      if (!tin.value) return;
      this.call("input_datetime", "set_datetime", { entity_id: ids().time, time: `${tin.value}:00` });
    });
    this.$(".reset").addEventListener("click", (e) => { e.stopPropagation(); this.call("input_boolean", "turn_off", { entity_id: ids().custom }); });
    const btn = this.$(".action");
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (this._config.confirm !== false && !btn._armed) {
        btn._armed = true; this._update();
        clearTimeout(btn._armT); btn._armT = setTimeout(() => { btn._armed = false; this._update(); }, 4000);
        return;
      }
      btn._armed = false; clearTimeout(btn._armT);
      this.call("script", "turn_on", { entity_id: ids().script });
      this.flash(btn, "Logged ✓");
    });
  }
  _givenHM() {
    const ids = this._ids(), h = this._hass;
    const custom = (khState(h, ids.custom) || {}).state === "on";
    const t = (khState(h, ids.time) || {}).state;
    if (custom && t && t.length >= 5) return t.slice(0, 5);
    const d = new Date(); return `${khPad(d.getHours())}:${khPad(d.getMinutes())}`;
  }
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, ids = this._ids(), c = this._config;
    this.$(".title").innerHTML = `${khEsc(c.title || "Give medicine")}`;
    const selS = khState(h, ids.sel);
    if (!selS) { this.$(".title").innerHTML = `Missing entity ${khEsc(ids.sel)}`; return; }
    const med = selS.state;
    const opts = (selS.attributes && selS.attributes.options) || [];
    const otherName = ((khState(h, ids.other) || {}).state || "").trim();
    const otherOk = otherName && !["unknown", "unavailable"].includes(otherName);
    // chips
    const chips = this.$(".chips");
    const key = opts.join("|") + "#" + med + "#" + (otherOk ? otherName : "");
    if (chips._key !== key) {
      chips._key = key;
      chips.innerHTML = opts.map((o) => {
        const label = o === "Other" ? (med === "Other" && otherOk ? otherName : "Other") : o;
        return `<button class="chip ${o === med ? "on" : ""}" data-o="${khEsc(o)}">${khEsc(label)}</button>`;
      }).join("");
      chips.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () =>
        this.call("input_select", "select_option", { entity_id: ids.sel, option: b.dataset.o })));
    }
    // other name
    const otherBox = this.$(".other"); otherBox.hidden = med !== "Other";
    const oi = this.$(".other input"); if (this.shadowRoot.activeElement !== oi) oi.value = otherOk ? otherName : "";
    // dose
    const doseS = khState(h, ids.dose);
    const dose = khNum(h, ids.dose, 0);
    const unit = (doseS && doseS.attributes && doseS.attributes.unit_of_measurement) || "mL";
    this.$(".dose").textContent = `${dose.toFixed(1)} ${unit}`;
    // given at
    const custom = (khState(h, ids.custom) || {}).state === "on";
    this.$(".gval").textContent = custom ? `${this._givenHM()} (picked)` : `Now · ${this._givenHM()}`;
    this.$(".given").classList.toggle("picked", custom);
    this.$(".reset").hidden = !custom;
    // warning
    const label = med === "Other" ? (otherOk ? otherName : "Other") : med;
    let warn = "";
    if (med !== "Other") {
      const k = khMedKey(med);
      const ts = khTs(h, `input_datetime.${this._p}_${k}_last`);
      const gap = khNum(h, `input_number.${k}_min_gap`, 0);
      const mx = khNum(h, `input_number.${k}_max_daily`, 0);
      const n = khNum(h, `counter.${this._p}_${k}_today`, 0);
      if (ts && gap > 0 && ts + gap * 3600 > Date.now() / 1000) warn = `<b>Last ${khEsc(med)} ${khHM(ts)}</b> is within the ${gap} h minimum gap. Log anyway?`;
      else if (mx > 0 && n >= mx) warn = `<b>${n}/${mx} doses</b> of ${khEsc(med)} already today. Log anyway?`;
    }
    const w = this.$(".warn"); w.hidden = !warn; if (w._html !== warn) { w.innerHTML = warn; w._html = warn; }
    // button
    const btn = this.$(".action");
    btn.disabled = dose <= 0;
    btn.classList.toggle("armed", !!btn._armed);
    btn.textContent = btn._flash ? btn._flash : dose <= 0 ? "Set a dose first" : btn._armed ? "Tap again to confirm" : `Log ${label} · ${dose.toFixed(1)} ${unit}`;
  }
  getCardSize() { return 5; }
}

/* ---------- Temperature ---------- */
class KhTemperatureCard extends KhBase {
  constructor() { super(); this._tickMs = 30000; this._hist = []; }
  _ids() {
    const p = this._p;
    return { entry: `input_number.${p}_temperature_entry`, logged: `input_number.${p}_temperature`, last: `input_datetime.${p}_temperature_last_logged`, script: `script.${p}_log_temperature` };
  }
  _build() {
    const accent = (this._config && this._config.accent) || "#2E7D4F";
    this.shadowRoot.innerHTML = `
      <style>${KH_BASE_CSS}
        svg { display: block; width: 100%; height: 72px; margin-top: 12px; overflow: visible; }
        .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; }
        .action.temp { background: ${accent}; }
      </style>
      <ha-card>
        <div class="title"><span class="tt"></span><small class="last"></small></div>
        <div class="pill big"><button class="icon-btn minus" aria-label="Decrease temperature">−</button><span class="val tval"></span><button class="icon-btn plus" aria-label="Increase temperature">+</button></div>
        <svg viewBox="0 0 300 72" preserveAspectRatio="none" aria-label="Temperature trend"></svg>
        <div class="axis"><span class="from"></span><span class="mid"></span><span>now</span></div>
        <button class="action temp"></button>
        <div class="note"></div>
      </ha-card>`;
    const ids = () => this._ids();
    this.$(".minus").addEventListener("click", () => this.call("input_number", "decrement", { entity_id: ids().entry }));
    this.$(".plus").addEventListener("click", () => this.call("input_number", "increment", { entity_id: ids().entry }));
    const btn = this.$(".action");
    btn.addEventListener("click", () => {
      this.call("script", "turn_on", { entity_id: ids().script });
      this.flash(btn, "Logged ✓");
    });
  }
  async _fetchHistory() {
    if (this._fetching || !this._hass) return;
    this._fetching = true;
    try {
      const hours = this._config.hours || 24;
      const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const id = this._ids().logged;
      const res = await this._hass.callApi("GET", `history/period/${start}?filter_entity_id=${id}&minimal_response&no_attributes`);
      const rows = (res && res[0]) || [];
      this._hist = rows.map((r) => ({ t: new Date(r.last_changed || r.last_updated).getTime() / 1000, v: parseFloat(r.state) })).filter((r) => isFinite(r.v));
      this._histAt = Date.now();
      this._drawn = null;
    } catch (e) { /* keep last history */ }
    this._fetching = false;
    this._update();
  }
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, ids = this._ids(), c = this._config;
    const fever = c.fever || 38, hours = c.hours || 24;
    const loggedS = khState(h, ids.logged);
    const showGraph = c.show_graph !== false;
    this.$("svg").style.display = showGraph ? "" : "none";
    this.$(".axis").style.display = showGraph ? "" : "none";
    const changed = loggedS ? loggedS.last_changed : null;
    if (showGraph && (changed !== this._lastChanged || !this._histAt || Date.now() - this._histAt > 300000)) { this._lastChanged = changed; this._fetchHistory(); }
    this.$(".tt").textContent = c.title || "Temperature";
    const ts = khTs(h, ids.last);
    const now = Date.now() / 1000;
    this.$(".last").textContent = ts ? `Last reading ${khAgo(now - ts)}` : "No readings yet";
    const entry = khNum(h, ids.entry, 37);
    this.$(".tval").textContent = `${entry.toFixed(1)} °C`;
    this.$(".from").textContent = `${hours} h ago`;
    this.$(".mid").textContent = `${fever.toFixed(1)} °C fever line`;
    this.$(".note").textContent = c.note || (showGraph ? "No reading for 24 h resets to 37.0 °C" : `Fever from ${fever.toFixed(1)} °C · no reading for 24 h resets to 37.0 °C`);
    const btn = this.$(".action");
    btn.textContent = btn._flash || `Log temperature · ${entry.toFixed(1)} °C`;
    if (showGraph) this._draw(fever, hours, now, loggedS ? parseFloat(loggedS.state) : NaN);
  }
  _draw(fever, hours, now, current) {
    const t0 = now - hours * 3600;
    let pts = this._hist.slice();
    if (isFinite(current)) pts.push({ t: now, v: current });
    pts = pts.map((p) => ({ t: Math.max(p.t, t0), v: p.v }));
    const key = JSON.stringify(pts.map((p) => [Math.round((p.t - t0) / 60), p.v]));
    if (this._drawn === key) return;
    this._drawn = key;
    const W = 300, H = 72, pad = 6;
    const vals = pts.map((p) => p.v);
    const lo = Math.min(35.8, ...(vals.length ? vals : [36])) - 0.2;
    const hi = Math.max(39.6, ...(vals.length ? vals : [38])) + 0.2;
    const x = (t) => ((t - t0) / (now - t0)) * W;
    const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
    let d = "";
    pts.forEach((p, i) => {
      if (i === 0) d += `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      else d += ` H${x(p.t).toFixed(1)} V${y(p.v).toFixed(1)}`;
    });
    const last = pts[pts.length - 1];
    const fy = y(fever).toFixed(1);
    this.$("svg").innerHTML = `
      <line x1="0" y1="${fy}" x2="${W}" y2="${fy}" stroke="#E53935" stroke-opacity="0.55" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"></line>
      ${d ? `<path d="${d}" fill="none" stroke="#2E9E5B" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>` : ""}
      ${last ? `<circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="4" fill="${last.v >= fever ? "#E53935" : "#2E9E5B"}"></circle>` : ""}`;
  }
  getCardSize() { return 5; }
}

/* ---------- Elapsed (count-up) timer ---------- */
class KhElapsedCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.entity) throw new Error("kh-elapsed-card: 'entity' (an input_datetime with date+time) is required");
    this._config = config;
    if (this._built) this._render();
  }
  set hass(hass) { this._hass = hass; if (!this._built) this._build(); this._render(); }
  connectedCallback() { clearInterval(this._timer); this._timer = setInterval(() => this._render(), 1000); }
  disconnectedCallback() { clearInterval(this._timer); }
  _build() {
    this._built = true;
    const color = (this._config && this._config.color) || "#E67E22";
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 14px; cursor: pointer; display: flex; align-items: center; gap: 12px; border-radius: var(--ha-card-border-radius, 22px); }
        .ic { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${color}33; color: ${color}; flex: none; }
        .txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .time { font-size: 28px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--primary-text-color); }
        .sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <ha-card><div class="ic"><ha-icon></ha-icon></div><div class="txt"><div class="time">00:00</div><div class="sub"></div></div></ha-card>`;
    this.shadowRoot.querySelector("ha-card").addEventListener("click", () => {
      const s = this._config && this._config.tap_script;
      if (s && this._hass) this._hass.callService("script", "turn_on", { entity_id: s });
    });
  }
  _render() {
    if (!this._built || !this._hass || !this._config) return;
    const c = this._config;
    const running = c.running_entity ? (this._hass.states[c.running_entity] || {}).state === "on" : true;
    const ts = khTs(this._hass, c.entity);
    const secs = running && ts ? Math.max(0, Math.floor(Date.now() / 1000 - ts)) : 0;
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    const root = this.shadowRoot;
    root.querySelector(".time").textContent = running ? (h > 0 ? `${h}:${khPad(m)}:${khPad(s)}` : `${khPad(m)}:${khPad(s)}`) : "--:--";
    const side = c.side_entity ? (this._hass.states[c.side_entity] || {}).state : null;
    root.querySelector(".sub").textContent = [c.name || "Running", side, c.subtitle].filter(Boolean).join(" · ");
    root.querySelector("ha-icon").setAttribute("icon", c.icon || "mdi:timer-outline");
  }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 12, rows: 2, min_rows: 2 }; }
}



/* ---------- Feeding (breast timer / bottle) ---------- */
class KhFeedingCard extends KhBase {
  constructor() { super(); this._tickMs = 1000; }
  _ids() {
    const p = this._p;
    return {
      type: `input_select.${p}_feed_type`, running: `input_boolean.${p}_breastfeeding`, side: `input_select.${p}_breast_side`,
      started: `input_datetime.${p}_feed_started`, last: `input_datetime.${p}_last_feed`, detail: `input_text.${p}_last_feed_detail`,
      count: `counter.${p}_feeds_today`, mlToday: `input_number.${p}_bottle_today`, amount: `input_number.${p}_bottle_amount`,
      tap: `script.${p}_breast_tap`, bottle: `script.${p}_log_bottle`,
    };
  }
  _build() {
    const accent = (this._config && this._config.accent) || "#2F6FC9";
    this.shadowRoot.innerHTML = `
      <style>${KH_BASE_CSS}
        .chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
        .chip { min-height: 44px; border-radius: 22px; border: 2px solid transparent; background: var(--secondary-background-color); color: var(--primary-text-color); font-weight: 600; font-size: 14px; cursor: pointer; }
        .chip.on { border-color: ${accent}; background: ${accent}2E; }
        .sides { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .side { min-height: 104px; border-radius: 18px; border: 2px solid transparent; background: var(--secondary-background-color); color: var(--primary-text-color);
                display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer; padding: 8px; }
        .side .l { font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
        .side .m { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .side .s { font-size: 12px; color: var(--secondary-text-color); }
        .side.sug { border-color: ${accent}; background: ${accent}24; }
        .side.sug .l { color: ${accent}; }
        .side.run { border-color: #E67E22; background: rgba(230,126,34,0.18); }
        .side.run .l, .side.run .s { color: #E67E22; }
        .side.run .m { font-size: 30px; }
        .bottle .pill { margin-top: 0; }
        .action.feed { background: ${accent}; }
        .last { font-size: 13px; color: var(--secondary-text-color); margin-top: 12px; }
      </style>
      <ha-card>
        <div class="title"><span class="tt"></span><small class="sum"></small></div>
        <div class="chips"><button class="chip" data-o="Breast">Breast</button><button class="chip" data-o="Bottle">Bottle</button></div>
        <div class="breast">
          <div class="sides">
            <button class="side" data-side="Left"><span class="l"></span><span class="m"></span><span class="s"></span></button>
            <button class="side" data-side="Right"><span class="l"></span><span class="m"></span><span class="s"></span></button>
          </div>
        </div>
        <div class="bottle" hidden>
          <div class="lbl">Amount</div>
          <div class="pill big"><button class="icon-btn minus" aria-label="Less">−</button><span class="val ml"></span><button class="icon-btn plus" aria-label="More">+</button></div>
          <button class="action feed"></button>
        </div>
        <div class="last"></div>
      </ha-card>`;
    const ids = () => this._ids();
    this.shadowRoot.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () =>
      this.call("input_select", "select_option", { entity_id: ids().type, option: b.dataset.o })));
    this.shadowRoot.querySelectorAll(".side").forEach((b) => b.addEventListener("click", () =>
      this.call("script", "turn_on", { entity_id: ids().tap, variables: { side: b.dataset.side } })));
    this.$(".minus").addEventListener("click", () => this.call("input_number", "decrement", { entity_id: ids().amount }));
    this.$(".plus").addEventListener("click", () => this.call("input_number", "increment", { entity_id: ids().amount }));
    const btn = this.$(".action");
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      this.call("script", "turn_on", { entity_id: ids().bottle });
      this.flash(btn, "Logged ✓");
    });
  }
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, ids = this._ids(), c = this._config, now = Date.now() / 1000;
    this.$(".tt").textContent = c.title || "Feeding";
    const n = khNum(h, ids.count, 0), mlToday = khNum(h, ids.mlToday, 0);
    this.$(".sum").textContent = `${n} today${mlToday > 0 ? " · " + Math.round(mlToday) + " mL bottle" : ""}`;
    const type = (khState(h, ids.type) || {}).state || "Breast";
    this.shadowRoot.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b.dataset.o === type));
    this.$(".breast").hidden = type !== "Breast";
    this.$(".bottle").hidden = type !== "Bottle";
    const running = (khState(h, ids.running) || {}).state === "on";
    const side = (khState(h, ids.side) || {}).state;
    const lastTs = khTs(h, ids.last);
    const suggested = lastTs ? (side === "Left" ? "Right" : "Left") : null;
    const started = khTs(h, ids.started);
    this.shadowRoot.querySelectorAll(".side").forEach((b) => {
      const sd = b.dataset.side, isRun = running && side === sd;
      b.classList.toggle("run", isRun);
      b.classList.toggle("sug", !running && suggested === sd);
      let l = sd, m = "Start", sub = "tap to start";
      if (isRun) {
        const secs = started ? Math.max(0, Math.floor(now - started)) : 0;
        m = `${khPad(Math.floor(secs / 60))}:${khPad(secs % 60)}`; sub = "tap to stop";
      } else if (running) { m = "Switch"; sub = `stop ${side}, start ${sd}`; }
      else if (suggested === sd) { l = `${sd} · suggested`; }
      b.querySelector(".l").textContent = l;
      b.querySelector(".m").textContent = m;
      b.querySelector(".s").textContent = sub;
    });
    const amount = khNum(h, ids.amount, 0);
    this.$(".ml").textContent = `${Math.round(amount)} mL`;
    const btn = this.$(".action");
    btn.disabled = amount <= 0;
    btn.textContent = btn._flash || (amount <= 0 ? "Set an amount first" : `Log bottle · ${Math.round(amount)} mL`);
    const detail = ((khState(h, ids.detail) || {}).state || "").replace(/^(unknown|unavailable)$/, "");
    this.$(".last").textContent = running ? `Feeding on the ${side} · auto-stops after 30 min` : lastTs ? `Last feed ${khAgo(now - lastTs)}${detail ? " · " + detail : ""}` : "No feeds logged yet";
  }
  getCardSize() { return 4; }
}

/* ---------- Nappy (one-tap) ---------- */
class KhNappyCard extends KhBase {
  constructor() { super(); this._tickMs = 30000; }
  _build() {
    this.shadowRoot.innerHTML = `
      <style>${KH_BASE_CSS}
        .btns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .nb { min-height: 88px; border-radius: 18px; border: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; color: var(--primary-text-color); padding: 6px; }
        .nb ha-icon { --mdc-icon-size: 26px; }
        .nb .l { font-weight: 700; font-size: 15px; }
        .nb .c { font-size: 12px; color: var(--secondary-text-color); }
        .nb.done .l { color: #2E9E5B; }
      </style>
      <ha-card>
        <div class="title"><span class="tt"></span><small class="sum"></small></div>
        <div class="btns">
          <button class="nb" data-k="wet" style="background:rgba(17,128,122,0.16)"><ha-icon icon="mdi:water" style="color:#11807A"></ha-icon><span class="l">Wet</span><span class="c"></span></button>
          <button class="nb" data-k="dirty" style="background:rgba(121,85,72,0.18)"><ha-icon icon="mdi:emoticon-poop" style="color:#8D6E63"></ha-icon><span class="l">Dirty</span><span class="c"></span></button>
          <button class="nb" data-k="both" style="background:var(--secondary-background-color)"><ha-icon icon="mdi:plus-circle-multiple" style="color:var(--secondary-text-color)"></ha-icon><span class="l">Wet &amp; dirty</span><span class="c"></span></button>
        </div>
      </ha-card>`;
    this.shadowRoot.querySelectorAll(".nb").forEach((b) => b.addEventListener("click", () => {
      this.call("script", "turn_on", { entity_id: `script.${this._p}_log_nappy`, variables: { kind: b.dataset.k } });
      this.flash(b, "Logged ✓");
    }));
  }
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, p = this._p, c = this._config, now = Date.now() / 1000;
    this.$(".tt").textContent = c.title || "Nappy";
    const counts = { wet: khNum(h, `counter.${p}_wet_today`, 0), dirty: khNum(h, `counter.${p}_dirty_today`, 0), both: khNum(h, `counter.${p}_wet_and_dirty_today`, 0) };
    const ts = khTs(h, `input_datetime.${p}_last_nappy`);
    this.$(".sum").textContent = `${counts.wet + counts.dirty + counts.both} today${ts ? " · last " + khAgo(now - ts) : ""}`;
    const labels = { wet: "Wet", dirty: "Dirty", both: "Wet & dirty" };
    this.shadowRoot.querySelectorAll(".nb").forEach((b) => {
      const k = b.dataset.k;
      b.classList.toggle("done", !!b._flash);
      b.querySelector(".l").textContent = b._flash || labels[k];
      b.querySelector(".c").textContent = `${counts[k]} today`;
    });
  }
  getCardSize() { return 3; }
}

/* ---------- navigation helper ---------- */
const khNavigate = (path) => {
  if (!path) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
};

/* ---------- Child overview (tablet / family view) ---------- */
class KhChildCard extends KhBase {
  constructor() { super(); this._tickMs = 15000; }
  _build() {
    this.shadowRoot.innerHTML = `
      <style>${KH_BASE_CSS}
        ha-card { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
        .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .head h2 { margin: 0; font-size: 22px; font-weight: 700; color: var(--primary-text-color); display: flex; align-items: center; gap: 8px; }
        .badge { font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 14px; white-space: nowrap; }
        .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .t { border-radius: 16px; padding: 14px; min-width: 0; }
        .t .k { font-size: 13px; font-weight: 600; }
        .t .v { font-size: 20px; font-weight: 700; color: var(--primary-text-color); font-variant-numeric: tabular-nums; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .t .s { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .acts { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 8px; }
        .act { min-height: 52px; border-radius: 14px; border: none; font-weight: 700; font-size: 14px; cursor: pointer; color: #fff; }
        .act.plain { background: var(--secondary-background-color); color: var(--primary-text-color); }
      </style>
      <ha-card>
        <div class="head"><h2><ha-icon></ha-icon><span class="nm"></span></h2><span class="badge"></span></div>
        <div class="tiles"></div>
        <div class="acts"></div>
      </ha-card>`;
  }
  _tile(type) {
    const h = this._hass, p = this._p, now = Date.now() / 1000;
    const tint = (hex) => `background:${hex}24;`;
    if (type.startsWith("medicine:")) {
      const m = type.slice(9), k = khMedKey(m);
      const color = { Panadol: "#7C5CC4", Nurofen: "#D97706" }[m] || "#7C5CC4";
      const ts = khTs(h, `input_datetime.${p}_${k}_last`);
      const n = khNum(h, `counter.${p}_${k}_today`, 0);
      const mx = khNum(h, `input_number.${k}_max_daily`, 0);
      const gap = khNum(h, `input_number.${k}_min_gap`, 0);
      let s = `${n}${mx > 0 ? "/" + mx : ""} today`;
      if (ts && gap > 0) s += ts + gap * 3600 > now ? ` · next ${khHM(ts + gap * 3600)}` : " · OK to give";
      return `<div class="t" style="${tint(color)}"><div class="k" style="color:${color}">${khEsc(m)}</div><div class="v">${ts ? khHM(ts) : "—"}</div><div class="s">${khEsc(ts ? s : "Not given")}</div></div>`;
    }
    if (type === "feed") {
      const color = "#2F6FC9";
      const running = (khState(h, `input_boolean.${p}_breastfeeding`) || {}).state === "on";
      const ts = khTs(h, `input_datetime.${p}_last_feed`);
      const n = khNum(h, `counter.${p}_feeds_today`, 0);
      const ml = khNum(h, `input_number.${p}_bottle_today`, 0);
      const detail = ((khState(h, `input_text.${p}_last_feed_detail`) || {}).state || "").replace(/^(unknown|unavailable)$/, "");
      let v = "—", s = `${n} today${ml > 0 ? " · " + Math.round(ml) + " mL" : ""}`;
      if (running) {
        const side = (khState(h, `input_select.${p}_breast_side`) || {}).state || "";
        v = `Feeding · ${side}`;
      } else if (ts) {
        v = khAgo(now - ts).replace(" ago", "");
        if (detail) s = `${detail} · ${s}`;
      }
      return `<div class="t" style="${tint(color)}"><div class="k" style="color:${color}">Last feed</div><div class="v">${khEsc(v)}</div><div class="s">${khEsc(s)}</div></div>`;
    }
    if (type === "nappy") {
      const color = "#11807A";
      const w = khNum(h, `counter.${p}_wet_today`, 0), d = khNum(h, `counter.${p}_dirty_today`, 0), b = khNum(h, `counter.${p}_wet_and_dirty_today`, 0);
      const ts = khTs(h, `input_datetime.${p}_last_nappy`);
      const parts = [w && `${w} wet`, d && `${d} dirty`, b && `${b} both`].filter(Boolean).join(" · ");
      const s = [parts, ts ? `last ${khAgo(now - ts)}` : "none yet"].filter(Boolean).join(" · ");
      return `<div class="t" style="${tint(color)}"><div class="k" style="color:${color}">Nappies today</div><div class="v">${w + d + b}</div><div class="s">${khEsc(s)}</div></div>`;
    }
    if (type === "temperature") {
      const t = khNum(h, `input_number.${p}_temperature`, 37), fever = this._config.fever || 38;
      const ts = khTs(h, `input_datetime.${p}_temperature_last_logged`);
      const color = t >= fever ? "#E53935" : "#2E9E5B";
      return `<div class="t" style="${tint(color)}"><div class="k" style="color:${color}">Temperature</div><div class="v">${t.toFixed(1)} °C</div><div class="s">${khEsc(ts && now - ts < 86400 ? "logged " + khHM(ts) : "default · no reading 24 h")}</div></div>`;
    }
    return "";
  }
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, c = this._config, p = this._p;
    this.$(".nm").textContent = c.name || p;
    this.$("ha-icon").setAttribute("icon", c.icon || "mdi:human-child");
    const t = khNum(h, `input_number.${p}_temperature`, 37), fever = c.fever || 38;
    const badge = this.$(".badge");
    badge.textContent = t >= fever ? `Fever ${t.toFixed(1)} °C` : `${t.toFixed(1)} °C`;
    badge.style.background = t >= fever ? "rgba(229,57,53,0.16)" : "rgba(46,158,91,0.16)";
    badge.style.color = t >= fever ? "#E53935" : "#2E9E5B";
    const tiles = c.tiles || ["medicine:Panadol", "medicine:Nurofen"];
    const html = tiles.map((x) => this._tile(x)).join("");
    const box = this.$(".tiles");
    if (box._html !== html) { box.innerHTML = html; box._html = html; }
    const acts = c.actions || [];
    const key = JSON.stringify(acts);
    const ab = this.$(".acts");
    if (ab._key !== key) {
      ab._key = key;
      ab.style.setProperty("--n", String(Math.max(1, acts.length)));
      ab.innerHTML = acts.map((a, i) => `<button class="act ${a.color ? "" : "plain"}" data-i="${i}" style="${a.color ? "background:" + khEsc(a.color) : ""}">${khEsc(a.label || "Open")}</button>`).join("");
      ab.querySelectorAll(".act").forEach((b) => b.addEventListener("click", () => {
        const a = acts[Number(b.dataset.i)];
        if (a.script) this.call("script", "turn_on", { entity_id: a.script });
        else khNavigate(a.navigation_path || a.path);
      }));
    }
  }
  getCardSize() { return 5; }
}

/* ---------- 24 h timeline across children ---------- */
const KH_CATS = [
  ["Panadol", "#7C5CC4"], ["Nurofen", "#D97706"], ["Feed", "#2F6FC9"], ["Nappy", "#11807A"], ["Temperature", "#2E9E5B"], ["Other", "#8A8F98"],
];
const khCategory = (e) => {
  const first = String(e.message || e.name || "").split(" · ")[0].trim();
  if (/^panadol/i.test(first)) return "Panadol";
  if (/^nurofen/i.test(first)) return "Nurofen";
  if (/^(breastfeed|bottle|feed)/i.test(first)) return "Feed";
  if (/^nappy/i.test(first)) return "Nappy";
  if (/^temperature/i.test(first)) return "Temperature";
  return "Other";
};
class KhTimelineCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.children) || !config.children.length) throw new Error("kh-timeline-card: 'children' list is required (name + prefix or log_entity)");
    this._config = config;
    this._data = this._data || {};
    if (this._built) this._render();
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    if (first) this._fetch();
  }
  connectedCallback() { clearInterval(this._t); this._t = setInterval(() => this._fetch(), 60000); }
  disconnectedCallback() { clearInterval(this._t); }
  _logEntity(ch) { return ch.log_entity || `input_text.${ch.prefix}_health_log`; }
  _build() {
    this._built = true;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 20px; border-radius: var(--ha-card-border-radius, 22px); }
        .top { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
        h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--primary-text-color); }
        .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 13px; color: var(--secondary-text-color); }
        .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 5px; margin-right: 4px; vertical-align: -1px; }
        .wrap { overflow-x: auto; }
        .rows { min-width: 560px; display: flex; flex-direction: column; gap: 10px; }
        .row { display: flex; align-items: center; gap: 12px; }
        .who { width: 80px; flex: none; font-weight: 600; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lane { flex: 1; height: 38px; background: var(--secondary-background-color); border-radius: 10px; position: relative; }
        .dot { position: absolute; top: 9px; width: 20px; height: 20px; margin-left: -10px; border-radius: 10px; border: 2px solid var(--ha-card-background, var(--card-background-color)); box-sizing: border-box; cursor: default; }
        .ticks { display: flex; gap: 12px; font-size: 12px; color: var(--secondary-text-color); }
        .ticks .sp { width: 80px; flex: none; }
        .ticks .tl { flex: 1; position: relative; height: 16px; }
        .ticks .tl span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
        .ticks .tl span:first-child { transform: none; }
        .ticks .tl span:last-child { transform: translateX(-100%); }
        .detail { margin-top: 10px; font-size: 13px; color: var(--secondary-text-color); min-height: 18px; }
      </style>
      <ha-card>
        <div class="top"><h2></h2><div class="legend"></div></div>
        <div class="wrap"><div class="rows"></div></div>
        <div class="detail"></div>
      </ha-card>`;
    this._render();
  }
  async _fetch() {
    if (!this._hass || !this._config) return;
    const hours = this._config.hours || 24;
    const end = new Date(), start = new Date(end.getTime() - hours * 3600 * 1000);
    this._range = [start.getTime() / 1000, end.getTime() / 1000];
    await Promise.all(this._config.children.map(async (ch) => {
      const ent = this._logEntity(ch);
      try {
        const res = await this._hass.callApi("GET", `logbook/${start.toISOString()}?entity=${ent}&end_time=${end.toISOString()}`);
        this._data[ent] = (res || []).filter((e) => e.message && !/^changed to/i.test(e.message))
          .map((e) => ({ t: new Date(e.when).getTime() / 1000, text: e.message.startsWith(e.name || "\u0000") ? e.message : `${e.name ? e.name + " · " : ""}${e.message}`, cat: khCategory(e), fever: /fever/i.test(e.message) }));
      } catch (err) { /* keep previous */ }
    }));
    this._render();
  }
  _render() {
    if (!this._built || !this._config) return;
    const c = this._config, root = this.shadowRoot;
    const hours = c.hours || 24;
    root.querySelector("h2").textContent = c.title || `Last ${hours} hours`;
    root.querySelector(".legend").innerHTML = KH_CATS.filter(([n]) => n !== "Other").map(([n, col]) => `<span><i style="background:${col}"></i>${n}</span>`).join("");
    const [t0, t1] = this._range || [Date.now() / 1000 - hours * 3600, Date.now() / 1000];
    const col = Object.fromEntries(KH_CATS);
    const rows = c.children.map((ch) => {
      const evs = this._data[this._logEntity(ch)] || [];
      const dots = evs.filter((e) => e.t >= t0 && e.t <= t1).map((e) => {
        const left = ((e.t - t0) / (t1 - t0)) * 100;
        const colr = e.cat === "Temperature" && e.fever ? "#E53935" : col[e.cat];
        return `<span class="dot" style="left:${left.toFixed(2)}%;background:${colr}" title="${khEsc(khHM(e.t) + " · " + e.text)}" data-d="${khEsc(khHM(e.t) + " · " + (ch.name || "") + " · " + e.text)}"></span>`;
      }).join("");
      return `<div class="row"><span class="who">${khEsc(ch.name || ch.prefix)}</span><div class="lane">${dots}</div></div>`;
    }).join("");
    const step = hours / 6;
    const ticks = Array.from({ length: 7 }, (_, i) => {
      const t = t0 + i * step * 3600;
      return `<span style="left:${((i / 6) * 100).toFixed(2)}%">${i === 6 ? "now" : khHM(t)}</span>`;
    }).join("");
    root.querySelector(".rows").innerHTML = rows + `<div class="ticks"><span class="sp"></span><div class="tl">${ticks}</div></div>`;
    const det = root.querySelector(".detail");
    root.querySelectorAll(".dot").forEach((d) => d.addEventListener("click", () => { det.textContent = d.dataset.d; }));
  }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: "full", min_columns: 6 }; }
}

/* ---------- register ---------- */
const KH_CARDS = [
  ["kh-status-card", KhStatusCard, "Kids Health – status tiles", "Temperature and last-dose tiles for one child."],
  ["kh-medicine-card", KhMedicineCard, "Kids Health – give medicine", "Medicine chips, dose stepper, given-at time and log button."],
  ["kh-temperature-card", KhTemperatureCard, "Kids Health – temperature", "Temperature stepper, 24 h trend with fever line, log button."],
  ["kh-feeding-card", KhFeedingCard, "Kids Health – feeding", "Breast (Left/Right live timer) or bottle (mL stepper) feeding."],
  ["kh-nappy-card", KhNappyCard, "Kids Health – nappy", "One-tap wet / dirty / wet & dirty with today's counts."],
  ["kh-child-card", KhChildCard, "Kids Health – child overview", "Family-view panel: fever badge, medicine/feed/nappy tiles, quick actions."],
  ["kh-timeline-card", KhTimelineCard, "Kids Health – 24 h timeline", "Doses, feeds, nappies and temperatures for several children on one timeline."],
  ["kh-elapsed-card", KhElapsedCard, "Kids Health – elapsed timer", "Counts up from an input_datetime, ticking every second."],
];
window.customCards = window.customCards || [];
for (const [tag, cls, name, description] of KH_CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) window.customCards.push({ type: tag, name, description, preview: false });
}
console.info(`%c KIDS-HEALTH-CARDS %c v${KH_VERSION} `, "background:#6A4BB5;color:#fff;border-radius:3px 0 0 3px;padding:1px 4px", "background:#2E7D4F;color:#fff;border-radius:0 3px 3px 0;padding:1px 4px");
