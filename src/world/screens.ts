import * as THREE from 'three';

export type Painter = (g: CanvasRenderingContext2D, w: number, h: number, time: number) => void;

/** A canvas-backed texture that repaints at a limited rate. */
export class ScreenTexture {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private last = -1;
  /** Mesh showing this texture; used to skip updates when far away or off-screen. */
  anchor: THREE.Object3D | null = null;
  constructor(readonly w: number, readonly h: number, public painter: Painter, private interval = 0.12) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.paint(0);
  }
  paint(time: number) {
    this.painter(this.g, this.w, this.h, time);
    this.texture.needsUpdate = true;
  }
  update(time: number, visible: (o: THREE.Object3D) => boolean) {
    if (this.interval <= 0) return;
    if (time - this.last < this.interval) return;
    if (this.anchor && !visible(this.anchor)) return;
    this.last = time;
    this.paint(time);
  }
}

const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
const SANS = '"IBM Plex Sans", "IBM Plex Sans Arabic", "Segoe UI", sans-serif';

function chrome(g: CanvasRenderingContext2D, w: number, h: number, title: string) {
  g.fillStyle = '#0b1117'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#16212b'; g.fillRect(0, 0, w, 28);
  g.fillStyle = '#9fb3c4'; g.font = `600 14px ${SANS}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(title, 12, 14);
  g.fillStyle = '#3ad07a'; g.beginPath(); g.arc(w - 16, 14, 4, 0, Math.PI * 2); g.fill();
}

const LOG_LINES = [
  'sshd[2311]: Failed password for invalid user admin from 203.0.113.47',
  'sshd[2312]: Failed password for root from 203.0.113.47 port 51022',
  'sshd[2314]: Invalid user oracle from 203.0.113.47 port 40211',
  'CRON[3412]: pam_unix(cron:session): session opened for user root',
  'sshd[2318]: Failed password for invalid user test from 203.0.113.47',
  'nginx[911]: 10.0.1.21 "GET /health HTTP/1.1" 200',
  'sshd[2320]: Failed password for backup from 203.0.113.47 port 49933',
  'kernel: TCP: Possible SYN flooding on port 22. Sending cookies.',
];

export const painters = {
  logs: (title = 'auth.log — tail -f'): Painter => (g, w, h, t) => {
    chrome(g, w, h, title);
    g.font = `13px ${MONO}`;
    const lineH = 18;
    const rows = Math.floor((h - 36) / lineH);
    const offset = Math.floor(t * 2.5);
    for (let i = 0; i < rows; i++) {
      const line = LOG_LINES[(offset + i) % LOG_LINES.length];
      g.fillStyle = line.includes('Failed') || line.includes('Invalid') ? '#ff7a6b' : '#8fd6a8';
      const sec = String((14 * 60 + offset + i) % 60).padStart(2, '0');
      g.fillText(`03:${String(14 + Math.floor((offset + i) / 60) % 10).padStart(2, '0')}:${sec} ${line}`, 10, 42 + i * lineH);
    }
  },

  dashboard: (): Painter => (g, w, h, t) => {
    chrome(g, w, h, 'SIEM — authentication events (last 60 min)');
    const cx = 20, cy = 50, cw = w - 40, ch = h * 0.55;
    g.strokeStyle = '#22313d'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(cx, cy + (ch * i) / 4); g.lineTo(cx + cw, cy + (ch * i) / 4); g.stroke(); }
    const bars = 40;
    for (let i = 0; i < bars; i++) {
      const spike = i > 28 && i < 34;
      const v = spike ? 0.6 + 0.35 * Math.abs(Math.sin(i * 1.7 + t * 0.6)) : 0.08 + 0.08 * Math.abs(Math.sin(i * 2.3));
      g.fillStyle = spike ? '#e8584a' : '#3a86c8';
      const bh = v * ch;
      g.fillRect(cx + (cw / bars) * i + 2, cy + ch - bh, cw / bars - 4, bh);
    }
    const kpis: [string, string, string][] = [['Failed logins', '142', '#e8584a'], ['Unique sources', '7', '#d9a441'], ['Open alerts', '3', '#e8584a'], ['Hosts', '48', '#4fb0e6']];
    kpis.forEach(([label, val, col], i) => {
      const x = 20 + i * ((w - 40) / 4), y = cy + ch + 24;
      g.fillStyle = '#7f93a3'; g.font = `12px ${SANS}`; g.fillText(label, x, y);
      g.fillStyle = col; g.font = `600 30px ${SANS}`; g.fillText(val, x, y + 30);
    });
  },

  topology: (): Painter => (g, w, h, t) => {
    chrome(g, w, h, 'Network map — DMZ');
    const nodes: [number, number, string, boolean][] = [
      [0.15, 0.5, 'internet', true], [0.38, 0.5, 'fw-edge', false], [0.6, 0.3, 'srv-web-01', true],
      [0.6, 0.7, 'srv-db-01', false], [0.85, 0.5, 'core-sw', false],
    ];
    const edges = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4]];
    g.lineWidth = 2;
    for (const [a, b] of edges) {
      const hot = (a === 0 && b === 1) || (a === 1 && b === 2);
      g.strokeStyle = hot ? '#e8584a' : '#2f5f86';
      g.beginPath(); g.moveTo(nodes[a][0] * w, nodes[a][1] * h); g.lineTo(nodes[b][0] * w, nodes[b][1] * h); g.stroke();
      if (hot) {
        const k = (t * 0.8 + a * 0.3) % 1;
        g.fillStyle = '#ffb4a8';
        g.beginPath(); g.arc(nodes[a][0] * w + (nodes[b][0] - nodes[a][0]) * w * k, nodes[a][1] * h + (nodes[b][1] - nodes[a][1]) * h * k, 4, 0, Math.PI * 2); g.fill();
      }
    }
    for (const [x, y, label, alert] of nodes) {
      g.fillStyle = alert ? '#3b1b1b' : '#13283a'; g.strokeStyle = alert ? '#e8584a' : '#4fa3d9';
      g.beginPath(); g.arc(x * w, y * h, 16, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#c9d6e0'; g.font = `12px ${MONO}`; g.textAlign = 'center'; g.fillText(label, x * w, y * h + 32);
    }
    g.textAlign = 'left';
  },

  idle: (label: string): Painter => (g, w, h, t) => {
    g.fillStyle = '#0a0f14'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c2b38'; g.font = `600 ${Math.floor(h / 9)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2);
    g.fillStyle = `rgba(79,163,217,${0.4 + 0.3 * Math.sin(t * 2)})`;
    g.fillRect(w / 2 - 40, h / 2 + h / 8, 80, 3);
    g.textAlign = 'left';
  },
};

export { MONO, SANS };
