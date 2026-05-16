const mediumCatalog = {
  air: {
    label: "Aire",
    damping: 0.015,
    color: "rgba(168, 211, 255, 0.18)",
    note: "Aire: casi ideal; la amplitud cae lentamente."
  },
  water: {
    label: "Agua",
    damping: 0.10,
    color: "rgba(74, 169, 229, 0.24)",
    note: "Agua: disipación visible sin destruir de inmediato la oscilación."
  },
  lightOil: {
    label: "Aceite ligero",
    damping: 0.32,
    color: "rgba(239, 170, 58, 0.26)",
    note: "Aceite: el rozamiento viscoso reduce claramente la amplitud."
  },
  glycerin: {
    label: "Glicerina",
    damping: 0.74,
    color: "rgba(102, 191, 164, 0.28)",
    note: "Glicerina: útil para discutir amortiguamiento fuerte."
  },
  custom: {
    label: "Personalizado",
    damping: 0.10,
    color: "rgba(132, 121, 206, 0.22)",
    note: "Ajuste personalizado del coeficiente b."
  }
};

const state = {
  mode: "free",
  graphMode: "time",
  running: false,
  t: 0,
  x: 0.12,
  v: 0,
  mass: 0.25,
  k: 18,
  damping: 0.10,
  gravity: 9.8,
  amplitude: 0.12,
  medium: "water",
  force: 0.55,
  driveFrequency: 1.0,
  speed: 1,
  showVelocity: true,
  showAcceleration: true,
  showEquilibrium: true,
  showTrace: true,
  lastFrame: null,
  lastSample: -1,
  history: [],
  trace: []
};

const els = {
  simulationCanvas: document.querySelector("#simulationCanvas"),
  graphCanvas: document.querySelector("#graphCanvas"),
  playButton: document.querySelector("#playButton"),
  resetButton: document.querySelector("#resetButton"),
  kickButton: document.querySelector("#kickButton"),
  speedSelect: document.querySelector("#speedSelect"),
  massInput: document.querySelector("#massInput"),
  springInput: document.querySelector("#springInput"),
  amplitudeInput: document.querySelector("#amplitudeInput"),
  gravityInput: document.querySelector("#gravityInput"),
  mediumSelect: document.querySelector("#mediumSelect"),
  dampingInput: document.querySelector("#dampingInput"),
  forceInput: document.querySelector("#forceInput"),
  driveInput: document.querySelector("#driveInput"),
  resonanceButton: document.querySelector("#resonanceButton"),
  exportButton: document.querySelector("#exportButton"),
  showVelocity: document.querySelector("#showVelocity"),
  showAcceleration: document.querySelector("#showAcceleration"),
  showEquilibrium: document.querySelector("#showEquilibrium"),
  showTrace: document.querySelector("#showTrace"),
  timeReadout: document.querySelector("#timeReadout"),
  xReadout: document.querySelector("#xReadout"),
  vReadout: document.querySelector("#vReadout"),
  periodReadout: document.querySelector("#periodReadout"),
  zetaReadout: document.querySelector("#zetaReadout"),
  energyReadout: document.querySelector("#energyReadout"),
  massValue: document.querySelector("#massValue"),
  springValue: document.querySelector("#springValue"),
  amplitudeValue: document.querySelector("#amplitudeValue"),
  gravityValue: document.querySelector("#gravityValue"),
  dampingValue: document.querySelector("#dampingValue"),
  forceValue: document.querySelector("#forceValue"),
  driveValue: document.querySelector("#driveValue"),
  regimePill: document.querySelector("#regimePill"),
  insightCard: document.querySelector("#insightCard")
};

const simCtx = els.simulationCanvas.getContext("2d");
const graphCtx = els.graphCanvas.getContext("2d");
const resonanceCanvas = document.querySelector("#resonanceCanvas");
const resonanceCtx = resonanceCanvas ? resonanceCanvas.getContext("2d") : null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function activeDamping() {
  return state.mode === "free" ? 0 : state.damping;
}

function driveOmega() {
  return 2 * Math.PI * state.driveFrequency;
}

function naturalOmega() {
  return Math.sqrt(state.k / state.mass);
}

