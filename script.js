const video = document.getElementById("video");
const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const camMessage = document.getElementById("camMessage");
const cameraToggleBtn = document.getElementById("cameraToggleBtn");
let stream = null;
let analysisTimer = null;

// ---------- Screen switching ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.body.dataset.screen = id;
  document.body.classList.toggle("dark", id === "analysis");
  window.scrollTo(0, 0);

  if (id === "camera") startCamera(); else stopCamera();          // camera ON only on camera page
  if (id === "analysis") runAnalysis(); else clearTimeout(analysisTimer);
  if (id !== "result") stopSpeaking();                            // stop voice when leaving result page
}

document.querySelectorAll("[data-go]").forEach(el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    showScreen(el.dataset.go);
  });
});

// ---------- Camera ----------
function setStatus(on, text, message = "") {
  statusPill.classList.toggle("on", on);
  statusText.textContent = text;
  cameraToggleBtn.textContent = on ? "⏹ Stop Camera" : "▶ Start Camera";
  camMessage.textContent = message;
  camMessage.hidden = !message;
}

async function startCamera() {
  if (stream) return;
    resetUploadedVideo();
  setStatus(false, "Starting camera...");
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    if (document.body.dataset.screen !== "camera") { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    video.srcObject = stream;
    setStatus(true, "Camera Active");
  } catch (err) {
    console.error(err);
    let msg = "Could not start the camera.";
    if (err.name === "NotAllowedError") msg = "Camera permission is blocked. Click the 🔒 icon in the address bar, allow Camera, then refresh the page.";
    else if (err.name === "NotFoundError") msg = "No camera was found on this device.";
    else if (err.name === "NotReadableError") msg = "The camera is being used by another app (Zoom, Teams, etc.). Close it and try again.";
    setStatus(false, "Camera Off", msg);
  }
}

function stopCamera() {
      resetUploadedVideo();
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  setStatus(false, "Camera Off");
}

cameraToggleBtn.addEventListener("click", () => (stream ? stopCamera() : startCamera()));

// ---------- Analysis page (processing animation) ----------
function runAnalysis() {
  const bar = document.getElementById("progressBar");
  const steps = ["step1", "step2", "step3"].map(id => document.getElementById(id));

  function setStage(active, progress) {
    steps.forEach((el, i) => {
      el.classList.toggle("done", i < active);
      el.classList.toggle("active", i === active);
    });
    bar.style.width = progress + "%";
  }

  setStage(0, 10);                                   // Captured
  analysisTimer = setTimeout(() => {
    setStage(1, 55);                                 // Analyzing
    analysisTimer = setTimeout(() => {
      setStage(2, 90);                               // Generating Result
      analysisTimer = setTimeout(() => {
        bar.style.width = "100%";
        analysisTimer = setTimeout(() => {
                 showResult(window.SignRecognizer ? SignRecognizer.finish() : getMockResult());             // later: real recognized sentence
          showScreen("result");
        }, 400);
      }, 1200);
    }, 1600);
  }, 800);
}

// ---------- Result page ----------
const MOCK_WORDS = ["Hello", "Hi", "Welcome", "Thank you", "Please", "Yes", "No"];
const resultText = document.getElementById("resultText");
const detectedPill = document.getElementById("detectedPill");
const resultTime = document.getElementById("resultTime");
const playBtn = document.getElementById("playBtn");
const playAgainBtn = document.getElementById("playAgainBtn");
const wave = document.getElementById("wave");
const durationEl = document.getElementById("duration");
const historyList = document.getElementById("historyList");

let currentText = "";
let translationHistory = loadHistory();
let speakId = 0;
let speakTimer = null;

