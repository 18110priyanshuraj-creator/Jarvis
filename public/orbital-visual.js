export function createOrbitalVisual(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") {
    return { setMode() {}, destroy() {} };
  }

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return { setMode() {}, destroy() {} };

  const TAU = Math.PI * 2;
  const points = Array.from({ length: 520 }, (_, index) => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (index / 519) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = goldenAngle * index;
    return {
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      size: 0.35 + Math.random() * 1.25,
      phase: Math.random() * TAU,
      speed: 0.25 + Math.random() * 0.8
    };
  });

  const rays = Array.from({ length: 92 }, (_, index) => ({
    angle: (index / 92) * TAU + (Math.random() - 0.5) * 0.08,
    length: 0.76 + Math.random() * 0.52,
    width: 0.35 + Math.random() * 0.8,
    alpha: 0.08 + Math.random() * 0.38,
    phase: Math.random() * TAU
  }));

  let width = 0;
  let height = 0;
  let ratio = 1;
  let frame = 0;
  let destroyed = false;
  let mode = "idle";
  let lastTime = 0;
  let resizeObserver = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(time) {
    if (destroyed) return;
    lastTime = time || lastTime + 16;
    context.clearRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.5;
    const radius = Math.min(width, height) * 0.285;
    const motion = lastTime * 0.00022;
    const pulse = 1 + Math.sin(lastTime * (mode === "speaking" ? 0.006 : 0.0026)) *
      (mode === "speaking" ? 0.075 : mode === "listening" ? 0.045 : 0.025);
    const energy = mode === "thinking" ? 0.78 : mode === "speaking" ? 1.2 : mode === "listening" ? 1.12 : 1;
    context.save();
    context.globalCompositeOperation = "lighter";

    const aura = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.85);
    aura.addColorStop(0, "rgba(255, 180, 70, " + (0.18 * energy) + ")");
    aura.addColorStop(0.28, "rgba(234, 103, 19, " + (0.10 * energy) + ")");
    aura.addColorStop(0.72, "rgba(123, 50, 8, 0.025)");
    aura.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = aura;
    context.beginPath();
    context.arc(cx, cy, radius * 1.85, 0, TAU);
    context.fill();

    for (const ray of rays) {
      const angle = ray.angle + motion * (ray.width > 0.8 ? 0.7 : -0.52);
      const inner = radius * (0.82 + Math.sin(lastTime * 0.0015 + ray.phase) * 0.035);
      const outer = radius * ray.length * (0.98 + Math.sin(lastTime * 0.0018 + ray.phase) * 0.06);
      const gradient = context.createLinearGradient(
        cx + Math.cos(angle) * inner,
        cy + Math.sin(angle) * inner,
        cx + Math.cos(angle) * outer,
        cy + Math.sin(angle) * outer
      );
      gradient.addColorStop(0, "rgba(255, 204, 123, " + (ray.alpha * energy) + ")");
      gradient.addColorStop(0.55, "rgba(255, 133, 30, " + (ray.alpha * 0.55 * energy) + ")");
      gradient.addColorStop(1, "rgba(255, 112, 16, 0)");
      context.strokeStyle = gradient;
      context.lineWidth = ray.width;
      context.beginPath();
      context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      context.stroke();
    }

    const shellRotation = motion * 0.6;
    for (const point of points) {
      const x = point.x * Math.cos(shellRotation) - point.z * Math.sin(shellRotation);
      const z = point.x * Math.sin(shellRotation) + point.z * Math.cos(shellRotation);
      const perspective = 0.74 + (z + 1) * 0.18;
      const breathe = 0.94 + Math.sin(lastTime * 0.0014 * point.speed + point.phase) * 0.055;
      const px = cx + x * radius * pulse * breathe;
      const py = cy + point.y * radius * pulse * breathe;
      const alpha = (0.18 + (z + 1) * 0.25) * energy;
      const size = point.size * perspective;
      const green = Math.round(112 + 108 * Math.max(0, z));
      const blue = Math.round(34 + 58 * Math.max(0, z));
      context.fillStyle = "rgba(255, " + green + ", " + blue + ", " + Math.min(0.9, alpha) + ")";
      context.beginPath();
      context.arc(px, py, size, 0, TAU);
      context.fill();
    }

    const orbitSet = [
      { rx: radius * 1.28, ry: radius * 0.39, tilt: -0.3, phase: 0.2, alpha: 0.8 },
      { rx: radius * 1.15, ry: radius * 0.48, tilt: 0.82, phase: 1.6, alpha: 0.64 },
      { rx: radius * 1.32, ry: radius * 0.27, tilt: 1.3, phase: 2.5, alpha: 0.58 },
      { rx: radius * 0.96, ry: radius * 0.7, tilt: -0.92, phase: 3.1, alpha: 0.32 }
    ];
    for (const orbit of orbitSet) {
      context.save();
      context.translate(cx, cy);
      context.rotate(orbit.tilt + Math.sin(lastTime * 0.00018 + orbit.phase) * 0.06);
      context.beginPath();
      context.ellipse(0, 0, orbit.rx, orbit.ry, 0, 0, TAU);
      context.strokeStyle = "rgba(255, " + (164 + Math.round(35 * Math.sin(lastTime * 0.001 + orbit.phase))) + ", 73, " + (orbit.alpha * energy) + ")";
      context.lineWidth = 0.8;
      context.shadowColor = "rgba(255, 137, 34, 0.9)";
      context.shadowBlur = 8;
      context.stroke();
      context.restore();
    }

    for (let index = 0; index < 38; index++) {
      const angle = (index / 38) * TAU + motion * 1.6;
      const orbitRadius = radius * (0.94 + 0.16 * Math.sin(index * 2.17 + lastTime * 0.001));
      const px = cx + Math.cos(angle) * orbitRadius;
      const py = cy + Math.sin(angle) * orbitRadius * (0.42 + 0.12 * Math.cos(index));
      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(lastTime * 0.002 + index));
      context.fillStyle = "rgba(255, 209, 139, " + (blink * 0.72 * energy) + ")";
      context.beginPath();
      context.arc(px, py, 0.6 + (index % 3) * 0.4, 0, TAU);
      context.fill();
    }

    const coreRadius = radius * 0.17 * pulse;
    const coreGlow = context.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 3.8);
    coreGlow.addColorStop(0, "rgba(255,255,232,1)");
    coreGlow.addColorStop(0.12, "rgba(255,219,152,0.98)");
    coreGlow.addColorStop(0.28, "rgba(255,161,54,0.76)");
    coreGlow.addColorStop(0.68, "rgba(241,104,16,0.16)");
    coreGlow.addColorStop(1, "rgba(241,104,16,0)");
    context.fillStyle = coreGlow;
    context.beginPath();
    context.arc(cx, cy, coreRadius * 3.8, 0, TAU);
    context.fill();
    context.fillStyle = "rgba(255,255,224,0.96)";
    context.shadowColor = "#ffad45";
    context.shadowBlur = 25 * energy;
    context.beginPath();
    context.arc(cx, cy, Math.max(2, coreRadius * 0.24), 0, TAU);
    context.fill();
    context.restore();

    frame = requestAnimationFrame(draw);
  }

  resize();
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }
  frame = requestAnimationFrame(draw);

  return {
    setMode(nextMode) {
      mode = ["idle", "listening", "thinking", "speaking"].includes(nextMode) ? nextMode : "idle";
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
    }
  };
}