function naturalPeriod() {
  return 2 * Math.PI / naturalOmega();
}

function criticalDamping() {
  return 2 * Math.sqrt(state.k * state.mass);
}

function dampingRatio() {
  return activeDamping() / criticalDamping();
}

function accelerationAt(x = state.x, v = state.v, t = state.t) {
  const drivingForce =
    state.mode === "forced" ? state.force * Math.cos(driveOmega() * t) : 0;
  return (drivingForce - activeDamping() * v - state.k * x) / state.mass;
}

function energy() {
  const kinetic = 0.5 * state.mass * state.v * state.v;
  const potential = 0.5 * state.k * state.x * state.x;
  return {
    kinetic,
    potential,
    total: kinetic + potential
  };
}

function regimeLabel() {
  if (state.mode === "free") return "Movimiento armónico simple";
  const zeta = dampingRatio();
  if (state.mode === "forced") {
    const ratio = state.driveFrequency / (naturalOmega() / (2 * Math.PI));
    if (ratio > 0.92 && ratio < 1.08) return "Cerca de resonancia";
    if (ratio < 0.92) return "Motor por debajo de f₀";
    return "Motor por encima de f₀";
  }
  if (zeta < 0.95) return "Sistema subamortiguado";
  if (zeta <= 1.05) return "Amortiguamiento crítico";
  return "Sistema sobreamortiguado";
}

function setRunning(next) {
  state.running = next;
  const icon = state.running ? "pause" : "play";
  els.playButton.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
  if (window.lucide) window.lucide.createIcons();
  if (state.running) state.lastFrame = performance.now();
}

function resetSimulation(clearHistory = true) {
  state.t = 0;
  state.x = state.amplitude;
  state.v = 0;
  state.lastFrame = performance.now();
  state.lastSample = -1;
  state.trace = [];
  if (clearHistory) state.history = [];
  sampleHistory(true);
  updateReadouts();
  draw();
}

function applyMediumPreset() {
  const preset = mediumCatalog[state.medium];
  if (state.medium !== "custom") {
    state.damping = preset.damping;
    els.dampingInput.value = String(preset.damping);
  }
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tab").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".mode-only").forEach((node) => {
    const allowed = node.dataset.visibleMode.split(",");
    node.hidden = !allowed.includes(mode);
  });
  if (mode === "free") {
    state.damping = 0;
  } else {
    applyMediumPreset();
  }
  resetSimulation(true);
  updateControls();
}

function setGraphMode(mode) {
  state.graphMode = mode;
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.graph === mode);
  });
  drawGraph();
}

function updateControls() {
  els.massValue.textContent = `${Math.round(state.mass * 1000)} g`;
  els.springValue.textContent = `${fmt(state.k, 0)} N/m`;
  els.amplitudeValue.textContent = `${fmt(state.amplitude * 100, 0)} cm`;
  els.gravityValue.textContent = `${fmt(state.gravity, 1)} m/s²`;
  els.dampingValue.textContent = `${fmt(activeDamping(), 2)} N·s/m`;
  els.forceValue.textContent = `${fmt(state.force, 2)} N`;
  els.driveValue.textContent = `${fmt(state.driveFrequency, 2)} Hz`;
  els.regimePill.textContent = regimeLabel();
  updateInsight();
}

function updateReadouts() {
  const e = energy();
  els.timeReadout.textContent = `${fmt(state.t, 2)} s`;
  els.xReadout.textContent = `${fmt(state.x * 100, 1)} cm`;
  els.vReadout.textContent = `${fmt(state.v * 100, 1)} cm/s`;
  els.periodReadout.textContent = `${fmt(naturalPeriod(), 2)} s`;
  els.zetaReadout.textContent = fmt(dampingRatio(), 2);
  els.energyReadout.textContent = `${fmt(e.total, 3)} J`;
  els.regimePill.textContent = regimeLabel();
}

