import './styles.css';
import { App } from './app/app';

const app = new App(document.getElementById('app')!);
if (import.meta.env.DEV) {
  (window as unknown as { app: App }).app = app;
  // ?autoplay[=level] jumps straight into a game (dev convenience).
  const auto = new URLSearchParams(location.search).get('autoplay');
  if (auto != null) app.devStart(parseInt(auto, 10) || 1);
}

// Offline play: cache the game after the first visit (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
