/* Simulador de movimiento oscilatorio masa-resorte vertical.
   Toda la física se integra internamente en unidades SI:
     m [kg], k [N/m], b [N·s/m], x [m], v [m/s], t [s].
   Los controles permiten introducir valores en cm o g; la conversión
   ocurre en syncStateFromInputs antes de pasar al integrador.

   Ecuación dinámica integrada (RK4):
       m·ẍ + b·ẋ + k·x = F0·cos(ω·t)
   La coordenada x se mide desde el equilibrio estático: la gravedad
   desplaza el equilibrio pero no aparece en esta ecuación.
*/

const mediumCatalog = {
  air: {
    label: "Aire",
    damping: 0.015,
    color: "rgba(180, 215, 255, 0.20)",
    note: "Aire: casi ideal; la amplitud cae lentamente.",
    showTank: false
  },
  water: {
    label: "Agua",
    damping: 0.10,
    color: "rgba(100, 180, 255, 0.35)",
    note: "Agua: disipación visible sin destruir de inmediato la oscilación.",
    showTank: true
  },
  lightOil: {
    label: "Aceite ligero",
    damping: 0.32,
    color: "rgba(220, 190, 60, 0.35)",
    note: "Aceite: el rozamiento viscoso reduce claramente la amplitud.",
    showTank: true
  },
  glycerin: {
    label: "Glicerina",
    damping: 0.74,
    color: "rgba(200, 140, 40, 0.45)",
    note: "Glicerina: útil para discutir amortiguamiento fuerte.",
    showTank: true
  },
  custom: {
    label: "Personalizado",
    damping: 0.10,
    color: "rgba(150, 150, 150, 0.30)",
    note: "Ajuste personalizado del coeficiente b.",
    showTank: true
  }
};

const state = {
  mode: "free",
  graphMode: "time",
  running: false,
  t: 0,
  x: 0.12,
  v: 0,
  mass: 0.25,         // kg
  k: 18,              // N/m
  damping: 0.10,      // N·s/m
  gravity: 9.8,       // m/s^2
  amplitude: 0.12,    // m
  amplitudeRequested: 0.12, // m (antes del clamp por seguridad)
  amplitudeClamped: false,
  medium: "water",
  force: 0.55,        // N (F0)
  driveFrequency: 1.0, // Hz
  speed: 1,
  showForces: true,
  showVelocity: true,
  showAcceleration: true,
  showEquilibrium: true,
  showTrace: true,
  lastFrame: null,
  lastSample: -1,
  history: [],
  trace: [],
  liquidHeight: 0     // m (altura útil del líquido)
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
  showForces: document.querySelector("#showForces"),
  showVelocity: document.querySelector("#showVelocity"),
  showAcceleration: document.querySelector("#showAcceleration"),
  showEquilibrium: document.querySelector("#showEquilibrium"),
  showTrace: document.querySelector("#showTrace"),
  timeReadout: document.querySelector("#timeReadout"),
  xReadout: document.querySelector("#xReadout"),
  vReadout: document.querySelector("#vReadout"),
  omegaReadout: document.querySelector("#omegaReadout"),
  freqReadout: document.querySelector("#freqReadout"),
  periodReadout: document.querySelector("#periodReadout"),
  zetaReadout: document.querySelector("#zetaReadout"),
  energyReadout: document.querySelector("#energyReadout"),
  liquidHeightReadout: document.querySelector("#liquidHeightReadout"),
  massValue: document.querySelector("#massValue"),
  springValue: document.querySelector("#springValue"),
  amplitudeValue: document.querySelector("#amplitudeValue"),
  gravityValue: document.querySelector("#gravityValue"),
  dampingValue: document.querySelector("#dampingValue"),
  forceValue: document.querySelector("#forceValue"),
  driveValue: document.querySelector("#driveValue"),
  regimePill: document.querySelector("#regimePill"),
  insightCard: document.querySelector("#insightCard"),
  tankWarning: document.querySelector("#tankWarning"),
  graphHeading: document.querySelector("#graphHeading"),
  graphLegend: document.querySelector("#graphLegend")
};

const simCtx = els.simulationCanvas.getContext("2d");
const graphCtx = els.graphCanvas.getContext("2d");
const resonanceCanvas = document.querySelector("#resonanceCanvas");
const resonanceCtx = resonanceCanvas ? resonanceCanvas.getContext("2d") : null;

/* ---------- Utilidades ---------- */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

/* ---------- Física ---------- */

function activeDamping() {
  return state.mode === "free" ? 0 : state.damping;
}

function driveOmega() {
  return 2 * Math.PI * state.driveFrequency;
}

function naturalOmega() {
  return Math.sqrt(state.k / state.mass);
}

