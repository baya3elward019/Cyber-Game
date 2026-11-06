import * as THREE from 'three';

/** Procedural textures drawn on canvases. No downloads needed. */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function rand(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 7) {
  const r = rand(seed);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Raised data-center floor tiles (60 cm). One texture tile = 2x2 floor tiles. */
export function floorTiles(base = '#3b4147', seam = '#22272b') {
  const S = 512;
  const { c, g } = canvas(S, S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  noise(g, S, S, 14, 3);
  // subtle per-tile tone variation
  const r = rand(11);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const v = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.015 + r() * 0.025})`;
    g.fillRect(x * 256, y * 256, 256, 256);
  }
  g.strokeStyle = seam; g.lineWidth = 4;
  for (let i = 0; i <= 2; i++) {
    g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * 256); g.lineTo(S, i * 256); g.stroke();
  }
  // one perforated airflow tile
  g.fillStyle = 'rgba(10,12,14,0.85)';
  for (let y = 290; y < 480; y += 14) for (let x = 290; x < 480; x += 14) { g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill(); }

  const rough = canvas(S, S);
  rough.g.fillStyle = '#6a6a6a'; rough.g.fillRect(0, 0, S, S);
  noise(rough.g, S, S, 40, 5);
  rough.g.strokeStyle = '#d0d0d0'; rough.g.lineWidth = 6;
  for (let i = 0; i <= 2; i++) {
    rough.g.beginPath(); rough.g.moveTo(i * 256, 0); rough.g.lineTo(i * 256, S); rough.g.stroke();
    rough.g.beginPath(); rough.g.moveTo(0, i * 256); rough.g.lineTo(S, i * 256); rough.g.stroke();
  }
  return { map: tex(c), roughnessMap: tex(rough.c, [1, 1], false) };
}

/** Polished concrete for the lobby. */
export function concrete(base = '#5b6066') {
  const S = 512;
  const { c, g } = canvas(S, S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const r = rand(21);
  for (let i = 0; i < 260; i++) {
    const v = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${r() * 0.05})`;
    g.beginPath(); g.arc(r() * S, r() * S, 10 + r() * 60, 0, Math.PI * 2); g.fill();
  }
  noise(g, S, S, 18, 9);
  g.strokeStyle = 'rgba(20,22,25,0.6)'; g.lineWidth = 2;
  g.strokeRect(0, 0, S, S);
  const rough = canvas(S, S);
  rough.g.fillStyle = '#4a4a4a'; rough.g.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) {
    rough.g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
    rough.g.beginPath(); rough.g.arc(r() * S, r() * S, 20 + r() * 80, 0, Math.PI * 2); rough.g.fill();
  }
  noise(rough.g, S, S, 30, 4);
  return { map: tex(c), roughnessMap: tex(rough.c, [1, 1], false) };
}

/** Acoustic wall panels with vertical seams. */
export function wallPanels(base = '#2c3238', seam = '#1b1f23') {
  const W = 512, H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  noise(g, W, H, 10, 13);
  g.fillStyle = seam;
  for (let x = 0; x < W; x += 128) g.fillRect(x, 0, 3, H);
  g.fillRect(0, 0, W, 3);
  // fabric texture feel
  g.globalAlpha = 0.05;
  for (let y = 0; y < H; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, W, 1); }
  g.globalAlpha = 1;
  return tex(c);
}

/** Brushed metal roughness/color. */
export function brushedMetal(base = '#8a9097') {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const r = rand(5);
  for (let i = 0; i < 900; i++) {
    const y = r() * S;
    const v = r() > 0.5 ? 255 : 0;
    g.strokeStyle = `rgba(${v},${v},${v},${r() * 0.06})`;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 2); g.stroke();
  }
  return tex(c);
}