function updateInsight() {
  const f0 = naturalOmega() / (2 * Math.PI);
  const zeta = dampingRatio();
  const staticStretch = (state.mass * state.gravity) / state.k;
  let title = "La gravedad cambia el punto de equilibrio, no el periodo.";
  let body =
    `Con estos valores, \\(T = ${fmt(naturalPeriod(), 2)}\\,\\text{s}\\) y la elongación estática ` +
    `\\(mg/k\\) es ${fmt(staticStretch * 100, 1)} cm.`;

  if (state.mode === "damped") {
    title = "El medio convierte energía mecánica en calor.";
    body =
      `${mediumCatalog[state.medium].note} La razón de amortiguamiento es ` +
      `\\(\\zeta = ${fmt(zeta, 2)}\\); observa cómo cae la envolvente de \\(x(t)\\).`;
  }

  if (state.mode === "forced") {
    const ratio = state.driveFrequency / f0;
    title = "La respuesta máxima aparece cerca de la frecuencia natural.";
    body =
      `El motor está en ${fmt(state.driveFrequency, 2)} Hz y \\(f_0 = ${fmt(f0, 2)}\\,\\text{Hz}\\) ` +
      `(cociente ${fmt(ratio, 2)}). Cerca de 1 aparece la resonancia.`;
  }

  els.insightCard.querySelector("h3").textContent = title;
  const insightBody = els.insightCard.querySelector("p");
  insightBody.innerHTML = body;
  renderMath(els.insightCard);
}

function sampleHistory(force = false) {
  if (!force && state.t - state.lastSample < 0.018) return;
  state.lastSample = state.t;
  const e = energy();
  state.history.push({
    t: state.t,
    x: state.x,
    v: state.v,
    a: accelerationAt(),
    kinetic: e.kinetic,
    potential: e.potential,
    total: e.total
  });
  const firstAllowed = state.t - 18;
  while (state.history.length > 2 && state.history[0].t < firstAllowed) {
    state.history.shift();
  }
}

function integrateStep(h) {
  const deriv = (x, v, t) => ({
    dx: v,
    dv: accelerationAt(x, v, t)
  });

  const k1 = deriv(state.x, state.v, state.t);
  const k2 = deriv(
    state.x + 0.5 * h * k1.dx,
    state.v + 0.5 * h * k1.dv,
    state.t + 0.5 * h
  );
  const k3 = deriv(
    state.x + 0.5 * h * k2.dx,
    state.v + 0.5 * h * k2.dv,
    state.t + 0.5 * h
  );
  const k4 = deriv(state.x + h * k3.dx, state.v + h * k3.dv, state.t + h);

  state.x += (h / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
  state.v += (h / 6) * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv);
  state.t += h;

  if (Math.abs(state.x) > 0.55) {
    state.x = clamp(state.x, -0.55, 0.55);
    state.v *= -0.35;
  }
}

function animationLoop(now) {
  if (state.running) {
    const rawDt = Math.min((now - state.lastFrame) / 1000, 0.08) * state.speed;
    state.lastFrame = now;
    const step = 0.0035;
    const steps = Math.max(1, Math.ceil(rawDt / step));
    const h = rawDt / steps;
    for (let i = 0; i < steps; i += 1) {
      integrateStep(h);
      sampleHistory();
    }
    updateReadouts();
  }
  draw();
  requestAnimationFrame(animationLoop);
}

function fitCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(220, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: width / dpr, height: height / dpr };
}