function naturalFrequency() {
  return naturalOmega() / (2 * Math.PI);
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

/* Frecuencia (angular) de resonancia en amplitud, válida para ζ < 1/√2.
   ω_res = ω0 · sqrt(1 − 2ζ²) */
function resonanceOmega() {
  const omega0 = naturalOmega();
  const zeta = dampingRatio();
  if (zeta >= Math.SQRT1_2) return null; // no hay pico
  return omega0 * Math.sqrt(1 - 2 * zeta * zeta);
}

/* Amplitud estacionaria forzada A(ω) = F0 / sqrt((k-mω²)² + (bω)²) */
function steadyAmplitude(omega) {
  const k = state.k;
  const m = state.mass;
  const b = activeDamping();
  const F0 = state.force;
  const real = k - m * omega * omega;
  const imag = b * omega;
  const denom = Math.sqrt(real * real + imag * imag);
  if (denom < 1e-9) return 0;
  return F0 / denom;
}

/* Estimación conservadora de la máxima amplitud que alcanzará la masa
   durante la simulación. Se usa para dimensionar el recipiente. */
function expectedMaxAmplitude() {
  const A0 = state.amplitude;
  if (state.mode === "free") return A0;
  if (state.mode === "damped") return A0;
  // Forzado: amplitud estacionaria + posible sobrelapamiento transitorio
  const Ass = steadyAmplitude(driveOmega());
  // Combinación conservadora: peor caso transitorio ~ A0 + Ass
  return Math.max(A0, Ass, A0 + Ass * 0.7);
}

function accelerationAt(x = state.x, v = state.v, t = state.t) {
  const drivingForce =
    state.mode === "forced" ? state.force * Math.cos(driveOmega() * t) : 0;
  return (drivingForce - activeDamping() * v - state.k * x) / state.mass;
}

function springForceUp() {
  // Definimos x positivo hacia abajo. La fuerza elástica neta sobre la masa
  // alrededor del equilibrio es F_k = -k·x  (positivo hacia arriba si x>0).
  return -state.k * state.x;
}

function dampingForceVertical() {
  return -activeDamping() * state.v;
}

function externalForceVertical() {
  if (state.mode !== "forced") return 0;
  return state.force * Math.cos(driveOmega() * state.t);
}

function energy() {
  const kinetic = 0.5 * state.mass * state.v * state.v;
  const potential = 0.5 * state.k * state.x * state.x;
  return { kinetic, potential, total: kinetic + potential };
}

function regimeLabel() {
  if (state.mode === "free") return "Movimiento armónico simple";
  const zeta = dampingRatio();
  if (state.mode === "forced") {
    const f0 = naturalFrequency();
    const ratio = state.driveFrequency / f0;
    if (ratio > 0.92 && ratio < 1.08) return "Cerca de resonancia";
    if (ratio < 0.92) return "Motor por debajo de f₀";
    return "Motor por encima de f₀";
  }
  if (zeta < 0.95) return "Sistema subamortiguado";
  if (zeta <= 1.05) return "Amortiguamiento crítico";
  return "Sistema sobreamortiguado";
}

/* ---------- Recipiente / seguridad ---------- */

const MASS_VISUAL_HEIGHT_M = 0.05; // altura física aproximada de la masa para el recipiente
const SAFETY_MARGIN = 0.20;        // 20% extra de margen

/* Devuelve la altura útil del líquido necesaria para contener ±A_max
   más la altura de la masa y un margen de seguridad. */
function requiredLiquidHeight(Amax) {
  return 2 * Amax + MASS_VISUAL_HEIGHT_M + SAFETY_MARGIN * (2 * Amax + MASS_VISUAL_HEIGHT_M);
}

/* Limita la amplitud para no superar un máximo razonable y la capacidad
   física que el recipiente puede mostrar. */
function clampSafeAmplitude() {
  state.amplitudeRequested = state.amplitude;
  state.amplitudeClamped = false;
  // Solo en modo con tanque tiene sentido limitar por contención.
  if (state.mode === "free") {
    state.liquidHeight = 0;
    return;
  }
  // El recipiente puede ser tan alto como el simulador permita (~0.40 m de motion).
  const A_HARD_LIMIT = 0.30; // 30 cm es el máximo razonable del montaje
  const Amax = expectedMaxAmplitude();
  if (Amax > A_HARD_LIMIT) {
    // Reescalamos la amplitud inicial para no exceder el límite (considerando
    // que en forzado A_max ≈ A0 + 0.7·Ass).
    if (state.mode === "forced") {
      const Ass = steadyAmplitude(driveOmega());
      const allowedA0 = Math.max(0.005, A_HARD_LIMIT - 0.7 * Ass);
      if (state.amplitude > allowedA0) {
        state.amplitude = allowedA0;
        state.amplitudeClamped = true;
      }
    } else if (state.amplitude > A_HARD_LIMIT) {
      state.amplitude = A_HARD_LIMIT;
      state.amplitudeClamped = true;
    }
  }
  state.liquidHeight = requiredLiquidHeight(expectedMaxAmplitude());
}

/* ---------- Estado UI ---------- */

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
    const allowed = (node.dataset.visibleMode || "").split(",");
    node.hidden = !allowed.includes(mode);
  });
  if (mode === "free") {
    state.damping = 0;
  } else {
    applyMediumPreset();
  }
  // Cambiar a un modo donde "response" no existe vuelve a la gráfica x(t).
  if (state.graphMode === "response" && mode !== "forced") {
    setGraphMode("time");
  } else {
    updateGraphHeading();
    updateGraphLegend();
  }
  clampSafeAmplitude();
  resetSimulation(true);
  updateControls();
}

function setGraphMode(mode) {
  state.graphMode = mode;
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.graph === mode);
  });
  updateGraphHeading();
  updateGraphLegend();
  drawGraph();
}

function updateGraphHeading() {
  if (!els.graphHeading) return;
  const titles = {
    time: "x(t) · desplazamiento contra el tiempo",
    phase: "Diagrama de fase: ẋ vs x",
    energy: "Energías Ec, Ep y E_total contra el tiempo",
    response: "A(f) · curva de respuesta en frecuencia"
  };
  els.graphHeading.textContent = titles[state.graphMode] || titles.time;
}

function updateGraphLegend() {
  if (!els.graphLegend) return;
  const showEnvelope = state.mode === "damped" || state.mode === "forced";
  const entries = {
    time: [
      ["line-x", "x · desplazamiento [cm]"],
      showEnvelope ? ["line-env", "Envolvente A·e^(−ζω₀t) [cm]"] : null
    ],
    phase: [
      ["line-v", "ẋ · velocidad [cm/s]"],
      ["line-x", "x · desplazamiento [cm]"]
    ],
    energy: [
      ["line-ec", "Ec = ½mẋ² [J]"],
      ["line-ep", "Ep = ½kx² [J]"],
      ["line-et", "E_total [J]"]
    ],
    response: [
      ["line-response", "A(f) estacionaria [cm]"],
      ["line-peak", "f_res · pico de resonancia"]
    ]
  };
  const entry = entries[state.graphMode] || entries.time;
  els.graphLegend.innerHTML = entry
    .filter(Boolean)
    .map(([cls, label]) => `<span><i class="line ${cls}"></i> ${label}</span>`)
    .join("");
}

function updateControls() {
  els.massValue.textContent = `${fmt(state.mass, 3)} kg`;
  els.springValue.textContent = `${fmt(state.k, 0)} N/m`;
  els.amplitudeValue.textContent = `${fmt(state.amplitude * 100, 1)} cm`;
  els.gravityValue.textContent = `${fmt(state.gravity, 1)} m/s²`;
  els.dampingValue.textContent = `${fmt(activeDamping(), 2)} N·s/m`;
  els.forceValue.textContent = `${fmt(state.force, 2)} N`;
  els.driveValue.textContent = `${fmt(state.driveFrequency, 2)} Hz`;
  els.regimePill.textContent = regimeLabel();
  if (els.tankWarning) els.tankWarning.hidden = !state.amplitudeClamped;
  updateInsight();
}

