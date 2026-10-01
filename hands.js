// hands.js
// Finds up to 2 hands on the camera page, draws the green points, and sends them to recognizer.js.
// Use this when script.js has no hand tracking code of its own.
(function () {
  const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

  const video = document.getElementById("video");
  if (!video) return;
  let overlay = document.getElementById("overlay");
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.id = "overlay";
    video.parentNode.appendChild(overlay);
  }
  const octx = overlay.getContext("2d");

  let landmarker = null;
  let loading = false;
  let lastVideoTime = -1;

  function setStatusText(text) {
    const pill = document.getElementById("statusPill");
    const label = document.getElementById("statusText");
    if (label && pill && pill.classList.contains("on") && label.textContent !== text) label.textContent = text;
  }

  async function loadModel() {
    if (landmarker || loading) return;
    loading = true;
    setStatusText("Camera Active - loading hand tracking...");
    try {
      const { HandLandmarker, FilesetResolver } = await import(CDN + "/vision_bundle.mjs");
      const fileset = await FilesetResolver.forVisionTasks(CDN + "/wasm");
      const make = delegate => HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: delegate },
        runningMode: "VIDEO",
        numHands: 2
      });
      try { landmarker = await make("GPU"); }
      catch (gpuError) { landmarker = await make("CPU"); }
      setStatusText("Camera Active");
    } catch (err) {
      console.error("Hand tracking failed to load:", err);
      setStatusText("Hand tracking could not load. Check your internet and refresh.");
      setTimeout(function () { loading = false; }, 5000);   // try again after 5 seconds
      return;
    }
    loading = false;
  }

  function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function draw(hands) {
    const w = overlay.width, h = overlay.height;
    clearOverlay();
    hands.forEach(function (pts) {
      octx.lineWidth = Math.max(2, w / 300);
      octx.strokeStyle = "#a5b4fc";
      CONNECTIONS.forEach(function (pair) {
        octx.beginPath();
        octx.moveTo(pts[pair[0]].x * w, pts[pair[0]].y * h);
        octx.lineTo(pts[pair[1]].x * w, pts[pair[1]].y * h);
        octx.stroke();
      });
      octx.fillStyle = "#22c55e";
      pts.forEach(function (p) {
        octx.beginPath();
        octx.arc(p.x * w, p.y * h, Math.max(3, w / 200), 0, Math.PI * 2);
        octx.fill();
      });
    });
  }

  function loop() {
    requestAnimationFrame(loop);

    // If script.js already has its own hand tracking, do nothing
    if (typeof handLandmarker !== "undefined" && handLandmarker) return;

    const active = document.body.dataset.screen === "camera" && video.readyState >= 2 && !video.paused;
    if (!active) { clearOverlay(); return; }
    if (!landmarker) { loadModel(); return; }
    if (video.currentTime === lastVideoTime) return;   // same frame as before
    lastVideoTime = video.currentTime;

    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }

    const result = landmarker.detectForVideo(video, performance.now());
    const hands = result.landmarks || [];
    draw(hands);
    setStatusText(hands.length === 0 ? "Camera Active" : hands.length === 1 ? "1 hand detected" : "2 hands detected");
    if (window.SignRecognizer) window.SignRecognizer.onFrame(hands);
  }
  loop();
})();