/** Front face of a 42U rack full of servers and a network switch. Also returns LED positions (uv). */
export function rackFront(seed = 1) {
  const W = 256, H = 1024;
  const { c, g } = canvas(W, H);
  const r = rand(seed * 97 + 3);
  g.fillStyle = '#0c0e10'; g.fillRect(0, 0, W, H);
  const leds: { u: number; v: number; color: number }[] = [];
  const U = H / 42;
  let u = 1;
  while (u < 41) {
    const kind = r();
    const size = kind < 0.15 ? 1 : kind < 0.7 ? 1 : kind < 0.9 ? 2 : 4;
    const isSwitch = kind < 0.15;
    const y = H - (u + size) * U;
    const h = size * U - 2;
    if (r() < 0.12 && !isSwitch) { u += 1; continue; } // blank slot
    // chassis
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, isSwitch ? '#2a2f35' : '#343a41');
    grad.addColorStop(1, isSwitch ? '#1d2126' : '#252a30');
    g.fillStyle = grad; g.fillRect(10, y, W - 20, h);
    g.fillStyle = '#4b525a'; g.fillRect(10, y, W - 20, 1.5);
    // rack ears
    g.fillStyle = '#5a6168'; g.fillRect(4, y, 8, h); g.fillRect(W - 12, y, 8, h);
    if (isSwitch) {
      // 24 ports in two rows
      for (let row = 0; row < 2; row++) for (let p = 0; p < 12; p++) {
        const px = 40 + p * 14, py = y + 4 + row * (h / 2 - 1);
        g.fillStyle = '#050607'; g.fillRect(px, py, 11, h / 2 - 6);
        g.fillStyle = '#8b939b'; g.fillRect(px, py, 11, 1);
        if (r() < 0.7) leds.push({ u: (px + 5) / W, v: 1 - (py - 1) / H, color: 0x2cff6a });
      }
      g.fillStyle = '#9aa3ab'; g.font = '7px sans-serif'; g.fillText('NX-2400', 16, y + h / 2 + 3);
    } else {
      // drive bays
      const bays = size >= 2 ? 8 : 4;
      for (let b = 0; b < bays; b++) {
        const bx = 60 + b * ((W - 90) / bays);
        g.fillStyle = '#15181b'; g.fillRect(bx, y + 3, (W - 90) / bays - 4, h - 6);
        g.fillStyle = '#3b4249'; g.fillRect(bx + 2, y + 5, (W - 90) / bays - 8, 3);
        leds.push({ u: (bx + 6) / W, v: 1 - (y + h - 6) / H, color: r() < 0.9 ? 0x2cff6a : 0xffa020 });
      }
      // vents
      g.fillStyle = '#121518';
      for (let vx = 18; vx < 52; vx += 4) g.fillRect(vx, y + 3, 2, h - 6);
      leds.push({ u: 30 / W, v: 1 - (y + h / 2) / H, color: 0x3aa0ff });
    }
    u += size;
  }
  return { map: tex(c), leds };
}

/** A label/sign drawn on a canvas (bilingual support: lines can be Arabic). */
export function signTexture(lines: { text: string; font: string; color: string; dir?: 'rtl' | 'ltr' }[], w = 1024, h = 256, bg = '#15191d') {
  const { c, g } = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const step = h / (lines.length + 1);
  lines.forEach((l, i) => {
    g.font = l.font; g.fillStyle = l.color; g.textAlign = 'center'; g.textBaseline = 'middle';
    (g as any).direction = l.dir ?? 'ltr';
    g.fillText(l.text, w / 2, step * (i + 1));
  });
  return tex(c);
}

export function keyboardTexture() {
  const { c, g } = canvas(512, 160);
  g.fillStyle = '#1a1d20'; g.fillRect(0, 0, 512, 160);
  for (let row = 0; row < 5; row++) for (let k = 0; k < 15; k++) {
    g.fillStyle = '#2a2f34'; g.fillRect(8 + k * 33, 8 + row * 30, 29, 26);
    g.fillStyle = '#353b41'; g.fillRect(8 + k * 33, 8 + row * 30, 29, 3);
  }
  return tex(c);
}