function updateReadouts() {
  const e = energy();
  els.timeReadout.textContent = `${fmt(state.t, 2)} s`;
  els.xReadout.textContent = `${fmt(state.x * 100, 1)} cm`;
  els.vReadout.textContent = `${fmt(state.v * 100, 1)} cm/s`;
  if (els.omegaReadout) els.omegaReadout.textContent = `${fmt(naturalOmega(), 2)} rad/s`;
  if (els.freqReadout) els.freqReadout.textContent = `${fmt(naturalFrequency(), 2)} Hz`;
  els.periodReadout.textContent = `${fmt(naturalPeriod(), 2)} s`;
  els.zetaReadout.textContent = fmt(dampingRatio(), 3);
  els.energyReadout.textContent = `${fmt(e.total, 3)} J`;
  if (els.liquidHeightReadout) {
    els.liquidHeightReadout.textContent =
      state.mode === "free" ? "—" : `${fmt(state.liquidHeight * 100, 1)} cm`;
  }
  els.regimePill.textContent = regimeLabel();
}

function updateInsight() {
  const f0 = naturalFrequency();
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
      `\\(\\zeta = ${fmt(zeta, 3)}\\); observa cómo cae la envolvente de \\(x(t)\\).`;
  }

  if (state.mode === "forced") {
    const ratio = state.driveFrequency / f0;
    title = "La respuesta máxima aparece cerca de la frecuencia natural.";
    const resOmega = resonanceOmega();
    const resHz = resOmega ? resOmega / (2 * Math.PI) : null;
    body =
      `El motor está en ${fmt(state.driveFrequency, 2)} Hz y \\(f_0 = ${fmt(f0, 2)}\\,\\text{Hz}\\) ` +
      `(cociente ${fmt(ratio, 2)}). ` +
      (resHz
        ? `La resonancia en amplitud aparece a \\(f_{\\text{res}} = ${fmt(resHz, 2)}\\,\\text{Hz}\\).`
        : "Con este ζ no hay pico de resonancia: la respuesta es monótona.");
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

/* ---------- Integrador RK4 ---------- */

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

  // Tope físico de seguridad (no debería ocurrir gracias a clampSafeAmplitude).
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

/* ---------- Canvas helpers ---------- */

function fitCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(280, Math.round(rect.width * dpr));
  const height = Math.max(200, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: width / dpr, height: height / dpr };
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

function draw() {
  drawSimulation();
  drawGraph();
}

/* ---------- Dibujo del montaje ---------- */

function computeStageLayout(w, h) {
  const ceilingY = clamp(h * 0.08, 44, 80);
  const bottomMargin = clamp(h * 0.08, 36, 70);
  const usable = h - ceilingY - bottomMargin;
  const massPx = clamp(usable * 0.12, 40, 70);
  const Amax = Math.max(0.01, expectedMaxAmplitude());
  // Espacio disponible para una mitad del movimiento, restando media masa y un margen.
  const halfRange = (usable - massPx) / 2 - 16;
  const scale = clamp(halfRange / Amax, 80, 1400);
  const equilibriumY = ceilingY + usable * 0.55;
  const staticStretchM = clamp((state.mass * state.gravity) / state.k, 0, 0.4);
  const naturalY = equilibriumY - staticStretchM * scale;
  return { ceilingY, bottomMargin, massPx, Amax, scale, equilibriumY, naturalY };
}

function drawSimulation() {
  const { width: w, height: h } = fitCanvas(els.simulationCanvas, simCtx);
  const ctx = simCtx;
  ctx.clearRect(0, 0, w, h);
  drawStageBackground(ctx, w, h);

  const layout = computeStageLayout(w, h);
  const { ceilingY, massPx, scale, equilibriumY, naturalY, Amax } = layout;

  const cx = w * 0.45;
  const motorAmplitudePx = state.mode === "forced" ? 10 : 0;
  const motorOffset = motorAmplitudePx * Math.sin(driveOmega() * state.t);
  const topY = ceilingY + 16 + motorOffset;
  const massY = clamp(equilibriumY + state.x * scale, ceilingY + massPx, h - 30);
  const massW = clamp(w * 0.115, 50, 80);
  const massH = massPx;
  const attachY = massY - massH / 2 - 6;

  // Recipiente y líquido
  if (state.mode !== "free" && mediumCatalog[state.medium].showTank) {
    drawFluidTank(ctx, w, h, layout, cx, massY, massH);
  }

  // Líneas de referencia
  if (state.showEquilibrium) {
    drawReferenceLine(ctx, 26, w - 28, equilibriumY, "x = 0 · equilibrio estático", "#16a34a", [8, 8]);
    drawReferenceLine(ctx, 26, w - 28, naturalY, "Longitud natural del resorte", "#2563eb", [10, 6]);
  }

  // Ceiling y motor
  drawCeiling(ctx, cx, topY);
  if (state.mode === "forced") drawMotor(ctx, cx - 140, topY - 4);

  // Resorte
  drawSpring(ctx, cx, topY + 24, attachY, Math.max(20, w * 0.030));

  // Rastro
  if (state.showTrace) drawTrace(ctx);

  // Masa
  drawMass(ctx, cx, massY, massW, massH);

  // Diagrama de cuerpo libre (DCL) en tiempo real
  if (state.showForces) {
    drawFreeBodyDiagram(ctx, cx, massY, massW, massH);
  }

  // Vectores velocidad y aceleración
  drawKinematicVectors(ctx, cx, massY, massW);

  // Regla en cm
  drawRuler(ctx, w, h, equilibriumY, scale);

  // Barras de energía
  drawEnergyBars(ctx, w, h);

  // Anotaciones de altura del líquido y máxima amplitud
  if (state.mode !== "free") {
    drawLiquidHeightAnnotation(ctx, w, h, layout, Amax);
  }

  // Rastro: actualizar puntos
  state.trace.push({ x: cx, y: massY, t: state.t });
  const traceMin = state.t - 2.4;
  state.trace = state.trace.filter((point) => point.t >= traceMin);
}

function drawStageBackground(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = "#fbfdfb";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(214, 226, 220, 0.55)";
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
  ctx.restore();
}

function drawCeiling(ctx, cx, y) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#2a302e";
  ctx.fillStyle = "#d9e2dd";
  roundRectPath(ctx, cx - 70, y - 20, 140, 20, 5);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#7a8580";
  ctx.lineWidth = 2;
  for (let x = cx - 60; x < cx + 60; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, y - 19);
    ctx.lineTo(x - 12, y - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpring(ctx, cx, y1, y2, radius) {
  const coils = 10;
  const points = coils * 28;
  if (y2 <= y1 + 4) return;
  ctx.save();
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
  ctx.lineTo(cx, y2 + 14);
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
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  roundRectPath(ctx, x, y, width, height, 6);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#7c4b20";
  ctx.stroke();

  ctx.fillStyle = "#101816";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`m = ${grams} g`, cx, cy);
  ctx.restore();
}

function drawFluidTank(ctx, w, h, layout, cx, massY, massH) {
  const { equilibriumY, scale, Amax } = layout;
  // Calcular el tanque para que abarque ±A_max + masaH/2 + margen.
  const halfMass = massH / 2;
  const margin = 18;
  const wantedTop = equilibriumY - (Amax * scale + halfMass + margin);
  const wantedBottom = equilibriumY + (Amax * scale + halfMass + margin);
  const tankTop = clamp(wantedTop, layout.ceilingY + 30, equilibriumY - halfMass - 10);
  const tankBottom = clamp(wantedBottom, equilibriumY + halfMass + 10, h - 20);
  const tankH = tankBottom - tankTop;
  const tankW = clamp(w * 0.36, 200, 360);
  const tankX = cx - tankW / 2;
  const fluidTop = tankTop + 14 + Math.sin(state.t * 1.7) * 1.5;
  const color = mediumCatalog[state.medium].color;

  ctx.save();
  // Vidrio del recipiente
  ctx.strokeStyle = "rgba(28, 45, 40, 0.55)";
  ctx.lineWidth = 2.2;
  roundRectPath(ctx, tankX, tankTop, tankW, tankH, 8);
  ctx.stroke();
  // Líquido
  ctx.fillStyle = color;
  ctx.fillRect(tankX + 3, fluidTop, tankW - 6, tankBottom - fluidTop - 3);

  // Línea superior del líquido con leve oscilación
  ctx.strokeStyle = "rgba(47, 103, 216, 0.55)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= tankW - 12; i += 8) {
    const px = tankX + 6 + i;
    const py = fluidTop + Math.sin(i * 0.11 + state.t * 4) * 1.6;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Burbujas cerca de la masa
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  for (let i = 0; i < 5; i += 1) {
    const bx = tankX + 22 + ((i * (tankW - 44)) / 4);
    const by = massY + Math.sin(state.t * 3 + i * 0.7) * 9;
    ctx.beginPath();
    ctx.arc(bx, by, 2.2 + (i % 3) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Etiqueta del medio dentro del tanque
  ctx.fillStyle = "rgba(23, 32, 29, 0.78)";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(mediumCatalog[state.medium].label, tankX + 10, tankBottom - 10);
  ctx.restore();
}

function drawLiquidHeightAnnotation(ctx, w, h, layout, Amax) {
  const { equilibriumY, scale } = layout;
  const halfRange = Amax * scale + 18 + 25;
  const yTop = equilibriumY - halfRange;
  const yBot = equilibriumY + halfRange;
  const xLine = w - clamp(w * 0.16, 110, 180);
  ctx.save();
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xLine, yTop);
  ctx.lineTo(xLine, yBot);
  // Topes
  ctx.moveTo(xLine - 6, yTop);
  ctx.lineTo(xLine + 6, yTop);
  ctx.moveTo(xLine - 6, yBot);
  ctx.lineTo(xLine + 6, yBot);
  ctx.stroke();
  ctx.fillStyle = "#0f766e";
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`H = ${fmt(state.liquidHeight * 100, 1)} cm`, xLine + 10, (yTop + yBot) / 2 - 6);
  ctx.fillText(`A_max = ${fmt(Amax * 100, 1)} cm`, xLine + 10, (yTop + yBot) / 2 + 10);
  ctx.restore();
}

function drawMotor(ctx, x, y) {
  const angle = driveOmega() * state.t;
  ctx.save();
  ctx.fillStyle = "#26312d";
  ctx.strokeStyle = "#111816";
  ctx.lineWidth = 2;
  roundRectPath(ctx, x - 50, y - 26, 100, 54, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eef7f3";
  ctx.font = "800 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Motor", x, y - 32);
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#ef8f2d";
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();
  ctx.restore();
}

function drawReferenceLine(ctx, x1, x2, y, label, color, dash) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, x1 + 8, y - 5);
  ctx.restore();
}