function draw() {
  drawSimulation();
  drawGraph();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawSimulation() {
  const { width: w, height: h } = fitCanvas(els.simulationCanvas, simCtx);
  const ctx = simCtx;
  ctx.clearRect(0, 0, w, h);
  drawStageBackground(ctx, w, h);

  const cx = w * 0.51;
  const topYBase = 74;
  const motorOffset = state.mode === "forced" ? 12 * Math.sin(driveOmega() * state.t) : 0;
  const topY = topYBase + motorOffset;
  const equilibriumY = h * 0.54;
  const scale = clamp(h * 0.95, 520, 760);
  const massY = clamp(equilibriumY + state.x * scale, topY + 145, h - 118);
  const massW = clamp(w * 0.115, 54, 86);
  const massH = clamp(h * 0.11, 58, 86);
  const attachY = massY - massH / 2 - 7;
  const staticStretch = clamp((state.mass * state.gravity) / state.k, 0, 0.42);
  const naturalY = equilibriumY - staticStretch * scale;

  if (state.mode !== "free") {
    drawFluidTank(ctx, w, h, massY, mediumCatalog[state.medium].color);
  }

  if (state.showEquilibrium) {
    drawReferenceLine(ctx, 26, w - 28, equilibriumY, "Equilibrio", "#222", [8, 8]);
    drawReferenceLine(ctx, 26, w - 28, naturalY, "Longitud natural", "#2f67d8", [10, 6]);
  }

  drawCeiling(ctx, cx, topY);
  if (state.mode === "forced") drawMotor(ctx, cx - 140, topY - 4);
  drawSpring(ctx, cx, topY + 24, attachY, Math.max(24, w * 0.036));

  if (state.showTrace) drawTrace(ctx, cx, scale, equilibriumY);

  drawMass(ctx, cx, massY, massW, massH);
  drawVectors(ctx, cx, massY, scale);
  drawEnergyBars(ctx, w, h);
  drawRuler(ctx, w, h, equilibriumY, scale);

  state.trace.push({ x: cx, y: massY, t: state.t });
  const traceMin = state.t - 2.4;
  state.trace = state.trace.filter((point) => point.t >= traceMin);
}

function drawStageBackground(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = "#fbfdfb";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(214, 226, 220, 0.72)";
  ctx.lineWidth = 1;
  for (let x = 40; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 40; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#eef7f3";
  ctx.fillRect(0, h - 52, w, 52);
  ctx.strokeStyle = "#c9dad2";
  ctx.beginPath();
  ctx.moveTo(0, h - 52);
  ctx.lineTo(w, h - 52);
  ctx.stroke();
  ctx.restore();
}

function drawCeiling(ctx, cx, y) {
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#2a302e";
  ctx.fillStyle = "#d9e2dd";
  roundRectPath(ctx, cx - 78, y - 24, 156, 24, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#7a8580";
  ctx.lineWidth = 2;
  for (let x = cx - 68; x < cx + 68; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, y - 23);
    ctx.lineTo(x - 14, y - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpring(ctx, cx, y1, y2, radius) {
  const coils = 10;
  const points = coils * 28;
  ctx.save();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(31, 38, 35, 0.20)";
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const p = i / points;
    const x = cx + Math.sin(p * coils * 2 * Math.PI) * radius;
    const y = y1 + (y2 - y1) * p;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "#313936";
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const p = i / points;
    const x = cx + Math.sin(p * coils * 2 * Math.PI) * radius;
    const y = y1 + (y2 - y1) * p;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, y1 - 22);
  ctx.lineTo(cx, y1);
  ctx.moveTo(cx, y2);
  ctx.lineTo(cx, y2 + 18);
  ctx.stroke();
  ctx.restore();
}

function drawMass(ctx, cx, cy, width, height) {
  const x = cx - width / 2;
  const y = cy - height / 2;
  const grams = Math.round(state.mass * 1000);
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, "#f7b45a");
  gradient.addColorStop(0.45, "#f6d08c");
  gradient.addColorStop(1, "#e4742f");

  ctx.save();
  ctx.shadowColor = "rgba(43, 35, 24, 0.22)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, x, y, width, height, 7);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#7c4b20";
  ctx.stroke();

  ctx.fillStyle = "#101816";
  ctx.font = "800 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${grams} g`, cx, cy);
  ctx.restore();
}

function drawFluidTank(ctx, w, h, massY, color) {
  const tankW = clamp(w * 0.34, 210, 320);
  const tankH = clamp(h * 0.38, 210, 300);
  const x = w * 0.51 - tankW / 2;
  const y = h * 0.45;
  const fluidTop = y + tankH * 0.22 + Math.sin(state.t * 1.7) * 2;

  ctx.save();
  ctx.strokeStyle = "rgba(28, 45, 40, 0.42)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, tankW, tankH, 8);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x + 4, fluidTop, tankW - 8, y + tankH - fluidTop - 4);

  ctx.strokeStyle = "rgba(47, 103, 216, 0.42)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= tankW - 12; i += 8) {
    const px = x + 6 + i;
    const py = fluidTop + Math.sin(i * 0.11 + state.t * 4) * 2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(23, 32, 29, 0.70)";
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(mediumCatalog[state.medium].label, x + 12, y + tankH - 14);

  ctx.fillStyle = "rgba(22, 137, 101, 0.18)";
  for (let i = 0; i < 6; i += 1) {
    const bx = x + 24 + i * (tankW - 54) / 5;
    const by = massY + Math.sin(state.t * 3 + i) * 12;
    ctx.beginPath();
    ctx.arc(bx, by, 3 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMotor(ctx, x, y) {
  const angle = driveOmega() * state.t;
  ctx.save();
  ctx.fillStyle = "#26312d";
  ctx.strokeStyle = "#111816";
  ctx.lineWidth = 2;
  roundRectPath(ctx, x - 58, y - 32, 116, 64, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#eef7f3";
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Motor", x, y - 42);

  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#ef8f2d";
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(24, 0);
  ctx.stroke();
  ctx.restore();
}

function drawReferenceLine(ctx, x1, x2, y, label, color, dash) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, x1 + 8, y - 7);
  ctx.restore();
}

function drawTrace(ctx) {
  if (state.trace.length < 2) return;
  ctx.save();
  for (let i = 0; i < state.trace.length; i += 1) {
    const point = state.trace[i];
    const age = state.t - point.t;
    const alpha = clamp(1 - age / 2.4, 0, 1);
    ctx.fillStyle = `rgba(22, 137, 101, ${alpha * 0.25})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 12 * alpha + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawArrow(ctx, fromX, fromY, dx, dy, color, label) {
  const length = Math.hypot(dx, dy);
  if (length < 4) return;
  const ux = dx / length;
  const uy = dy / length;
  const endX = fromX + dx;
  const endY = fromY + dy;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - 12 * ux - 7 * uy, endY - 12 * uy + 7 * ux);
  ctx.lineTo(endX - 12 * ux + 7 * uy, endY - 12 * uy - 7 * ux);
  ctx.closePath();
  ctx.fill();

  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, endX + 8, endY);
  ctx.restore();
}

function drawVectors(ctx, cx, massY, scale) {
  if (state.showVelocity) {
    drawArrow(ctx, cx + 62, massY, 0, clamp(state.v * scale * 0.28, -90, 90), "#2f67d8", "v");
  }
  if (state.showAcceleration) {
    drawArrow(
      ctx,
      cx + 96,
      massY,
      0,
      clamp(accelerationAt() * scale * 0.038, -90, 90),
      "#c84646",
      "a"
    );
  }
  if (state.mode === "forced") {
    const f = state.force * Math.cos(driveOmega() * state.t);
    drawArrow(ctx, cx - 96, massY, 0, clamp(f * 62, -90, 90), "#ef8f2d", "F");
  }
}

function drawEnergyBars(ctx, w, h) {
  const e = energy();
  const maxEnergy = Math.max(0.01, 0.5 * state.k * state.amplitude * state.amplitude, e.total);
  const barX = 28;
  const barY = h - 182;
  const barW = 120;
  const barH = 110;
  const bars = [
    { label: "Ec", value: e.kinetic, color: "#2f67d8" },
    { label: "Ep", value: e.potential, color: "#168965" },
    { label: "Et", value: e.total, color: "#ef8f2d" }
  ];

  ctx.save();
  roundRectPath(ctx, barX - 16, barY - 30, barW + 34, barH + 60, 8);
  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(214, 226, 220, 0.9)";
  ctx.stroke();

  ctx.fillStyle = "#17201d";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Energía", barX, barY - 10);

  bars.forEach((bar, index) => {
    const x = barX + index * 38;
    const height = clamp((bar.value / maxEnergy) * barH, 0, barH);
    ctx.fillStyle = "rgba(23, 32, 29, 0.08)";
    ctx.fillRect(x, barY, 24, barH);
    ctx.fillStyle = bar.color;
    ctx.fillRect(x, barY + barH - height, 24, height);
    ctx.fillStyle = "#17201d";
    ctx.font = "800 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(bar.label, x + 12, barY + barH + 18);
  });
  ctx.restore();
}

function drawRuler(ctx, w, h, equilibriumY, scale) {
  const x = w - 74;
  ctx.save();
  ctx.strokeStyle = "#586862";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 70);
  ctx.lineTo(x, h - 72);
  ctx.stroke();

  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#586862";
  for (let cm = -20; cm <= 20; cm += 5) {
    const y = equilibriumY + (cm / 100) * scale;
    if (y < 76 || y > h - 76) continue;
    const tick = cm % 10 === 0 ? 12 : 7;
    ctx.beginPath();
    ctx.moveTo(x - tick, y);
    ctx.lineTo(x + tick, y);
    ctx.stroke();
    if (cm % 10 === 0) ctx.fillText(`${cm} cm`, x + 16, y + 4);
  }
  ctx.restore();
}

function plotLine(ctx, points, mapper, color, width = 2) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach((point, index) => {
    const mapped = mapper(point);
    if (index === 0) ctx.moveTo(mapped.x, mapped.y);
    else ctx.lineTo(mapped.x, mapped.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawGraph() {
  const { width: w, height: h } = fitCanvas(els.graphCanvas, graphCtx);
  const ctx = graphCtx;
  ctx.clearRect(0, 0, w, h);
  drawGraphBackground(ctx, w, h);

  if (state.history.length < 2) {
    sampleHistory(true);
  }

  if (state.graphMode === "phase") {
    drawPhaseGraph(ctx, w, h);
  } else if (state.graphMode === "energy") {
    drawEnergyGraph(ctx, w, h);
  } else {
    drawTimeGraph(ctx, w, h);
  }
}

function drawGraphBackground(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = "#fbfdfb";
  ctx.fillRect(0, 0, w, h);
  const left = 56;
  const right = w - 20;
  const top = 22;
  const bottom = h - 42;

  ctx.strokeStyle = "rgba(214, 226, 220, 0.85)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i += 1) {
    const x = left + ((right - left) * i) / 8;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let i = 0; i <= 6; i += 1) {
    const y = top + ((bottom - top) * i) / 6;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#24302c";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
  ctx.restore();
}

function drawTimeGraph(ctx, w, h) {
  const left = 56;
  const right = w - 20;
  const top = 22;
  const bottom = h - 42;
  const data = state.history;
  const tMin = data[0].t;
  const tMax = Math.max(tMin + 1, data[data.length - 1].t);
  const maxX = Math.max(0.05, ...data.map((d) => Math.abs(d.x)), state.amplitude);
  const yMax = maxX * 1.2;
  const zeroY = top + (bottom - top) / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(23, 32, 29, 0.45)";
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(left, zeroY);
  ctx.lineTo(right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const map = (d) => ({
    x: left + ((d.t - tMin) / (tMax - tMin)) * (right - left),
    y: zeroY - (d.x / yMax) * ((bottom - top) / 2)
  });
  plotLine(ctx, data, map, "#168965", 2.8);

  if (state.mode === "damped" || state.mode === "forced") {
    const gamma = activeDamping() / (2 * state.mass);
    const a0 = Math.max(state.amplitude, 0.01);
    const envelope = data.map((d) => ({
      t: d.t,
      x: a0 * Math.exp(-gamma * d.t)
    }));
    const envelopeNeg = envelope.map((d) => ({ t: d.t, x: -d.x }));
    plotLine(ctx, envelope, map, "rgba(239, 143, 45, 0.72)", 1.7);
    plotLine(ctx, envelopeNeg, map, "rgba(239, 143, 45, 0.72)", 1.7);
  }

  labelGraph(ctx, w, h, "x(t) en metros", `${fmt(tMax - tMin, 1)} s visibles`);
}

function drawPhaseGraph(ctx, w, h) {
  const left = 56;
  const right = w - 20;
  const top = 22;
  const bottom = h - 42;
  const data = state.history;
  const maxX = Math.max(0.05, ...data.map((d) => Math.abs(d.x)), state.amplitude);
  const maxV = Math.max(0.1, ...data.map((d) => Math.abs(d.v)));
  const cx = left + (right - left) / 2;
  const cy = top + (bottom - top) / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(23, 32, 29, 0.45)";
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(left, cy);
  ctx.lineTo(right, cy);
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  plotLine(
    ctx,
    data,
    (d) => ({
      x: cx + (d.x / (maxX * 1.15)) * ((right - left) / 2),
      y: cy - (d.v / (maxV * 1.15)) * ((bottom - top) / 2)
    }),
    "#2f67d8",
    2.4
  );
  labelGraph(ctx, w, h, "Diagrama de fase: velocidad contra desplazamiento", "x horizontal, v vertical");
}

function drawEnergyGraph(ctx, w, h) {
  const left = 56;
  const right = w - 20;
  const top = 22;
  const bottom = h - 42;
  const data = state.history;
  const tMin = data[0].t;
  const tMax = Math.max(tMin + 1, data[data.length - 1].t);
  const eMax = Math.max(0.01, ...data.map((d) => d.total), 0.5 * state.k * state.amplitude ** 2);

  const mapFor = (key) => (d) => ({
    x: left + ((d.t - tMin) / (tMax - tMin)) * (right - left),
    y: bottom - (d[key] / (eMax * 1.15)) * (bottom - top)
  });
  plotLine(ctx, data, mapFor("kinetic"), "#2f67d8", 2);
  plotLine(ctx, data, mapFor("potential"), "#168965", 2);
  plotLine(ctx, data, mapFor("total"), "#ef8f2d", 2.7);
  labelGraph(ctx, w, h, "Energía en joules", "Ec, Ep y Et");
}

function labelGraph(ctx, w, h, title, subtitle) {
  ctx.save();
  ctx.fillStyle = "#17201d";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, 60, 18);
  ctx.fillStyle = "#5d6d68";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(subtitle, w - 22, h - 14);
  ctx.restore();
}

function drawResonanceStatic() {
  if (!resonanceCanvas || !resonanceCtx) return;
  const { width: w, height: h } = fitCanvas(resonanceCanvas, resonanceCtx);
  const ctx = resonanceCtx;
  const left = 58;
  const right = w - 24;
  const top = 24;
  const bottom = h - 48;
  const zetas = [
    { value: 0.1, color: "#2563eb" },
    { value: 0.3, color: "#16a34a" },
    { value: 0.7, color: "#f59e0b" },
    { value: 1.0, color: "#dc2626" }
  ];
  const samples = 260;
  const curves = zetas.map((zeta) => {
    const points = [];
    for (let i = 0; i <= samples; i += 1) {
      const ratio = 0.05 + (2.8 * i) / samples;
      const amplitude = 1 / Math.sqrt((1 - ratio * ratio) ** 2 + (2 * zeta * ratio) ** 2);
      points.push({ ratio, amplitude: Math.min(amplitude, 5.5) });
    }
    return { ...zeta, points };
  });
  const yMax = 5.5;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 7; i += 1) {
    const x = left + ((right - left) * i) / 7;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const y = top + ((bottom - top) * i) / 5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(37, 99, 235, 0.55)";
  const resonanceX = left + ((1 - 0.05) / 2.8) * (right - left);
  ctx.beginPath();
  ctx.moveTo(resonanceX, top);
  ctx.lineTo(resonanceX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  curves.forEach((curve) => {
    ctx.strokeStyle = curve.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    curve.points.forEach((point, index) => {
      const x = left + ((point.ratio - 0.05) / 2.8) * (right - left);
      const y = bottom - (point.amplitude / yMax) * (bottom - top);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  ctx.fillStyle = "#0f172a";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Amplitud normalizada", left, 18);
  ctx.textAlign = "center";
  ctx.fillText("ω / ω₀", (left + right) / 2, h - 13);
  ctx.save();
  ctx.translate(16, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("A(ω)", 0, 0);
  ctx.restore();

  ctx.textAlign = "left";
  ctx.font = "700 12px system-ui, sans-serif";
  zetas.forEach((zeta, index) => {
    const x = right - 132;
    const y = top + 18 + index * 22;
    ctx.strokeStyle = zeta.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 26, y - 4);
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.fillText(`ζ = ${zeta.value.toFixed(1)}`, x + 34, y);
  });
}

function exportCsv() {
  const rows = [
    ["t_s", "x_m", "v_m_s", "a_m_s2", "energia_cinetica_J", "energia_potencial_J", "energia_total_J"],
    ...state.history.map((d) => [
      d.t,
      d.x,
      d.v,
      d.a,
      d.kinetic,
      d.potential,
      d.total
    ])
  ];
  const csv = rows.map((row) => row.map((value) => String(value)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "movimiento-oscilatorio.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function loadPreset(name) {
  if (name === "natural") {
    setMode("free");
    els.massInput.value = "300";
    els.springInput.value = "16";
    els.amplitudeInput.value = "14";
  }
  if (name === "damping") {
    setMode("damped");
    els.mediumSelect.value = "lightOil";
    state.medium = "lightOil";
    applyMediumPreset();
    els.massInput.value = "250";
    els.springInput.value = "18";
    els.amplitudeInput.value = "18";
  }
  if (name === "forced") {
    setMode("forced");
    els.mediumSelect.value = "water";
    state.medium = "water";
    applyMediumPreset();
    els.massInput.value = "250";
    els.springInput.value = "18";
    els.forceInput.value = "0.65";
    els.driveInput.value = fmt(Math.sqrt(18 / 0.25) / (2 * Math.PI), 2);
    els.amplitudeInput.value = "6";
  }
  syncStateFromInputs(false);
  resetSimulation(true);
  document.querySelector("#simulador").scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncStateFromInputs(resetAmplitude = false) {
  state.mass = Number(els.massInput.value) / 1000;
  state.k = Number(els.springInput.value);
  state.amplitude = Number(els.amplitudeInput.value) / 100;
  state.gravity = Number(els.gravityInput.value);
  state.medium = els.mediumSelect.value;
  state.damping = state.mode === "free" ? 0 : Number(els.dampingInput.value);
  state.force = Number(els.forceInput.value);
  state.driveFrequency = Number(els.driveInput.value);
  state.speed = Number(els.speedSelect.value);
  state.showVelocity = els.showVelocity.checked;
  state.showAcceleration = els.showAcceleration.checked;
  state.showEquilibrium = els.showEquilibrium.checked;
  state.showTrace = els.showTrace.checked;
  if (resetAmplitude) resetSimulation(true);
  updateControls();
  updateReadouts();
  draw();
}

function bindEvents() {
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setGraphMode(button.dataset.graph));
  });
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => loadPreset(button.dataset.preset));
  });

  els.playButton.addEventListener("click", () => setRunning(!state.running));
  els.resetButton.addEventListener("click", () => resetSimulation(true));
  els.kickButton.addEventListener("click", () => {
    state.v += 0.35;
    setRunning(true);
  });
  els.exportButton.addEventListener("click", exportCsv);
  els.resonanceButton.addEventListener("click", () => {
    const f0 = naturalOmega() / (2 * Math.PI);
    state.driveFrequency = clamp(f0, 0.1, 4);
    els.driveInput.value = fmt(state.driveFrequency, 2);
    syncStateFromInputs(false);
  });

  [els.massInput, els.springInput, els.gravityInput, els.forceInput, els.driveInput, els.speedSelect].forEach(
    (input) => input.addEventListener("input", () => syncStateFromInputs(false))
  );
  els.amplitudeInput.addEventListener("input", () => syncStateFromInputs(true));
  els.dampingInput.addEventListener("input", () => {
    state.medium = "custom";
    els.mediumSelect.value = "custom";
    syncStateFromInputs(false);
  });
  els.mediumSelect.addEventListener("change", () => {
    state.medium = els.mediumSelect.value;
    applyMediumPreset();
    syncStateFromInputs(false);
  });
  [els.showVelocity, els.showAcceleration, els.showEquilibrium, els.showTrace].forEach((input) => {
    input.addEventListener("change", () => syncStateFromInputs(false));
  });

  window.addEventListener("resize", () => {
    draw();
    drawResonanceStatic();
  });
}

function renderMath(root = document.body) {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(root, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false
  });
}

function init() {
  bindEvents();
  if (window.lucide) window.lucide.createIcons();
  renderMath();
  resetSimulation(true);
  setMode("free");
  setGraphMode("time");
  drawResonanceStatic();
  requestAnimationFrame(animationLoop);
}

window.addEventListener("load", init);
