/*
 * Kids Health Cards for Home Assistant
 * Mobile-friendly cards for logging medicine, temperature and breastfeeding per child.
 * Entities are found by a per-child prefix (e.g. prefix: kid1 -> input_select.kid1_medicine).
 * MIT License
 */
const KH_VERSION = "0.1.0";

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
  _update() {
    if (!this._hass || !this._config) return;
    const h = this._hass, p = this._p, c = this._config;
    const meds = c.medicines || ["Panadol", "Nurofen"];
    const colors = Object.assign({ Panadol: "#7C5CC4", Nurofen: "#D97706" }, c.colors || {});
    const icons = Object.assign({ Panadol: "mdi:pill", Nurofen: "mdi:bottle-tonic-plus" }, c.icons || {});
    const fever = c.fever || 38;
    const now = Date.now() / 1000;
    let html = "";
    if (c.show_temperature !== false) {
      const t = khNum(h, `input_number.${p}_temperature`, 37);
      const ts = khTs(h, `input_datetime.${p}_temperature_last_logged`);
      const isF = t >= fever;
      const sub = !ts || now - ts >= 86400 ? "Default · no reading" : `${isF ? "Fever" : "Normal"} · ${khHM(ts)}`;
      html += `<div class="tile ${isF ? "fever" : ""}"><ha-icon icon="mdi:thermometer" style="color:${isF ? "#E53935" : "#2E9E5B"}"></ha-icon>
        <div class="big">${t.toFixed(1)}°</div><div class="sub">${khEsc(sub)}</div></div>`;
    }
    for (const m of meds) {
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
    }
    const grid = this.$(".grid");
    grid.style.setProperty("--cols", String((c.show_temperature !== false ? 1 : 0) + meds.length));
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
    const changed = loggedS ? loggedS.last_changed : null;
    if (changed !== this._lastChanged || !this._histAt || Date.now() - this._histAt > 300000) { this._lastChanged = changed; this._fetchHistory(); }
    this.$(".tt").textContent = c.title || "Temperature";
    const ts = khTs(h, ids.last);
    const now = Date.now() / 1000;
    this.$(".last").textContent = ts ? `Last reading ${khAgo(now - ts)}` : "No readings yet";
    const entry = khNum(h, ids.entry, 37);
    this.$(".tval").textContent = `${entry.toFixed(1)} °C`;
    this.$(".from").textContent = `${hours} h ago`;
    this.$(".mid").textContent = `${fever.toFixed(1)} °C fever line`;
    this.$(".note").textContent = c.note || `No reading for 24 h resets to 37.0 °C`;
    const btn = this.$(".action");
    btn.textContent = btn._flash || `Log temperature · ${entry.toFixed(1)} °C`;
    this._draw(fever, hours, now, loggedS ? parseFloat(loggedS.state) : NaN);
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

/* ---------- register ---------- */
const KH_CARDS = [
  ["kh-status-card", KhStatusCard, "Kids Health – status tiles", "Temperature and last-dose tiles for one child."],
  ["kh-medicine-card", KhMedicineCard, "Kids Health – give medicine", "Medicine chips, dose stepper, given-at time and log button."],
  ["kh-temperature-card", KhTemperatureCard, "Kids Health – temperature", "Temperature stepper, 24 h trend with fever line, log button."],
  ["kh-elapsed-card", KhElapsedCard, "Kids Health – elapsed timer", "Counts up from an input_datetime, ticking every second."],
];
window.customCards = window.customCards || [];
for (const [tag, cls, name, description] of KH_CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) window.customCards.push({ type: tag, name, description, preview: false });
}
console.info(`%c KIDS-HEALTH-CARDS %c v${KH_VERSION} `, "background:#6A4BB5;color:#fff;border-radius:3px 0 0 3px;padding:1px 4px", "background:#2E7D4F;color:#fff;border-radius:0 3px 3px 0;padding:1px 4px");