function drawTrace(ctx) {
  if (state.trace.length < 2) return;
  ctx.save();
  for (let i = 0; i < state.trace.length; i += 1) {
    const point = state.trace[i];
    const age = state.t - point.t;
    const alpha = clamp(1 - age / 2.4, 0, 1);
    ctx.fillStyle = `rgba(22, 137, 101, ${alpha * 0.22})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8 * alpha + 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- Diagrama de cuerpo libre (DCL) ---------- */

function drawForceArrow(ctx, fromX, fromY, dy, color, symbol, valueText) {
  const minLen = 6;
  let len = dy;
  if (Math.abs(len) < minLen) {
    // Mostrar un guion para indicar fuerza casi cero (sin flecha).
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${symbol} ≈ 0`, fromX + 6, fromY);
    ctx.restore();
    return;
  }
  const endY = fromY + len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(fromX, endY);
  ctx.stroke();
  // Cabeza
  const dir = Math.sign(len);
  ctx.beginPath();
  ctx.moveTo(fromX, endY);
  ctx.lineTo(fromX - 6, endY - 10 * dir);
  ctx.lineTo(fromX + 6, endY - 10 * dir);
  ctx.closePath();
  ctx.fill();
  // Etiqueta
  ctx.font = "800 11.5px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const labelY = endY + (dir > 0 ? 12 : -12);
  ctx.fillText(`${symbol} = ${valueText}`, fromX + 8, labelY);
  ctx.restore();
}

