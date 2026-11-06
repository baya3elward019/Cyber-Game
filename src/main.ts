import './ui/styles.css';
import { Game } from './core/Game';

const boot = document.getElementById('boot')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

if (!webglAvailable()) {
  boot.textContent = 'This game needs WebGL. Please enable hardware acceleration or try a different browser.';
} else {
  // wait for web fonts so canvas-drawn screens use the right typeface (max 1.5 s)
  const fonts = (document as any).fonts?.ready ?? Promise.resolve();
  Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => {
    try {
      new Game(canvas);
      requestAnimationFrame(() => boot.remove());
    } catch (err) {
      console.error(err);
      boot.textContent = 'Something went wrong while starting the game. Please reload the page.';
    }
  });
}
