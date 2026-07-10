const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTH_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const fmtPct = (v, digits = 2) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function main() {
  const [records, meta] = await Promise.all([
    fetch("data/tufe.json").then((r) => r.json()),
    fetch("data/meta.json").then((r) => r.json()).catch(() => null),
  ]);

  records.sort((a, b) => a.year - b.year || a.month - b.month);
  renderMeta(meta);
  renderTiles(records);
  renderMonthlyChart(records);
  renderYoyChart(records);
  renderYtdChart(records);
  renderHalfYearTable(records);
  renderFullTable(records);
}

function renderMeta(meta) {
  const el = document.getElementById("meta-line");
  if (!meta) { el.textContent = ""; return; }
  const checked = new Date(meta.lastChecked);
  el.innerHTML = `Son kontrol: ${checked.toLocaleString("tr-TR")} · Son bülten: ` +
    `<a href="${meta.latestNewsUrl}" target="_blank" rel="noopener">${meta.latestHeadline}</a>`;
}

function latestComplete(records, field) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i][field] !== null && records[i][field] !== undefined) return records[i];
  }
  return null;
}

function renderTiles(records) {
  const monthly = latestComplete(records, "aylikYuzde");
  const yoy = latestComplete(records, "yillikYuzde");
  const ytd = latestComplete(records, "yilBasindanYuzde");

  const tiles = [
    { label: `Aylık değişim (${MONTH_LONG[monthly.month - 1]} ${monthly.year})`, value: monthly.aylikYuzde },
    { label: `Yıllık enflasyon (${MONTH_LONG[yoy.month - 1]} ${yoy.year})`, value: yoy.yillikYuzde },
    { label: `Yıl başından bu yana (${MONTH_LONG[ytd.month - 1]} ${ytd.year})`, value: ytd.yilBasindanYuzde },
  ];

  const half = computeHalfYear(records).filter((h) => h.h1 !== null || h.h2 !== null).at(-1);
  if (half) {
    const latestHalfVal = half.h2 !== null ? half.h2 : half.h1;
    const latestHalfLabel = half.h2 !== null ? `Temmuz–Aralık ${half.year}` : `Ocak–Haziran ${half.year}`;
    tiles.push({ label: `Son 6 aylık dönem (${latestHalfLabel})`, value: latestHalfVal });
  }

  const wrap = document.getElementById("tiles");
  wrap.innerHTML = "";
  for (const t of tiles) {
    const div = document.createElement("div");
    div.className = "tile";
    const cls = t.value > 0 ? "critical" : t.value < 0 ? "good" : "";
    div.innerHTML = `<div class="label">${t.label}</div><div class="value ${cls}">${fmtPct(t.value)}</div>`;
    wrap.appendChild(div);
  }
}

