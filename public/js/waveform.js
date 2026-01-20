// Waveform: tries to decode real audio and draw waveform.
// If audio fails -> animated demo waveform.
// Also supports simple play/pause via <audio> element.

export function createWaveformPlayer({
  canvas,
  playBtn,
  seekEl,
  timecodeEl,
  infoEl
}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  let audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";

  let decoded = null;     // AudioBuffer
  let peaks = null;       // Float32Array normalized peaks
  let demoMode = true;
  let animId = null;

  resizeCanvas();

  window.addEventListener("resize", resizeCanvas);

  playBtn.addEventListener("click", async () => {
    if (demoMode) return; // demo doesn't play actual audio
    if (audio.paused) {
      await audio.play().catch(() => {});
      playBtn.textContent = "Pause";
    } else {
      audio.pause();
      playBtn.textContent = "Play";
    }
  });

  seekEl.addEventListener("input", () => {
    if (demoMode) return;
    const t = (Number(seekEl.value) / 1000) * (audio.duration || 0);
    if (Number.isFinite(t)) audio.currentTime = t;
  });

  audio.addEventListener("timeupdate", () => {
    if (demoMode) return;
    const dur = audio.duration || 0;
    const cur = audio.currentTime || 0;
    if (dur > 0) seekEl.value = String(Math.floor((cur / dur) * 1000));
    timecodeEl.textContent = formatTime(cur);
    draw();
  });

  audio.addEventListener("ended", () => {
    playBtn.textContent = "Play";
  });

  function resizeCanvas() {
    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 220;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    draw();
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    const w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#ddd";
    for (let i = 1; i < 6; i++) {
      const y = Math.floor((h / 6) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPeaks() {
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#16a34a";
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.floor(dpr));
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.9;

    if (!peaks || peaks.length < 2) return;

    const step = Math.max(1, Math.floor(peaks.length / w));
    for (let x = 0; x < w; x++) {
      const idx = Math.min(peaks.length - 1, x * step);
      const p = peaks[idx]; // 0..1
      const y = p * (h * 0.42);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, mid - y);
      ctx.lineTo(x + 0.5, mid + y);
      ctx.stroke();
    }

    // playhead
    if (!demoMode && audio.duration > 0) {
      const t = audio.currentTime / audio.duration;
      const px = Math.floor(t * w) + 0.5;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawDemo(t) {
    const w = canvas.width, h = canvas.height, mid = h / 2;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#16a34a";
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.floor(dpr));
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.9;

    const n = w;
    for (let x = 0; x < n; x++) {
      const s1 = Math.sin((x / 25) + (t / 400));
      const s2 = Math.sin((x / 9) - (t / 250));
      const p = (Math.abs(s1) * 0.55 + Math.abs(s2) * 0.45) * 0.9;
      const y = p * (h * 0.42);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, mid - y);
      ctx.lineTo(x + 0.5, mid + y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    clear();
    drawGrid();
    if (demoMode) return; // demo draws in animation loop
    drawPeaks();
  }

  function startDemo() {
    demoMode = true;
    playBtn.textContent = "Play";
    infoEl.textContent = "Waveform: demo (аудио не загружено)";
    timecodeEl.textContent = "00:00";
    seekEl.value = "0";

    if (animId) cancelAnimationFrame(animId);
    const loop = (t) => {
      clear();
      drawGrid();
      drawDemo(t);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
  }

  async function loadAudioAndDecode(url) {
    // stop demo
    demoMode = false;
    if (animId) cancelAnimationFrame(animId);
    animId = null;

    audio.src = url;
    audio.load();

    infoEl.textContent = "Waveform: decoding...";
    timecodeEl.textContent = "00:00";
    seekEl.value = "0";

    const ab = await fetch(url, { cache: "no-cache" }).then(r => {
      if (!r.ok) throw new Error(`audio fetch ${r.status}`);
      return r.arrayBuffer();
    });

    const ac = new (window.AudioContext || window.webkitAudioContext)();
    decoded = await ac.decodeAudioData(ab.slice(0));
    peaks = buildPeaks(decoded, canvas.width);

    infoEl.textContent = `Waveform: ${Math.round(decoded.duration)}s`;
    draw();
  }

  function buildPeaks(audioBuffer, targetWidth) {
    const ch0 = audioBuffer.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(ch0.length / targetWidth));
    const out = new Float32Array(targetWidth);

    let max = 0.000001;
    for (let i = 0; i < targetWidth; i++) {
      const start = i * samplesPerBucket;
      const end = Math.min(ch0.length, start + samplesPerBucket);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch0[j]);
        if (v > peak) peak = v;
      }
      out[i] = peak;
      if (peak > max) max = peak;
    }
    // normalize
    for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / max);
    return out;
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  return {
    async load(url) {
      if (!url) return startDemo();
      try {
        await loadAudioAndDecode(url);
      } catch {
        startDemo();
      }
    },
    setDatetime(text) {
      // external convenience
    }
  };
}