function drawFreeBodyDiagram(ctx, cx, massY, massW, massH) {
  // Sólo fuerzas verticales (sistema masa-resorte vertical).
  // Coordenada de pantalla: y crece hacia abajo.
  const Fk = springForceUp();           // signo físico (positivo = hacia arriba)
  const W = state.mass * state.gravity; // siempre hacia abajo
  const Fb = dampingForceVertical();    // signo físico
  const Fext = externalForceVertical(); // signo físico (positivo hacia abajo o arriba según motor)

  // Factor de escala visual común para todas las fuerzas (1 N → ~36 px).
  const allMag = [Math.abs(Fk), W, Math.abs(Fb), Math.abs(Fext)];
  const maxMag = Math.max(0.001, ...allMag);
  const maxDisplayPx = 70;
  const k_scale = maxDisplayPx / maxMag;

  // Convertir a desplazamiento en píxeles (positivo hacia abajo en canvas).
  const fkPx = -Fk * k_scale;   // si Fk>0 (hacia arriba), debe ir hacia arriba (dy<0)
  const wPx = W * k_scale;       // hacia abajo
  const fbPx = -Fb * k_scale;
  const fextPx = -Fext * k_scale; // convención: F(t) actúa "tirando" verticalmente

  const topAnchor = { x: cx - massW / 2 - 18, y: massY - massH * 0.15 };
  const bottomAnchor = { x: cx + massW / 2 + 18, y: massY + massH * 0.15 };
  const leftFar = { x: cx - massW / 2 - 70, y: massY };
  const rightFar = { x: cx + massW / 2 + 70, y: massY };

  // F_k (fuerza elástica) — anclada arriba a la izquierda
  drawForceArrow(
    ctx,
    topAnchor.x,
    topAnchor.y,
    fkPx,
    "#2563eb",
    "F_k = −kx",
    `${fmt(Fk, 2)} N`
  );

  // W (peso) — anclada abajo a la derecha
  drawForceArrow(
    ctx,
    bottomAnchor.x,
    bottomAnchor.y,
    wPx,
    "#dc2626",
    "W = mg",
    `${fmt(W, 2)} N`
  );

  // F_b (viscosa) — anclada a la izquierda, sólo si hay amortiguamiento
  if (state.mode !== "free") {
    drawForceArrow(
      ctx,
      leftFar.x,
      leftFar.y,
      fbPx,
      "#16a34a",
      "F_b = −bẋ",
      `${fmt(Fb, 2)} N`
    );
  }

  // F(t) externa — anclada a la derecha, sólo en modo forzado
  if (state.mode === "forced") {
    drawForceArrow(
      ctx,
      rightFar.x,
      rightFar.y,
      fextPx,
      "#d97706",
      "F(t) = F₀cos(ωt)",
      `${fmt(Fext, 2)} N`
    );
  }
}

function drawKinematicVectors(ctx, cx, massY, massW) {
  // Velocidad: hacia donde se mueve la masa. v>0 → hacia abajo (x positivo abajo).
  if (state.showVelocity) {
    const vPx = clamp(state.v * 60, -90, 90);
    drawSideArrow(ctx, cx + massW / 2 + 110, massY, vPx, "#2f67d8", "ẋ", `${fmt(state.v, 2)} m/s`);
  }
  if (state.showAcceleration) {
    const aPx = clamp(accelerationAt() * 8, -90, 90);
    drawSideArrow(
      ctx,
      cx + massW / 2 + 150,
      massY,
      aPx,
      "#c84646",
      "ẍ",
      `${fmt(accelerationAt(), 2)} m/s²`
    );
  }
}