// ---- generic SVG line chart with hover tooltip ----
function buildLineChart(svg, tooltip, points, opts) {
  const { valueFmt = (v) => fmtPct(v), labelFmt = (p) => p.label } = opts;
  svg.innerHTML = "";
  const rect = svg.getBoundingClientRect();
  const W = rect.width || 600;
  const H = 260;
  const padL = 44, padR = 12, padT = 14, padB = 26;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const vals = points.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return;
  let min = Math.min(0, ...vals);
  let max = Math.max(0, ...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;

  const svgNS = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(svgNS, "g");

  // gridlines: 4 horizontal steps
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = min + ((max - min) * s) / steps;
    const yy = y(v);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", padL); line.setAttribute("x2", W - padR);
    line.setAttribute("y1", yy); line.setAttribute("y2", yy);
    line.setAttribute("class", "gridline");
    g.appendChild(line);
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", padL - 8); label.setAttribute("y", yy + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "tick-label");
    label.textContent = `${v.toFixed(0)}%`;
    g.appendChild(label);
  }

  // baseline at 0
  const base = document.createElementNS(svgNS, "line");
  base.setAttribute("x1", padL); base.setAttribute("x2", W - padR);
  base.setAttribute("y1", y(0)); base.setAttribute("y2", y(0));
  base.setAttribute("class", "baseline");
  g.appendChild(base);

  // x labels: show ~6 evenly spaced
  const xTickCount = Math.min(points.length, 6);
  for (let t = 0; t < xTickCount; t++) {
    const idx = Math.round((t / Math.max(1, xTickCount - 1)) * (points.length - 1));
    const p = points[idx];
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x(idx)); label.setAttribute("y", H - 6);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "tick-label");
    label.textContent = p.xLabel;
    g.appendChild(label);
  }

  // line path (skip nulls with gaps)
  let d = "";
  let drawing = false;
  points.forEach((p, i) => {
    if (p.value === null || p.value === undefined) { drawing = false; return; }
    d += `${drawing ? "L" : "M"} ${x(i)} ${y(p.value)} `;
    drawing = true;
  });
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", d.trim());
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", css("--series-1"));
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  g.appendChild(path);

  // end marker
  const lastIdx = [...points].map((p, i) => ({ p, i })).reverse().find((o) => o.p.value !== null && o.p.value !== undefined);
  if (lastIdx) {
    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", x(lastIdx.i)); dot.setAttribute("cy", y(lastIdx.p.value));
    dot.setAttribute("r", 4.5);
    dot.setAttribute("fill", css("--series-1"));
    dot.setAttribute("stroke", css("--surface-1"));
    dot.setAttribute("stroke-width", "2");
    g.appendChild(dot);
  }

  // hover layer
  const hoverLine = document.createElementNS(svgNS, "line");
  hoverLine.setAttribute("y1", padT); hoverLine.setAttribute("y2", H - padB);
  hoverLine.setAttribute("class", "gridline");
  hoverLine.setAttribute("stroke-width", "1");
  hoverLine.style.display = "none";
  g.appendChild(hoverLine);

  const hoverDot = document.createElementNS(svgNS, "circle");
  hoverDot.setAttribute("r", 5);
  hoverDot.setAttribute("fill", css("--series-1"));
  hoverDot.setAttribute("stroke", css("--surface-1"));
  hoverDot.setAttribute("stroke-width", "2");
  hoverDot.style.display = "none";
  g.appendChild(hoverDot);

  const hitLayer = document.createElementNS(svgNS, "rect");
  hitLayer.setAttribute("x", padL); hitLayer.setAttribute("y", padT);
  hitLayer.setAttribute("width", innerW); hitLayer.setAttribute("height", innerH);
  hitLayer.setAttribute("fill", "transparent");
  g.appendChild(hitLayer);

  svg.appendChild(g);

  function onMove(evt) {
    const bbox = svg.getBoundingClientRect();
    const mx = evt.clientX - bbox.left;
    const scale = W / bbox.width;
    const px = mx * scale;
    let idx = Math.round(((px - padL) / innerW) * (points.length - 1));
    idx = Math.max(0, Math.min(points.length - 1, idx));
    const p = points[idx];
    if (p.value === null || p.value === undefined) return;
    hoverLine.setAttribute("x1", x(idx)); hoverLine.setAttribute("x2", x(idx));
    hoverLine.style.display = "";
    hoverDot.setAttribute("cx", x(idx)); hoverDot.setAttribute("cy", y(p.value));
    hoverDot.style.display = "";

    const ttX = (x(idx) / W) * bbox.width;
    const ttY = (y(p.value) / H) * bbox.height;
    tooltip.style.left = `${ttX}px`;
    tooltip.style.top = `${ttY - 10}px`;
    tooltip.style.opacity = "1";
    tooltip.innerHTML = `<div class="tt-date">${labelFmt(p)}</div><div class="tt-val">${valueFmt(p.value)}</div>`;
  }
  function onLeave() {
    hoverLine.style.display = "none";
    hoverDot.style.display = "none";
    tooltip.style.opacity = "0";
  }
  svg.addEventListener("mousemove", onMove);
  svg.addEventListener("mouseleave", onLeave);
  svg.addEventListener("touchmove", (e) => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });
  svg.addEventListener("touchend", onLeave);
}