// TEMPORARY: random word. We will replace this with the real AI result later.
function getMockResult() {
  return MOCK_WORDS[Math.floor(Math.random() * MOCK_WORDS.length)];
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtSec(s) {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function estimateSeconds(text) {
  return Math.max(1, Math.round(text.length / 6));
}

// waveform bars (decoration)
for (let i = 0; i < 40; i++) {
  const bar = document.createElement("span");
  bar.style.height = (20 + Math.random() * 80) + "%";
  bar.style.animationDelay = (i * 0.05) + "s";
  wave.appendChild(bar);
}

function showResult(text) {
  currentText = text;
  resultText.textContent = text;
  detectedPill.textContent = text;
    if (window.SignRecognizer && typeof SignRecognizer.lastConfidence === "number") {
    detectedPill.textContent = text + "  (" + SignRecognizer.lastConfidence + "% confident)";
    }
  resultTime.textContent = "Today, " + fmtClock(Date.now());
  durationEl.textContent = "0:00 / " + fmtSec(estimateSeconds(text));

  translationHistory.unshift({ text: text, time: Date.now() });
  translationHistory = translationHistory.slice(0, 20);
  saveHistory();
  renderHistory();
}

// ---------- Text-to-speech ----------
function stopSpeaking() {
  speakId++;                       // old speech callbacks will now ignore themselves
  clearInterval(speakTimer);
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  wave.classList.remove("playing");
  playBtn.textContent = "▶";
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    alert("Speech is not supported in this browser. Please use Google Chrome.");
    return;
  }
  stopSpeaking();
  const myId = speakId;
  const total = estimateSeconds(text);
  let sec = 0;
  durationEl.textContent = "0:00 / " + fmtSec(total);

  const u = new SpeechSynthesisUtterance(text);
   const chosen = voices.find(v => v.name === voiceSelect.value);
  if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = "en-US"; }
  u.rate = parseFloat(rateSelect.value);
  u.onstart = () => {
    if (myId !== speakId) return;
    wave.classList.add("playing");
    playBtn.textContent = "■";
    speakTimer = setInterval(() => {
      sec++;
      durationEl.textContent = fmtSec(Math.min(sec, total)) + " / " + fmtSec(total);
    }, 1000);
  };
  u.onend = u.onerror = () => {
    if (myId !== speakId) return;
    clearInterval(speakTimer);
    wave.classList.remove("playing");
    playBtn.textContent = "▶";
    durationEl.textContent = fmtSec(total) + " / " + fmtSec(total);
  };
  speechSynthesis.speak(u);
}

playBtn.addEventListener("click", () => {
  if (wave.classList.contains("playing")) stopSpeaking(); else speak(currentText);
});
playAgainBtn.addEventListener("click", () => speak(currentText));

// ---------- Translation history (saved in the browser) ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem("signtalkHistory")) || []; }
  catch (e) { return []; }
}
function saveHistory() {
  try { localStorage.setItem("signtalkHistory", JSON.stringify(translationHistory)); }
  catch (e) { /* ignore */ }
}
function renderHistory() {
  historyList.innerHTML = "";
  if (translationHistory.length === 0) {
    historyList.innerHTML = '<li class="empty">No translations yet</li>';
    return;
  }
  translationHistory.slice(0, 6).forEach(item => {
    const li = document.createElement("li");
    const t = document.createElement("span");
    t.textContent = item.text;
    const m = document.createElement("span");
    m.className = "h-time";
    m.textContent = fmtClock(item.time);
    li.append(t, m);
    historyList.appendChild(li);
  });
}
renderHistory();

// ---------- Voice selection ----------
const voiceSelect = document.getElementById("voiceSelect");
const rateSelect = document.getElementById("rateSelect");
let voices = [];
// Put part of a voice name here (example: "Heera", "Zira", "David"). Leave "" for automatic.
const PREFERRED_VOICE = "Zira";

function loadVoices() {
  voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
  if (voices.length === 0) return;

  let saved = null;
  try { saved = localStorage.getItem("signtalkVoice"); } catch (e) {}

  voiceSelect.innerHTML = "";
  voices.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = v.name + " (" + v.lang + ")";
    voiceSelect.appendChild(opt);
  });

  // saved voice first, else an Indian-English voice, else the first English voice
    const pick = (PREFERRED_VOICE && voices.find(v => v.name.includes(PREFERRED_VOICE))) || voices.find(v => v.lang === "en-IN") || voices[0];
  voiceSelect.value = pick.name;
}

if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;   // Chrome loads voices a little later
}

voiceSelect.addEventListener("change", () => {
  try { localStorage.setItem("signtalkVoice", voiceSelect.value); } catch (e) {}
  speak(currentText || "Hello");                  // play a sample of the new voice
});
rateSelect.addEventListener("change", () => speak(currentText || "Hello"));

// ---------- Upload video ----------
const uploadBtn = document.getElementById("uploadBtn");
const videoFile = document.getElementById("videoFile");
const cameraFrame = document.querySelector(".camera-frame");
let uploadedURL = null;

function resetUploadedVideo() {
  video.pause();
  video.removeAttribute("src");
  video.controls = false;
  cameraFrame.classList.remove("uploaded");
}

uploadBtn.addEventListener("click", () => videoFile.click());

videoFile.addEventListener("change", () => {
  const file = videoFile.files[0];
  if (!file) return;

  stopCamera();                                        // turn the live camera off
  if (uploadedURL) URL.revokeObjectURL(uploadedURL);
  uploadedURL = URL.createObjectURL(file);

  video.srcObject = null;
  video.src = uploadedURL;
  video.muted = true;
  video.controls = true;
  cameraFrame.classList.add("uploaded");               // no mirror effect for uploaded videos
  video.play().catch(() => {});
  setStatus(false, "Video: " + file.name);

  videoFile.value = "";                                // lets you pick the same file again
});