// recognizer.js
// Recognizes the signs you recorded with record.html (saved in gestures.json).
// It needs no changes to the design. It adds a small "Live translation" box on the camera page.
(function () {
  // ---------- Settings you can tune ----------
  const C = {
    WORD_MS: 2000,        // same as record.html
    LETTER_MS: 1500,      // same as record.html
    LETTER_LIVE_MS: 500,  // letters are held still, so only the last 0.5 s is compared
    FRAMES: 12,           // same as record.html
    WORD_SHIFT: 3,        // how much a word may be shifted in time and still match
    LETTER_SHIFT: 0,
    EVAL_MS: 150,         // how often we check the signs
    STABLE: 2,            // words: same answer this many checks in a row before we accept it
    STABLE_LETTER: 2,     // letters: same answer this many checks in a row
    FIRST_LETTER_GAP_MS: 300, // after "My name is", the hands must leave the view this long before the first letter is read
    LETTER_STILL: 0.3,    // letters are only checked while the hand is held still (smaller = stricter)
    LETTER_LIMIT_SCALE: 3,// letters are accepted even if fairly far from your recordings (bigger = more forgiving)
    LETTER_MARGIN: 0.92,  // letters: best match must beat the second best by a small margin
    POS_WEIGHT: 3,        // how much "where the hand is" matters
    THRESH_SCALE: 1.6,    // bigger = accepts more signs but makes more mistakes
    MARGIN: 0.85,         // best match must be clearly better than the second best
    HANDS_GONE_MS: 700,   // hands out of view this long allows the same sign again
    NAME_END_MS: 2500,    // hands out of view this long ends the spelled name
    MAX_LETTERS: 20,
    DEBUG: true           // shows the best guess under the box. Set to false before the expo.
  };
  const WORDS = ["Hi", "Hello", "Welcome", "Thank you", "Bye", "How are you", "I am fine", "My name is","sorry"];
  const DIM = 88;         // 2 hands x (21 points x 2 numbers + 2 position numbers)

  // ---------- Turn a frame of hands into numbers ----------
  // hands = list of flat arrays [x0,y0,...,x20,y20], left-most hand first
  function frameFeatures(hands) {
    const f = new Float32Array(DIM);
    for (let s = 0; s < 2 && s < hands.length; s++) {
      const h = hands[s];
      const wx = h[0], wy = h[1];
      const scale = Math.max(Math.hypot(h[18] - wx, h[19] - wy), 0.02); // wrist to middle finger base = hand size
      const o = s * 44;
      for (let j = 0; j < 21; j++) {
        f[o + j * 2] = (h[j * 2] - wx) / scale;
        f[o + j * 2 + 1] = (h[j * 2 + 1] - wy) / scale;
      }
      f[o + 42] = wx * C.POS_WEIGHT;
      f[o + 43] = wy * C.POS_WEIGHT;
    }
    return f;
  }

  function packHands(hands) {
    return hands.map(h => {
      const a = new Array(42);
      for (let j = 0; j < 21; j++) { a[j * 2] = h[j].x; a[j * 2 + 1] = h[j].y; }
      return a;
    }).sort((p, q) => p[0] - q[0]);
  }

  // ---------- Compare two recordings ----------
  function frameDistSq(a, b) {
    let s = 0;
    for (let i = 0; i < DIM; i++) { const d = a[i] - b[i]; s += d * d; }
    return s;
  }

  function seqDist(q, s, maxShift) {
    const n = q.length;
    let best = Infinity;
    for (let sh = -maxShift; sh <= maxShift; sh++) {
      const from = Math.max(0, -sh), to = Math.min(n, n - sh);
      const cnt = to - from;
      if (cnt < n - maxShift) continue;
      let sum = 0;
      for (let i = from; i < to; i++) sum += frameDistSq(q[i], s[i + sh]);
      const m = sum / cnt;
      if (m < best) best = m;
    }
    return Math.sqrt(best / DIM);
  }

  function kindOf(label) { return WORDS.includes(label) ? "word" : "letter"; }
  function shiftOf(kind) { return kind === "word" ? C.WORD_SHIFT : C.LETTER_SHIFT; }

  // ---------- The learned data ----------
  const db = { word: [], letter: [] };
  const limit = { word: 0.5, letter: 0.5 };
  let ready = false;
  let loadMessage = "";

  function groupByLabel(list) {
    const g = {};
    list.forEach(s => { (g[s.label] = g[s.label] || []).push(s); });
    return g;
  }

  // Works out how different two samples of the SAME sign normally are
  function calibrate() {
    ["word", "letter"].forEach(kind => {
      const shift = shiftOf(kind);
      const nn = [];
      Object.values(groupByLabel(db[kind])).forEach(list => {
        if (list.length < 2) return;
        list.forEach((a, i) => {
          let best = Infinity;
          list.forEach((b, j) => { if (i !== j) best = Math.min(best, seqDist(a.f, b.f, shift)); });
          nn.push(best);
        });
      });
      nn.sort((x, y) => x - y);
      const p90 = nn.length ? nn[Math.min(nn.length - 1, Math.floor(nn.length * 0.9))] : 0.3;
      limit[kind] = p90 * C.THRESH_SCALE;
    });
  }

  // Finds signs that look too much like another sign (so you can record them again)
  function lookAlikes() {
    const result = [];
    ["word", "letter"].forEach(kind => {
      const shift = shiftOf(kind);
      const groups = groupByLabel(db[kind]);
      Object.keys(groups).forEach(label => {
        const own = groups[label];
        if (own.length < 3) return;
        const others = db[kind].filter(s => s.label !== label);
        if (!others.length) return;
        let confused = 0;
        const rivals = {};
        own.slice(0, 5).forEach((a, i) => {
          let ownD = Infinity, otherD = Infinity, otherLabel = "";
          own.forEach((b, j) => { if (i !== j) ownD = Math.min(ownD, seqDist(a.f, b.f, shift)); });
          others.forEach(b => {
            const d = seqDist(a.f, b.f, shift);
            if (d < otherD) { otherD = d; otherLabel = b.label; }
          });
          if (otherD < ownD * 1.15) { confused++; rivals[otherLabel] = (rivals[otherLabel] || 0) + 1; }
        });
        if (confused >= 2) {
          const rival = Object.keys(rivals).sort((x, y) => rivals[y] - rivals[x])[0];
          result.push(label + " looks like " + rival);
        }
      });
    });
    return result;
  }

  async function loadData() {
    setStatus("Loading signs...");
    try {
      const res = await fetch("gestures.json?" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      (data.samples || []).forEach(s => {
        if (!Array.isArray(s.frames) || s.frames.length !== C.FRAMES) return;
        db[kindOf(s.label)].push({ label: s.label, f: s.frames.map(frameFeatures) });
      });
      const total = db.word.length + db.letter.length;
      if (!total) throw new Error("no samples");
      calibrate();
      const alike = lookAlikes();
      ready = true;
      loadMessage = "Ready: " + total + " samples." + (alike.length ? " Similar signs: " + alike.join("; ") + "." : "");
      console.log("[SignRecognizer] " + loadMessage, { limit: limit });
      setStatus(loadMessage);
    } catch (err) {
      console.error("[SignRecognizer] could not load gestures.json", err);
      setStatus("Could not load gestures.json. Put it in the sign-translator folder (next to index.html) and refresh.");
    }
  }

  // ---------- Live frames ----------
  let buf = [];               // recent frames: { t, f }
  let lastHandT = -Infinity;
  let lastEval = 0;
  let cand = { label: null, n: 0 };
  let lastCommit = null;
  let goneAfterCommit = true;

  function buildQuery(now, W) {
    const start = now - W;
    if (!buf.length || buf[0].t > start + W * 0.35) return null; // not enough history yet
    const q = [];
    for (let i = 0; i < C.FRAMES; i++) {
      const target = start + ((i + 0.5) / C.FRAMES) * W;
      let best = buf[0];
      for (const b of buf) {
        if (Math.abs(b.t - target) < Math.abs(best.t - target)) best = b;
        else if (b.t > target) break;
      }
      q.push(best.f);
    }
    return q;
  }

  function scoreKind(kind, q) {
    const best = {};
    const shift = shiftOf(kind);
    for (const s of db[kind]) {
      const d = seqDist(q, s.f, shift);
      if (best[s.label] === undefined || d < best[s.label]) best[s.label] = d;
    }
    return Object.keys(best).map(l => ({ label: l, d: best[l], kind: kind }));
  }

  function idleHint() {
    return nameMode
      ? (handsLeftSinceName ? "Spelling your name: show a letter and hold it about 1 second."
                            : "Lower your hands, then show the first letter.")
      : "Show a word sign. To spell your name, show 'My name is' first.";
  }

  function evaluate(now) {
    // While spelling a name only letters are compared. Otherwise only words are compared.
    const kind = nameMode ? "letter" : "word";
    if (!db[kind].length) return;
    const q = buildQuery(now, kind === "letter" ? C.LETTER_LIVE_MS : C.WORD_MS);
    if (!q) return;
    if (kind === "letter" && !handsLeftSinceName) {
      showDetect("Lower your hands, then show the first letter");
      return;
    }
    if (kind === "letter") {
      // Skip the check while the hand is still moving from one letter to the next
      const last = q[q.length - 1];
      let spread = 0;
      for (const f of q) spread = Math.max(spread, Math.sqrt(frameDistSq(f, last) / DIM));
      if (spread > C.LETTER_STILL) {
        cand = { label: null, n: 0 };
        if (C.DEBUG) setDebug("Spelling | hand is moving: hold the letter still (movement " + spread.toFixed(2) + ", must be under " + C.LETTER_STILL + ")");
        showDetect("Hold the letter still...");
        return;
      }
    }
    const cands = scoreKind(kind, q).sort((a, b) => a.d - b.d);
    const top = cands[0], second = cands[1];
    const lim = kind === "letter" ? limit.letter * C.LETTER_LIMIT_SCALE : limit.word;
    const margin = kind === "letter" ? C.LETTER_MARGIN : C.MARGIN;
    const need = kind === "letter" ? C.STABLE_LETTER : C.STABLE;
    const tooFar = top.d > lim;
    const accepted = !tooFar && (!second || top.d <= second.d * margin);

    if (C.DEBUG) {
      setDebug((nameMode ? "Spelling" : "Words") + " | best: " + top.label + "  distance " + top.d.toFixed(2) +
        "  limit " + lim.toFixed(2) + " | " +
        (accepted ? "accepted" : tooFar ? "rejected (too far from your recording)" : "rejected (too close to " + second.label + ")"));
    }
    if (!accepted) { cand = { label: null, n: 0 }; showDetect(""); return; }

    const pct = Math.max(0, Math.min(100, Math.round((1 - top.d / lim) * 100)));
    if (cand.label === top.label) cand.n++; else cand = { label: top.label, n: 1 };
    showDetect("Seeing: " + top.label + "  (" + pct + "% match)  hold " + Math.min(cand.n, need) + " of " + need);
    if (cand.n >= need) commit(top.label, pct);
  }

  // ---------- Building the sentence ----------
  let allConf = [];
  let handsLeftSinceName = false;
  let nameMode = false;
  let letters = "";

  function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  function finalizeName() {
    if (!nameMode) return;
    if (letters) tokens[tokens.length - 1] = "My name is " + titleCase(letters);
    nameMode = false;
    letters = "";
  }

  function sentence(inProgress) {
    const parts = tokens.map(t => (t === "How are you" ? "How are you?" : t));
    if (inProgress && nameMode) {
      parts[parts.length - 1] = "My name is " + (letters ? letters.split("").join(" ") + " ..." : "...");
    }
    return parts.join(" ").replace("I am fine Thank you", "I am fine, thank you");
  }

    function commit(label, pct) {
    allConf.push(pct);
    if (label === lastCommit && !goneAfterCommit) return; // same sign again needs hands to leave the view first
    if (kindOf(label) === "letter") {
      if (!nameMode) return;                               // letters are only used after "My name is"
      if (letters.length < C.MAX_LETTERS) letters += label;
    } else {
      finalizeName();
      tokens.push(label);
      if (label === "My name is") { nameMode = true; letters = ""; handsLeftSinceName = false; }
    }
    lastCommit = label;
    goneAfterCommit = false;
    cand = { label: null, n: 0 };
    if (kindOf(label) !== "letter") buf.length = 0;   // keep frames after a letter so the next letter is noticed quickly
    paint();
    showDetect("Added: " + label);
  }

  function reset() {
    tokens = []; nameMode = false; letters = ""; allConf = [];
    buf.length = 0; cand = { label: null, n: 0 };
    lastCommit = null; goneAfterCommit = true;
    paint(); showDetect("");
  }

  // ---------- Small box on the camera page ----------
  let elText = null, elDetect = null, elStatus = null, elDebug = null;

  function buildUI() {
    const style = document.createElement("style");
    style.textContent =
      ".live-output{background:#eceefe;border-radius:14px;padding:14px 16px;margin:0 0 16px;}" +
      ".live-title{font-size:.8rem;color:#6b7280;margin-bottom:6px;}" +
      ".live-text{font-size:1.5rem;font-weight:700;min-height:2em;word-break:break-word;color:#1e1b4b;}" +
      ".live-text.empty{color:#9ca3af;font-weight:500;font-size:1rem;}" +
      ".live-detect{font-size:.85rem;color:#4f46e5;min-height:1.2em;margin-top:4px;}" +
            ".live-status{font-size:.75rem;color:#6b7280;margin-top:6px;line-height:1.4;}" +
      ".live-clear{margin-top:10px;border:none;border-radius:10px;padding:8px 16px;font-weight:600;cursor:pointer;background:#e6e8fb;color:#4f46e5;font-size:.9rem;}" +
      ".live-clear:hover{background:#d9dcf7;}";
    document.head.appendChild(style);

    const btn = document.getElementById("captureBtn");
    if (!btn) return;
    const box = document.createElement("div");
    box.className = "live-output";
    box.innerHTML = '<div class="live-title">Live translation</div>' +
      '<div class="live-text empty">Show a sign to the camera</div>' +
      '<div class="live-detect"></div><div class="live-status"></div><div class="live-status"></div>';
    btn.parentNode.insertBefore(box, btn);
    elText = box.querySelector(".live-text");
    elDetect = box.querySelector(".live-detect");
    const s = box.querySelectorAll(".live-status");
    elStatus = s[0]; elDebug = s[1];
        showDetect("");

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "live-clear";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", reset);
    box.appendChild(clearBtn);
  }
  }

  function paint() {
    if (!elText) return;
    const text = sentence(true);
    elText.textContent = text || "Show a sign to the camera";
    elText.classList.toggle("empty", !text);
  }
  function showDetect(t) { if (elDetect) elDetect.textContent = t || idleHint(); }
  function setStatus(t) { if (elStatus) elStatus.textContent = t; }
  function setDebug(t) { if (elDebug) elDebug.textContent = t; }

  // ---------- What script.js calls ----------
  window.SignRecognizer = {
    // called for every camera frame with the detected hands
    onFrame: function (hands) {
      if (!ready) return;
      const now = performance.now();
      const has = hands.length > 0;
      if (has) lastHandT = now;
      else if (now - lastHandT >= C.HANDS_GONE_MS) goneAfterCommit = true;
      if (!has && nameMode && !handsLeftSinceName && now - lastHandT >= C.FIRST_LETTER_GAP_MS) handsLeftSinceName = true;

      buf.push({ t: now, f: frameFeatures(packHands(hands)) });
      while (buf.length && buf[0].t < now - C.WORD_MS - 400) buf.shift();

      if (nameMode && letters && now - lastHandT > C.NAME_END_MS) { finalizeName(); paint(); }
      if (!has || now - lastEval < C.EVAL_MS) return;
      lastEval = now;
      evaluate(now);
    },
    // called when "Capture & Translate" finishes: returns the text and starts fresh
    finish: function () {
      finalizeName();
      const text = sentence(false);
      const avg = allConf.length ? Math.round(allConf.reduce((a, b) => a + b, 0) / allConf.length) : 0;
      reset();
      window.SignRecognizer.lastConfidence = avg;
      return text || "No sign detected";
    },
    reset: reset
  };

  // Start fresh whenever the user goes to another page (except when pressing Capture)
  document.addEventListener("click", function (e) {
    const el = e.target.closest ? e.target.closest("[data-go]") : null;
    if (el && el.dataset.go !== "analysis") reset();
  });

  buildUI();
  loadData();
})();