function toPoints(records, field) {
  return records.map((r) => ({
    value: r[field],
    xLabel: `${MONTH_SHORT[r.month - 1]} ${String(r.year).slice(2)}`,
    label: `${MONTH_LONG[r.month - 1]} ${r.year}`,
  }));
}

function renderMonthlyChart(records) {
  const svg = document.getElementById("chart-monthly");
  const tooltip = document.getElementById("tooltip-monthly");
  const controls = document.querySelector('[data-range-for="monthly"]');

  function draw(range) {
    const data = range === "all" ? records : records.slice(-Number(range));
    buildLineChart(svg, tooltip, toPoints(data, "aylikYuzde"), {});
  }
  controls.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      controls.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      draw(btn.dataset.range);
    });
  });
  draw("all");
  window.addEventListener("resize", () => draw(controls.querySelector("button.active").dataset.range));
}

function renderYoyChart(records) {
  const svg = document.getElementById("chart-yoy");
  const tooltip = document.getElementById("tooltip-yoy");
  const controls = document.querySelector('[data-range-for="yoy"]');
  const withYoy = records.filter((r) => r.yillikYuzde !== null && r.yillikYuzde !== undefined);

  function draw(range) {
    const data = range === "all" ? withYoy : withYoy.slice(-Number(range));
    buildLineChart(svg, tooltip, toPoints(data, "yillikYuzde"), {});
  }
  controls.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      controls.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      draw(btn.dataset.range);
    });
  });
  draw("all");
  window.addEventListener("resize", () => draw(controls.querySelector("button.active").dataset.range));
}

function renderYtdChart(records) {
  const svg = document.getElementById("chart-ytd");
  const tooltip = document.getElementById("tooltip-ytd");
  const currentYear = records.at(-1).year;
  const data = records.filter((r) => r.year === currentYear);
  function draw() {
    buildLineChart(svg, tooltip, toPoints(data, "yilBasindanYuzde"), {});
  }
  draw();
  window.addEventListener("resize", draw);
}

function computeHalfYear(records) {
  const byYear = new Map();
  for (const r of records) {
    if (!byYear.has(r.year)) byYear.set(r.year, {});
    byYear.get(r.year)[r.month] = r;
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return years.map((year) => {
    const months = byYear.get(year);
    const h1 = months[6] ? months[6].yilBasindanYuzde : null;
    let h2 = null;
    const h2Months = [7, 8, 9, 10, 11, 12];
    if (h2Months.every((m) => months[m] && months[m].aylikYuzde !== null && months[m].aylikYuzde !== undefined)) {
      let factor = 1;
      for (const m of h2Months) factor *= 1 + months[m].aylikYuzde / 100;
      h2 = (factor - 1) * 100;
    }
    return { year, h1, h2 };
  });
}

function renderHalfYearTable(records) {
  const rows = computeHalfYear(records).filter((h) => h.h1 !== null || h.h2 !== null).slice(-12).reverse();
  const tbody = document.querySelector("#table-halfyear tbody");
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.year}</td>
      <td>${fmtPct(r.h1)}</td>
      <td>${fmtPct(r.h2)}</td>
    </tr>
  `).join("");
}

function renderFullTable(records) {
  const tbody = document.querySelector("#table-full tbody");
  const rows = [...records].reverse();
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${MONTH_LONG[r.month - 1]} ${r.year}</td>
      <td>${fmtPct(r.aylikYuzde)}</td>
      <td>${fmtPct(r.yilBasindanYuzde)}</td>
      <td>${fmtPct(r.yillikYuzde)}</td>
    </tr>
  `).join("");
}

main().catch((err) => {
  document.getElementById("meta-line").textContent = "Veri yüklenemedi: " + err.message;
  console.error(err);
});
