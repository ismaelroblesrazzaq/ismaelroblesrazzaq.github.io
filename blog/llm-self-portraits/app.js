/* Canvas Arena blog — synchronized process players + charts. */

const MAX_TURN = 200;
const FPS = 8;
const DURATION = (MAX_TURN + 1) / FPS; // every video is resampled to 201 frames

// Reveal order for the guessing game, per the post.
const GUESS_ORDER = ["kimik3", "sol", "qwen38", "fable5"];
const GALLERY_ORDER = [
  "gpt5", "gpt54", "luna", "terra", "sol",
  "haiku45", "opus5", "fable5", "kimik3", "qwen38",
];
const SOTA_ORDER = ["gpt5", "gpt54", "sol"];

const fmtUsd = (n) => (n == null ? "n/a" : "$" + n.toFixed(2));
const fmtTok = (n) =>
  n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n);

let DATA = {};

/* Runs where caching was off for all or part of the run carry an asterisk,
   because their cost is inflated relative to everything else. */
const labelFor = (d) => d.name + (d.costAsterisk ? "*" : "");
const asteriskFootnote = () =>
  `<p class="footnote-note">* caching was not enabled for all or part of this run, so its cost is inflated.</p>`;

/* ------------------------------------------------------------------ *
 * Synced player
 *
 * Every video was resampled onto the same 0..200 turn axis, so turn N is
 * the same moment in all of them and syncing is just a shared clock.
 * ------------------------------------------------------------------ */
// Every video shares one 0..200 encoding, so these convert freely. A player may
// still cap its own slider below 200 when none of its runs go that far.
function turnToTime(turn) {
  return Math.min(DURATION - 0.001, (turn / MAX_TURN) * DURATION);
}
function timeToTurn(t) {
  return Math.max(0, Math.min(MAX_TURN, Math.round((t / DURATION) * MAX_TURN)));
}

/**
 * One synced player over a set of videos.
 *
 * `maxTurn` is the end of this player's scale. The guessing grid caps at the
 * longest of its four runs rather than 200, so the slider isn't mostly dead air.
 */
