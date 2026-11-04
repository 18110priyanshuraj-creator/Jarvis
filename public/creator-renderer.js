const POSES = [
  { id: "idle", label: "Idle / neutral", arms: [[50, 76, 27, 104], [50, 76, 73, 104]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] },
  { id: "walk", label: "Walking", arms: [[50, 76, 27, 93], [50, 76, 75, 58]], legs: [[50, 119, 22, 150], [50, 119, 80, 145]] },
  { id: "point", label: "Pointing", arms: [[50, 76, 22, 55], [50, 76, 91, 63]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] },
  { id: "think", label: "Thinking", arms: [[50, 76, 29, 111], [50, 76, 69, 49]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] },
  { id: "surprised", label: "Surprised", arms: [[50, 76, 21, 45], [50, 76, 79, 45]], legs: [[50, 119, 30, 158], [50, 119, 70, 158]] },
  { id: "explaining", label: "Explaining", arms: [[50, 76, 22, 66], [50, 76, 82, 85]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] }
];

function text(value, limit) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function getContext(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("A canvas is required.");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not create a canvas rendering context.");
  return ctx;
}

function background(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#061822");
  gradient.addColorStop(1, "#0b4e5b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(67, 223, 231, .10)";
  for (let x = 0; x < width; x += 72) {
    for (let y = 0; y < height; y += 72) ctx.fillRect(x, y, 1, 1);
  }
}

function drawFigure(ctx, pose, x, y, scale, bob = 0) {
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#7df6d0";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(50, 37, 18, 0, Math.PI * 2);
  ctx.stroke();
  const [leftArm, rightArm] = pose.arms;
  const [leftLeg, rightLeg] = pose.legs;
  const segment = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  segment([50, 56], [50, 119]);
  segment([50, 76], [leftArm[2], leftArm[3]]);
  segment([50, 76], [rightArm[2], rightArm[3]]);
  segment([50, 119], [leftLeg[2], leftLeg[3]]);
  segment([50, 119], [rightLeg[2], rightLeg[3]]);
  ctx.restore();
}

function wrapCanvasText(ctx, value, maxWidth, maxLines) {
  const words = text(value, 100).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

export function drawThumbnailCanvas(canvas, options = {}) {
  const ctx = getContext(canvas);
  canvas.width = 1280;
  canvas.height = 720;
  background(ctx, 1280, 720);
  ctx.fillStyle = "#7cf1e5";
  ctx.font = "700 24px Arial";
  ctx.fillText("JARVIS EXPLAINER", 72, 82);
  ctx.fillStyle = "#f2fdff";
  ctx.font = "800 62px Arial";
  const title = text(options.title || "A BIG QUESTION", 70);
  const lines = wrapCanvasText(ctx, title, 690, 4);
  lines.forEach((line, index) => ctx.fillText(line, 72, 210 + index * 76));
  const subtitle = text(options.subtitle, 60);
  if (subtitle) {
    ctx.fillStyle = "#b9e8ec";
    ctx.font = "32px Arial";
    ctx.fillText(subtitle, 76, 585);
  }
  const pose = POSES.find((item) => item.id === options.pose) || POSES[2];
  drawFigure(ctx, pose, 900, 90, 2.75);
  return canvas;
}

export function drawStickFigureFrame(canvas, options = {}, elapsedSeconds = 0) {
  const ctx = getContext(canvas);
  canvas.width = 1280;
  canvas.height = 720;
  background(ctx, 1280, 720);
  ctx.fillStyle = "#7cf1e5";
  ctx.font = "700 22px Arial";
  ctx.fillText("JARVIS STICK-FIGURE PREVIEW", 72, 70);
  ctx.fillStyle = "#f2fdff";
  ctx.font = "800 48px Arial";
  ctx.fillText(text(options.title || "Explaining an idea", 50), 72, 145);
  ctx.fillStyle = "#b9e8ec";
  ctx.font = "28px Arial";
  ctx.fillText(text(options.subtitle || "A reusable character animation sample", 70), 72, 198);
  const pose = POSES[Math.floor(Math.max(0, elapsedSeconds) / 2) % POSES.length];
  drawFigure(ctx, pose, 520, 170, 2.8, Math.sin(elapsedSeconds * Math.PI) * 3);
  ctx.fillStyle = "#e1faf9";
  ctx.font = "600 28px Arial";
  ctx.textAlign = "center";
  ctx.fillText(pose.label, 640, 670);
  ctx.textAlign = "left";
  return canvas;
}

export function canvasToPng(canvas) {
  getContext(canvas);
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("PNG export is not supported in this browser."));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The thumbnail PNG could not be generated."));
    }, "image/png");
  });
}

export async function recordStickFigurePreview(canvas, options = {}) {
  if (!canvas?.captureStream || typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support canvas video recording. Export the SVG poses instead.");
  }
  const durationMs = Math.min(16000, Math.max(6000, Number(options.durationMs) || 12000));
  const stream = canvas.captureStream(24);
  const preferred = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((format) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(format));
  let recorder;
  try {
    recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("This browser could not start a WebM recording.");
  }
  const chunks = [];
  return new Promise((resolve, reject) => {
    let start = 0;
    let frameId = 0;
    let settled = false;
    const cleanup = () => {
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach((track) => track.stop());
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      if (!chunks.length) {
        reject(new Error("The browser did not produce a video file."));
        return;
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => finish(new Error("The browser stopped the video recording unexpectedly."));
    recorder.onstop = () => finish();
    const render = (now) => {
      if (!start) start = now;
      const elapsed = now - start;
      drawStickFigureFrame(canvas, options, elapsed / 1000);
      if (elapsed >= durationMs) {
        if (recorder.state === "recording") recorder.stop();
        return;
      }
      frameId = requestAnimationFrame(render);
    };
    try {
      recorder.start(250);
      frameId = requestAnimationFrame(render);
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, durationMs + 1500);
    } catch {
      finish(new Error("The browser could not start the canvas recording."));
    }
  });
}