function drawSideArrow(ctx, fromX, fromY, dy, color, symbol, valueText) {
  if (Math.abs(dy) < 4) return;
  const endY = fromY + dy;
  const dir = Math.sign(dy);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(fromX, endY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fromX, endY);
  ctx.lineTo(fromX - 6, endY - 10 * dir);
  ctx.lineTo(fromX + 6, endY - 10 * dir);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${symbol} = ${valueText}`, fromX + 8, endY + (dir > 0 ? 12 : -12));
  ctx.restore();
}

function drawEnergyBars(ctx, w, h) {
  const e = energy();
  const maxEnergy = Math.max(0.01, 0.5 * state.k * state.amplitude * state.amplitude, e.total);
  const barX = 18;
  const barY = h - 162;
  const barW = 96;
  const barH = 92;
  const bars = [
    { label: "Ec", value: e.kinetic, color: "#2563eb" },
    { label: "Ep", value: e.potential, color: "#168965" },
    { label: "E_t", value: e.total, color: "#d97706" }
  ];

  ctx.save();
  roundRectPath(ctx, barX - 10, barY - 24, barW + 26, barH + 54, 7);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(214, 226, 220, 0.9)";
  ctx.stroke();

  ctx.fillStyle = "#17201d";
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Energía [J]", barX, barY - 9);

  bars.forEach((bar, index) => {
    const x = barX + index * 32;
    const height = clamp((bar.value / maxEnergy) * barH, 0, barH);
    ctx.fillStyle = "rgba(23, 32, 29, 0.08)";
    ctx.fillRect(x, barY, 22, barH);
    ctx.fillStyle = bar.color;
    ctx.fillRect(x, barY + barH - height, 22, height);
    ctx.fillStyle = "#17201d";
    ctx.font = "800 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(bar.label, x + 11, barY + barH + 14);
    ctx.font = "700 9.5px system-ui, sans-serif";
    ctx.fillText(`${fmt(bar.value, 3)}`, x + 11, barY + barH + 26);
  });
  ctx.restore();
}

function drawRuler(ctx, w, h, equilibriumY, scale) {
  const x = w - 36;
  ctx.save();
  ctx.strokeStyle = "#586862";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, 50);
  ctx.lineTo(x, h - 50);
  ctx.stroke();

  ctx.font = "700 10px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#586862";
  const range = Math.ceil(((h - 100) / 2 / scale) * 100);
  const step = range > 60 ? 10 : 5;
  for (let cm = -range; cm <= range; cm += step) {
    const y = equilibriumY + (cm / 100) * scale;
    if (y < 56 || y > h - 56) continue;
    const tick = cm % 10 === 0 ? 8 : 4;
    ctx.beginPath();
    ctx.moveTo(x - tick, y);
    ctx.lineTo(x + tick, y);
    ctx.stroke();
    if (cm % 10 === 0) ctx.fillText(`${cm} cm`, x - 38, y + 3);
  }
  ctx.fillStyle = "#17201d";
  ctx.font = "800 11px system-ui, sans-serif";
  ctx.fillText("x [cm]", x - 30, 44);
  ctx.restore();
}

/* ---------- Gráficas ---------- */

function drawGraph() {
  const { width: w, height: h } = fitCanvas(els.graphCanvas, graphCtx);
  const ctx = graphCtx;
  ctx.clearRect(0, 0, w, h);

  if (state.graphMode === "response") {
    drawResponseGraph(ctx, w, h);
    return;
  }

  drawGraphBackground(ctx, w, h);

  if (state.history.length < 2) sampleHistory(true);

  if (state.graphMode === "phase") {
    drawPhaseGraph(ctx, w, h);
  } else if (state.graphMode === "energy") {
    drawEnergyGraph(ctx, w, h);
  } else {
    drawTimeGraph(ctx, w, h);
  }
}

/* Recuadro de gráfica reutilizable con ejes etiquetados. */
function plotBox(ctx, w, h, opts) {
  const margin = { left: 66, right: 24, top: 30, bottom: 46 };
  const inner = {
    left: margin.left,
    right: w - margin.right,
    top: margin.top,
    bottom: h - margin.bottom
  };
  ctx.save();
  ctx.fillStyle = "#fbfdfb";
  ctx.fillRect(0, 0, w, h);
  // Cuadrícula
  ctx.strokeStyle = "rgba(214, 226, 220, 0.75)";
  ctx.lineWidth = 1;
  const gridX = 8;
  const gridY = 6;
  for (let i = 0; i <= gridX; i += 1) {
    const x = inner.left + ((inner.right - inner.left) * i) / gridX;
    ctx.beginPath();
    ctx.moveTo(x, inner.top);
    ctx.lineTo(x, inner.bottom);
    ctx.stroke();
  }
  for (let i = 0; i <= gridY; i += 1) {
    const y = inner.top + ((inner.bottom - inner.top) * i) / gridY;
    ctx.beginPath();
    ctx.moveTo(inner.left, y);
    ctx.lineTo(inner.right, y);
    ctx.stroke();
  }
  // Ejes
  ctx.strokeStyle = "#24302c";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(inner.left, inner.top);
  ctx.lineTo(inner.left, inner.bottom);
  ctx.lineTo(inner.right, inner.bottom);
  ctx.stroke();
  // Título
  if (opts.title) {
    ctx.fillStyle = "#17201d";
    ctx.font = "800 13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(opts.title, inner.left, 18);
  }
  // Etiqueta del eje X
  if (opts.xLabel) {
    ctx.fillStyle = "#17201d";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(opts.xLabel, (inner.left + inner.right) / 2, h - 10);
  }
  // Etiqueta del eje Y
  if (opts.yLabel) {
    ctx.save();
    ctx.fillStyle = "#17201d";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.translate(16, (inner.top + inner.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return inner;
}

function drawAxisTicks(ctx, inner, xRange, yRange, xUnit, yUnit, opts = {}) {
  const xTicks = opts.xTicks || 6;
  const yTicks = opts.yTicks || 6;
  ctx.save();
  ctx.fillStyle = "#5d6d68";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= xTicks; i += 1) {
    const t = i / xTicks;
    const x = inner.left + (inner.right - inner.left) * t;
    const value = xRange[0] + (xRange[1] - xRange[0]) * t;
    ctx.fillText(fmt(value, opts.xDigits ?? 1), x, inner.bottom + 16);
    // Tick
    ctx.strokeStyle = "#24302c";
    ctx.beginPath();
    ctx.moveTo(x, inner.bottom);
    ctx.lineTo(x, inner.bottom + 4);
    ctx.stroke();
  }
  ctx.textAlign = "right";
  for (let i = 0; i <= yTicks; i += 1) {
    const t = i / yTicks;
    const y = inner.bottom - (inner.bottom - inner.top) * t;
    const value = yRange[0] + (yRange[1] - yRange[0]) * t;
    ctx.fillText(fmt(value, opts.yDigits ?? 1), inner.left - 6, y + 4);
    ctx.strokeStyle = "#24302c";
    ctx.beginPath();
    ctx.moveTo(inner.left - 4, y);
    ctx.lineTo(inner.left, y);
    ctx.stroke();
  }
  ctx.restore();
}

function plotSeries(ctx, inner, points, mapper, color, width = 2, dashed = false) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([8, 6]);
  ctx.beginPath();
  points.forEach((point, index) => {
    const mapped = mapper(point);
    if (index === 0) ctx.moveTo(mapped.x, mapped.y);
    else ctx.lineTo(mapped.x, mapped.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* Garantiza que la magnitud máxima ocupe ≥70% del rango disponible. */
function autoRange(maxMag) {
  const safe = Math.max(1e-6, maxMag);
  // Si la curva ocupa menos del 70%, ajustamos el rango para que sí.
  const target = safe / 0.85; // un poco más que 0.7 para margen visual
  return target;
}

function drawGraphBackground() {
  // Mantenido vacío; se reemplaza por plotBox.
}

function drawTimeGraph(ctx, w, h) {
  const data = state.history;
  const tMin = data[0].t;
  const tMax = Math.max(tMin + 1, data[data.length - 1].t);
  const maxXm = Math.max(0.01, ...data.map((d) => Math.abs(d.x)), state.amplitude);
  const yRangeCm = autoRange(maxXm * 100);

  const inner = plotBox(ctx, w, h, {
    title: "x(t)",
    xLabel: "t [s]",
    yLabel: "x [cm]"
  });

  // Eje x = 0 (línea base)
  ctx.save();
  ctx.strokeStyle = "rgba(23, 32, 29, 0.6)";
  ctx.lineWidth = 1.4;
  const zeroY = (inner.top + inner.bottom) / 2;
  ctx.beginPath();
  ctx.moveTo(inner.left, zeroY);
  ctx.lineTo(inner.right, zeroY);
  ctx.stroke();
  ctx.restore();

  drawAxisTicks(
    ctx,
    inner,
    [tMin, tMax],
    [-yRangeCm, yRangeCm],
    "s",
    "cm",
    { xDigits: 1, yDigits: 1 }
  );

  const map = (d) => ({
    x: inner.left + ((d.t - tMin) / (tMax - tMin)) * (inner.right - inner.left),
    y: zeroY - (d.x * 100 / yRangeCm) * ((inner.bottom - inner.top) / 2)
  });

  // Envolvente A·e^(-ζω0 t) (sólo damped, también superpuesta en forced)
  if (state.mode === "damped" || state.mode === "forced") {
    const zeta = dampingRatio();
    const w0 = naturalOmega();
    const A0 = Math.max(state.amplitude, 0.005);
    const envelope = data.map((d) => ({
      t: d.t,
      x: A0 * Math.exp(-zeta * w0 * d.t)
    }));
    const envelopeNeg = envelope.map((d) => ({ t: d.t, x: -d.x }));
    plotSeries(ctx, inner, envelope, map, "#d97706", 1.7, true);
    plotSeries(ctx, inner, envelopeNeg, map, "#d97706", 1.7, true);
  }

  // Curva x(t)
  plotSeries(ctx, inner, data, map, "#168965", 2.6);
}

function drawPhaseGraph(ctx, w, h) {
  const data = state.history;
  const maxXm = Math.max(0.01, ...data.map((d) => Math.abs(d.x)), state.amplitude);
  const maxVm = Math.max(0.05, ...data.map((d) => Math.abs(d.v)));
  const xRange = autoRange(maxXm * 100);
  const yRange = autoRange(maxVm * 100);

  const inner = plotBox(ctx, w, h, {
    title: "ẋ vs x · diagrama de fase",
    xLabel: "x [cm]",
    yLabel: "ẋ [cm/s]"
  });
  // Ejes en cero
  ctx.save();
  ctx.strokeStyle = "rgba(23, 32, 29, 0.55)";
  ctx.lineWidth = 1.2;
  const cx = (inner.left + inner.right) / 2;
  const cy = (inner.top + inner.bottom) / 2;
  ctx.beginPath();
  ctx.moveTo(inner.left, cy);
  ctx.lineTo(inner.right, cy);
  ctx.moveTo(cx, inner.top);
  ctx.lineTo(cx, inner.bottom);
  ctx.stroke();
  ctx.restore();

  drawAxisTicks(
    ctx,
    inner,
    [-xRange, xRange],
    [-yRange, yRange],
    "cm",
    "cm/s",
    { xDigits: 1, yDigits: 1 }
  );

  const map = (d) => ({
    x: cx + (d.x * 100 / xRange) * ((inner.right - inner.left) / 2),
    y: cy - (d.v * 100 / yRange) * ((inner.bottom - inner.top) / 2)
  });
  plotSeries(ctx, inner, data, map, "#2563eb", 2.4);
}

function drawEnergyGraph(ctx, w, h) {
  const data = state.history;
  const tMin = data[0].t;
  const tMax = Math.max(tMin + 1, data[data.length - 1].t);
  const eMax = Math.max(
    0.001,
    ...data.map((d) => Math.max(d.kinetic, d.potential, d.total)),
    0.5 * state.k * state.amplitude ** 2
  );
  const yRange = autoRange(eMax);

  const inner = plotBox(ctx, w, h, {
    title: "Energías Ec, Ep y E_total",
    xLabel: "t [s]",
    yLabel: "E [J]"
  });
  drawAxisTicks(ctx, inner, [tMin, tMax], [0, yRange], "s", "J", { xDigits: 1, yDigits: 3 });

  const mapFor = (key) => (d) => ({
    x: inner.left + ((d.t - tMin) / (tMax - tMin)) * (inner.right - inner.left),
    y: inner.bottom - (d[key] / yRange) * (inner.bottom - inner.top)
  });
  plotSeries(ctx, inner, data, mapFor("kinetic"), "#2563eb", 2);
  plotSeries(ctx, inner, data, mapFor("potential"), "#168965", 2);
  plotSeries(ctx, inner, data, mapFor("total"), "#d97706", 2.7);
}

/* Curva A(ω) vs f [Hz] con el pico de resonancia marcado. */
function drawResponseGraph(ctx, w, h) {
  const f0 = naturalFrequency();
  const fMin = Math.max(0.05, 0.05 * f0);
  const fMax = Math.max(2.0, f0 * 2.5);
  const samples = 220;
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const f = fMin + (fMax - fMin) * (i / samples);
    const omega = 2 * Math.PI * f;
    const A = steadyAmplitude(omega) * 100; // cm
    points.push({ f, A });
  }
  const maxA = Math.max(0.01, ...points.map((p) => p.A));
  const yRange = autoRange(maxA);

  const inner = plotBox(ctx, w, h, {
    title: "A(f) · amplitud estacionaria del régimen forzado",
    xLabel: "f [Hz]",
    yLabel: "A [cm]"
  });
  drawAxisTicks(
    ctx,
    inner,
    [fMin, fMax],
    [0, yRange],
    "Hz",
    "cm",
    { xDigits: 2, yDigits: 1 }
  );

  const map = (p) => ({
    x: inner.left + ((p.f - fMin) / (fMax - fMin)) * (inner.right - inner.left),
    y: inner.bottom - (p.A / yRange) * (inner.bottom - inner.top)
  });
  plotSeries(ctx, inner, points, map, "#2563eb", 2.6);

  // Marcar f₀ (línea punteada vertical)
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(22, 137, 101, 0.7)";
  ctx.lineWidth = 1.5;
  const f0X = inner.left + ((f0 - fMin) / (fMax - fMin)) * (inner.right - inner.left);
  ctx.beginPath();
  ctx.moveTo(f0X, inner.top);
  ctx.lineTo(f0X, inner.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#168965";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`f₀ = ${fmt(f0, 2)} Hz`, f0X + 4, inner.top + 12);

  // Marcar f_res (pico de resonancia)
  const omegaRes = resonanceOmega();
  if (omegaRes !== null) {
    const fRes = omegaRes / (2 * Math.PI);
    if (fRes > fMin && fRes < fMax) {
      const fResX = inner.left + ((fRes - fMin) / (fMax - fMin)) * (inner.right - inner.left);
      const Apeak = steadyAmplitude(omegaRes) * 100;
      const peakY = inner.bottom - (Apeak / yRange) * (inner.bottom - inner.top);
      ctx.fillStyle = "#dc2626";
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fResX, peakY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillText(
        `f_res = ${fmt(fRes, 2)} Hz · A = ${fmt(Apeak, 1)} cm`,
        fResX + 8,
        peakY - 6
      );
    }
  } else {
    ctx.fillStyle = "#5d6d68";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("Sin pico (ζ ≥ 1/√2)", inner.left + 12, inner.top + 32);
  }

  // Marcar la frecuencia actual del motor
  const fDrive = state.driveFrequency;
  if (fDrive > fMin && fDrive < fMax) {
    const fDriveX = inner.left + ((fDrive - fMin) / (fMax - fMin)) * (inner.right - inner.left);
    ctx.strokeStyle = "rgba(217, 119, 6, 0.85)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(fDriveX, inner.top);
    ctx.lineTo(fDriveX, inner.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#d97706";
    ctx.fillText(`f motor = ${fmt(fDrive, 2)} Hz`, fDriveX + 4, inner.bottom - 6);
  }

  ctx.restore();
}

/* ---------- Resonancia teórica (panel teoría) ---------- */

function drawResonanceStatic() {
  if (!resonanceCanvas || !resonanceCtx) return;
  const { width: w, height: h } = fitCanvas(resonanceCanvas, resonanceCtx);
  const ctx = resonanceCtx;
  const left = 58;
  const right = w - 24;
  const top = 28;
  const bottom = h - 52;
  const zetas = [
    { value: 0.1, color: "#2563eb" },
    { value: 0.3, color: "#16a34a" },
    { value: 0.7, color: "#d97706" },
    { value: 1.0, color: "#dc2626" }
  ];
  const samples = 260;
  const curves = zetas.map((zeta) => {
    const points = [];
    for (let i = 0; i <= samples; i += 1) {
      const ratio = 0.05 + (2.8 * i) / samples;
      const amplitude = 1 / Math.sqrt((1 - ratio * ratio) ** 2 + (2 * zeta.value * ratio) ** 2);
      points.push({ ratio, amplitude: Math.min(amplitude, 5.5) });
    }
    return { ...zeta, points };
  });
  const yMax = 5.5;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
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

  // Línea ω/ω₀ = 1
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

  // Etiquetas
  ctx.fillStyle = "#0f172a";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("A(ω) · amplitud normalizada", left, 20);
  ctx.textAlign = "center";
  ctx.fillText("ω / ω₀", (left + right) / 2, h - 14);
  ctx.save();
  ctx.translate(16, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("A / (F₀/k)", 0, 0);
  ctx.restore();

  // Ticks
  ctx.fillStyle = "#5d6d68";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 7; i += 1) {
    const ratio = 0.05 + (2.8 * i) / 7;
    const x = left + ((right - left) * i) / 7;
    ctx.fillText(fmt(ratio, 1), x, bottom + 16);
  }

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

/* ---------- Export CSV ---------- */

function exportCsv() {
  const rows = [
    ["t_s", "x_m", "v_m_s", "a_m_s2", "Ec_J", "Ep_J", "E_total_J"],
    ...state.history.map((d) => [d.t, d.x, d.v, d.a, d.kinetic, d.potential, d.total])
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

/* ---------- Presets ---------- */

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
    // Usar la frecuencia angular natural como punto de partida del motor.
    els.driveInput.value = fmt(Math.sqrt(18 / 0.25) / (2 * Math.PI), 2);
    els.amplitudeInput.value = "6";
  }
  syncStateFromInputs(false);
  resetSimulation(true);
  document.querySelector("#simulador").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Sincronización de estado desde inputs ---------- */

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
  state.showForces = els.showForces ? els.showForces.checked : true;
  state.showVelocity = els.showVelocity.checked;
  state.showAcceleration = els.showAcceleration.checked;
  state.showEquilibrium = els.showEquilibrium.checked;
  state.showTrace = els.showTrace.checked;
  clampSafeAmplitude();
  // Reflejar el clamp en el control de amplitud si fue necesario.
  if (state.amplitudeClamped) {
    els.amplitudeInput.value = String(Math.round(state.amplitude * 100));
  }
  if (resetAmplitude) resetSimulation(true);
  updateControls();
  updateReadouts();
  draw();
}

/* ---------- Eventos ---------- */

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
    // Calcular f_res = ω_res / (2π) con ω_res = ω₀√(1−2ζ²) para ζ<1/√2.
    const omegaRes = resonanceOmega();
    const target = omegaRes !== null ? omegaRes / (2 * Math.PI) : naturalFrequency();
    state.driveFrequency = clamp(target, 0.1, 4);
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
  [els.showForces, els.showVelocity, els.showAcceleration, els.showEquilibrium, els.showTrace]
    .filter(Boolean)
    .forEach((input) => {
      input.addEventListener("change", () => syncStateFromInputs(false));
    });

  // ResizeObserver para mantener proporciones del canvas en cualquier pantalla.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      draw();
      drawResonanceStatic();
    });
    ro.observe(els.simulationCanvas);
    ro.observe(els.graphCanvas);
    if (resonanceCanvas) ro.observe(resonanceCanvas);
  }

  window.addEventListener("resize", () => {
    draw();
    drawResonanceStatic();
  });
}

/* ---------- KaTeX ---------- */

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

/* ---------- Init ---------- */

function init() {
  bindEvents();
  if (window.lucide) window.lucide.createIcons();
  renderMath();
  setMode("free");
  setGraphMode("time");
  clampSafeAmplitude();
  resetSimulation(true);
  drawResonanceStatic();
  requestAnimationFrame(animationLoop);
}

window.addEventListener("load", init);