function makePlayer({ root, videoSel, maxTurn }) {
  const btn = root.querySelector("[data-play]");
  const scrub = root.querySelector("[data-scrub]");
  const readout = root.querySelector("[data-readout]");
  const videos = () => Array.from(document.querySelectorAll(videoSel));

  let playing = true;
  let scrubbing = false;
  // Default playback is half speed; the slider adjusts it live.
  const speedInput = root.querySelector("[data-speed]");
  const speedOut = root.querySelector("[data-speedout]");
  let speed = speedInput ? Number(speedInput.value) : 0.5;
  // Seeks are silently dropped while a video is still buffering, so the last
  // requested turn is re-applied every frame until it takes.
  let targetTurn = 0;

  scrub.max = String(maxTurn);
  const endTime = turnToTime(maxTurn);

  function setTurn(turn, { fromUser = false } = {}) {
    // Only record the intent here. The actual seeking happens once per frame in
    // tick(): `input` fires continuously while dragging, and seeking ten videos
    // on every one of those events stalls the main thread badly enough that the
    // slider thumb never moves.
    //
    // This always tracks the current turn, including during playback, so that
    // pausing holds position instead of snapping back to a stale target.
    targetTurn = turn;
    // Never fight the user's cursor by writing back to the control they're holding.
    if (!fromUser) scrub.value = String(turn);
    readout.textContent = `turn ${turn} / ${maxTurn}`;
    for (const el of root.parentElement.querySelectorAll("[data-lastturn]")) {
      el.classList.toggle("done", turn >= Number(el.dataset.lastturn));
    }
  }

  function play() {
    const vs = videos();
    // Pressing play at the end restarts from the beginning. The seek has to
    // happen here rather than via targetTurn: tick() only enforces targetTurn
    // while paused, so once playing resumes it would read the old position off
    // the master and immediately stop again.
    if (vs.length && timeToTurn(vs[0].currentTime) >= maxTurn) {
      targetTurn = 0;
      for (const v of vs) v.currentTime = 0;
      setTurn(0);
    }
    playing = true;
    btn.textContent = "Pause";
    for (const v of vs) {
      v.playbackRate = speed;
      v.play().catch(() => {});
    }
  }
  function pause() {
    playing = false;
    btn.textContent = "Play";
    for (const v of videos()) v.pause();
  }

  function tick() {
    const vs = videos();
    if (vs.length) {
      if (playing && !scrubbing) {
        const master = vs[0];
        for (const v of vs.slice(1)) {
          if (Math.abs(v.currentTime - master.currentTime) > 0.15) v.currentTime = master.currentTime;
        }
        setTurn(timeToTurn(master.currentTime));
        // Stop at this player's own end, holding the final image.
        if (master.ended || master.currentTime >= endTime - 0.02) {
          pause();
          setTurn(maxTurn);
        }
      } else {
        // Paused or dragging: apply the requested turn at most once per frame,
        // and only to videos that are actually off it. This also re-asserts a
        // seek that a still-buffering video quietly dropped.
        const t = turnToTime(targetTurn);
        for (const v of vs) {
          if (v.readyState >= 1 && Math.abs(v.currentTime - t) > 0.05) v.currentTime = t;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  for (const v of videos()) {
    // Offscreen media is deprioritised, so catch each video up once it has
    // metadata rather than assuming the initial seek landed.
    v.addEventListener("loadedmetadata", () => {
      const t = turnToTime(targetTurn);
      if (Math.abs(v.currentTime - t) > 0.05) v.currentTime = t;
      v.playbackRate = speed;
      if (playing) v.play().catch(() => {});
    });
    v.playbackRate = speed;
    v.load();
  }

  btn.addEventListener("click", () => (playing ? pause() : play()));

  // The slider is authoritative. Touching it always takes control: it pauses
  // and pins the turn, rather than depending on pointer events firing in the
  // right order (they don't for keyboard, track clicks, or some trackpads,
  // which is how the playhead used to snap back out from under the cursor).
  const grab = () => {
    scrubbing = true;
    if (playing) pause();
  };
  const release = () => (scrubbing = false);
  scrub.addEventListener("pointerdown", grab);
  scrub.addEventListener("keydown", grab);
  scrub.addEventListener("pointerup", release);
  scrub.addEventListener("pointercancel", release);
  scrub.addEventListener("keyup", release);
  scrub.addEventListener("input", () => {
    grab();
    setTurn(Number(scrub.value), { fromUser: true });
  });
  scrub.addEventListener("change", () => {
    release();
    setTurn(Number(scrub.value), { fromUser: true });
  });

  speedInput?.addEventListener("input", () => {
    speed = Number(speedInput.value);
    if (speedOut) speedOut.textContent = `${speed}\u00d7`;
    for (const v of videos()) v.playbackRate = speed;
  });

  setTurn(0);
  play();
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */
function videoTag(slug, lastTurn, group) {
  return `<video data-sync="${group}" data-lastturn="${lastTurn}" muted playsinline preload="auto"
    poster="media/${slug}/final.png"><source src="media/${slug}/creation.mp4" type="video/mp4"></video>`;
}

function renderGuess() {
  const el = document.getElementById("guessGrid");
  el.innerHTML = GUESS_ORDER.map((slug) => {
    const d = DATA[slug];
    return `<div class="guess-item">
      <div class="tile" data-lastturn="${d.lastTurn}">
        ${videoTag(slug, d.lastTurn, "guess")}
      </div>
      <div class="reveal-name">${d.name}</div>
    </div>`;
  }).join("");
}

/* All ten processes as one 5x2 wall, so they can be compared at a glance while
   the shared clock runs. Details sit under each tile. */
function renderGallery() {
  const el = document.getElementById("gallery");
  el.innerHTML =
    `<div class="grid wall">` +
    GALLERY_ORDER.map((slug) => {
      const d = DATA[slug];
      const rating =
        d.rating == null
          ? `<span class="rating pending">rating —</span>`
          : `<span class="rating">${d.rating}/10</span>`;
      const stmt = d.statement
        ? `<button class="desc-toggle" type="button" data-desc>Description</button>
           <div class="statement" hidden>${d.statement
             .split(/\n\s*\n/)
             .map((p) => `<p>${escapeHtml(p)}</p>`)
             .join("")}</div>`
        : "";
      const note = d.note ? `<p class="tile-note ai-text">${escapeHtml(d.note)}</p>` : "";
      return `<section class="tile model-tile" data-lastturn="${d.lastTurn}">
        ${videoTag(slug, d.lastTurn, "main")}
        <div class="label">
          <span class="name">${labelFor(d)}</span>
          <span class="sub">${d.steps} turns · ${d.frames} frames · ${fmtUsd(d.cost)} · ${rating}</span>
          <span class="sub"><a href="transcripts/${slug}.html">full transcript</a></span>
          ${note}
          ${stmt}
        </div>
      </section>`;
    }).join("") +
    `</div>`;
}

function renderSota() {
  const el = document.getElementById("sotaGrid");
  el.innerHTML = SOTA_ORDER.map((slug) => {
    const d = DATA[slug];
    return `<div class="tile">
      <img src="media/${slug}/final.png" alt="${d.name} final self-portrait">
      <div class="label"><span class="name">${d.name}</span><br>
      <span class="sub">${d.steps} turns · ${fmtUsd(d.cost)}</span></div>
    </div>`;
  }).join("");
}

/* Stacked horizontal bars: cost split by how the tokens were billed.
   Horizontal because the category labels are model names (long, and there
   are ten of them), sorted descending so the ranking is the first read. */
function renderCost() {
  const parts = [
    ["input", "Fresh input", "var(--c-input)"],
    ["cacheRead", "Cached input", "var(--c-cached)"],
    ["cacheWrite", "Cache write", "var(--c-write)"],
    ["output", "Output", "var(--c-output)"],
  ];
  const rows = GALLERY_ORDER.map((s) => ({ slug: s, ...DATA[s] }))
    .filter((d) => d.cost != null)
    .sort((a, b) => b.cost - a.cost);
  const max = Math.max(...rows.map((r) => r.cost));

  const legend = `<div class="legend">${parts
    .map(([, label, col]) => `<span><i class="swatch" style="background:${col}"></i>${label}</span>`)
    .join("")}</div>`;

  const bars = rows
    .map((r) => {
      const segs = parts
        .map(([k, label, col]) => {
          const v = r.costBreakdown[k] || 0;
          if (v <= 0) return "";
          return `<i style="width:${(v / r.cost) * 100}%;background:${col}"
                     title="${r.name} — ${label}: $${v.toFixed(4)}"></i>`;
        })
        .join("");
      return `<div class="bl">${labelFor(r)}</div>
        <div class="bar" style="width:${(r.cost / max) * 100}%">${segs}</div>
        <div class="bv">${fmtUsd(r.cost)}</div>`;
    })
    .join("");

  document.getElementById("costChart").innerHTML =
    `<div class="chart-title">Cost per run</div>
     <div class="chart-sub">USD for one self-portrait, split by how the tokens were billed. Hover a segment for its exact value.</div>
     ${legend}<div class="bars">${bars}</div>`;

  const tbl = rows
    .map(
      (r) => `<tr><td>${labelFor(r)}</td><td class="num">${r.steps}</td>
      <td class="num">${fmtTok(r.tokens.input)}</td>
      <td class="num">${r.tokens.cacheHitRate == null ? "—" : (r.tokens.cacheHitRate * 100).toFixed(0) + "%"}</td>
      <td class="num">${fmtTok(r.tokens.output)}</td>
      <td class="num">${fmtTok(r.tokens.reasoning)}</td>
      <td class="num">${fmtUsd(r.cost)}</td></tr>`
    )
    .join("");
  document.getElementById("costTable").innerHTML =
    `<table class="data"><thead><tr><th>Model</th><th class="num">Turns</th>
     <th class="num">Input</th><th class="num">Cached</th><th class="num">Output</th>
     <th class="num">Reasoning</th><th class="num">Cost</th></tr></thead><tbody>${tbl}</tbody></table>
     ${asteriskFootnote()}`;
}

/* Cost vs. rating, with the Pareto frontier traced through the runs nothing
   cheaper beats. Cost is on a log axis: it spans $0.13 to $24.75, and on a
   linear scale seven of the ten points collapse into the left fifth. */
function renderPareto() {
  const el = document.getElementById("paretoChart");
  const rated = GALLERY_ORDER.map((s) => DATA[s]).filter((d) => d.rating != null && d.cost != null);
  if (rated.length === 0) {
    el.innerHTML = `<div class="note">then insert a grpah of the pareto frontier - cost vs perf.
      <br><br><strong>Waiting on ratings.</strong> Add a <code>"rating"</code> (0–10) for each model in
      <code>data.json</code> and this chart draws itself.</div>`;
    return;
  }

  const W = 700, H = 380, L = 52, R = 24, T = 24, B = 52;
  const lo = Math.log10(Math.min(...rated.map((d) => d.cost)) * 0.7);
  const hi = Math.log10(Math.max(...rated.map((d) => d.cost)) * 1.5);
  const x = (c) => L + ((Math.log10(c) - lo) / (hi - lo)) * (W - L - R);
  const y = (r) => H - B - (r / 10) * (H - T - B);

  // A run is on the frontier if nothing cheaper scored at least as well.
  const byCost = [...rated].sort((a, b) => a.cost - b.cost);
  const frontier = byCost.filter((d, i) => byCost.slice(0, i).every((p) => p.rating < d.rating));

  const ticks = [0.1, 0.3, 1, 3, 10, 30].filter((t) => Math.log10(t) >= lo && Math.log10(t) <= hi);
  const grid =
    ticks
      .map(
        (t) => `<line x1="${x(t)}" y1="${T}" x2="${x(t)}" y2="${H - B}" stroke="#eae4d8" stroke-width="1"/>
        <text x="${x(t)}" y="${H - B + 18}" font-size="11" fill="#64635f" text-anchor="middle">$${t < 1 ? t : t.toFixed(0)}</text>`
      )
      .join("") +
    [0, 2, 4, 6, 8, 10]
      .map(
        (r) => `<line x1="${L}" y1="${y(r)}" x2="${W - R}" y2="${y(r)}" stroke="#eae4d8" stroke-width="1"/>
        <text x="${L - 10}" y="${y(r) + 4}" font-size="11" fill="#64635f" text-anchor="end">${r}</text>`
      )
      .join("");

  // Place each label above its point, flipping below when it would collide.
  const placed = [];
  const labels = rated
    .map((d) => {
      const px = x(d.cost);
      const py = y(d.rating);
      const clash = placed.some((p) => Math.abs(p.x - px) < 62 && Math.abs(p.y - py) < 16);
      const dy = clash ? 20 : -13;
      placed.push({ x: px, y: py + dy });
      return `<text x="${px}" y="${py + dy}" font-size="11" fill="#3d3a34" text-anchor="middle">${labelFor(d)}</text>`;
    })
    .join("");

  el.innerHTML = `<div class="chart-title">Cost vs. rating</div>
    <div class="chart-sub">Each run: what it cost against my score out of 10. Cost is on a log scale.
      The dashed line is the Pareto frontier — the runs nothing cheaper beats.</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
         aria-label="Cost versus rating for ten runs, with a Pareto frontier">
      ${grid}
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#d8d1c4" stroke-width="2"/>
      <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#d8d1c4" stroke-width="2"/>
      <polyline fill="none" stroke="#1565a8" stroke-width="2" stroke-dasharray="5 4"
        points="${frontier.map((d) => `${x(d.cost)},${y(d.rating)}`).join(" ")}"/>
      ${rated
        .map((d) => {
          const on = frontier.includes(d);
          return `<circle cx="${x(d.cost)}" cy="${y(d.rating)}" r="${on ? 7 : 5.5}"
            fill="${on ? "#1565a8" : "#a12a5c"}" stroke="#f5f1e8" stroke-width="2">
            <title>${d.name} — $${d.cost.toFixed(2)}, rated ${d.rating}/10${
              d.costAsterisk ? " (caching off for all or part of the run)" : ""
            }</title></circle>`;
        })
        .join("")}
      ${labels}
      <text x="${(W + L) / 2}" y="${H - 12}" font-size="12" fill="#64635f" text-anchor="middle">cost, USD (log)</text>
      <text x="14" y="${(H - B + T) / 2}" font-size="12" fill="#64635f" text-anchor="middle"
        transform="rotate(-90 14 ${(H - B + T) / 2})">rating / 10</text>
    </svg>
    <div class="legend" style="margin-top:10px">
      <span><i class="swatch" style="background:#1565a8"></i>on the frontier</span>
      <span><i class="swatch" style="background:#a12a5c"></i>dominated</span>
    </div>
    ${asteriskFootnote()}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

fetch("data.json")
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    renderGuess();
    renderGallery();
    renderSota();
    renderCost();
    renderPareto();

    // The guessing grid stops at the longest of its own four runs; the gallery
    // uses the full 200-turn budget every model was given.
    const guessMax = Math.max(...GUESS_ORDER.map((s) => DATA[s].lastTurn));
    makePlayer({
      root: document.getElementById("guessPlayer"),
      videoSel: 'video[data-sync="guess"]',
      maxTurn: guessMax,
    });
    makePlayer({
      root: document.getElementById("player"),
      videoSel: 'video[data-sync="main"]',
      maxTurn: MAX_TURN,
    });
  });


/* Per-tile description toggle. The model's own write-up is long, so it stays
   collapsed until asked for and the same button closes it again. */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-desc]");
  if (!btn) return;
  const panel = btn.nextElementSibling;
  const open = panel.hasAttribute("hidden");
  panel.toggleAttribute("hidden", !open);
  btn.textContent = open ? "Hide description" : "Description";
  btn.classList.toggle("open", open);
});

/* Reveal the model behind each of the four unlabelled drawings. */
document.getElementById("revealBtn")?.addEventListener("click", (e) => {
  const on = document.getElementById("guessGrid").classList.toggle("revealed");
  e.target.textContent = on ? "Hide" : "Reveal";
});
