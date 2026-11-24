// Lecteur YouTube intégré (IFrame Player API) avec vitesse et suivi de progression.
let apiPromise = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiPromise;
}

export class Player {
  constructor(el, { videoId, start = 0, speed = 1, threshold = 0.8, onProgress, onThreshold, onEnded, onError, onReady }) {
    this.el = el;
    this.speed = speed;
    this.threshold = threshold;
    this.crossed = false;
    this.cb = { onProgress, onThreshold, onEnded, onError, onReady };
    this.ready = loadApi().then(() => new Promise((resolve) => {
      this.yt = new YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, start: Math.floor(start), autoplay: 1 },
        events: {
          onReady: () => {
            this.setSpeed(this.speed);
            this.timer = setInterval(() => this.tick(), 2000);
            this.cb.onReady?.();
            resolve();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) this.setSpeed(this.speed, false);
            if (e.data === YT.PlayerState.ENDED) { this.tick(); this.cb.onEnded?.(); }
          },
          onError: (e) => this.cb.onError?.(e.data),
        },
      });
    }));
  }

  tick() {
    if (!this.yt?.getDuration) return;
    const d = this.yt.getDuration();
    const t = this.yt.getCurrentTime();
    if (!d) return;
    const frac = Math.min(1, t / d);
    this.cb.onProgress?.(frac, t, d);
    if (!this.crossed && frac >= this.threshold) {
      this.crossed = true;
      this.cb.onThreshold?.(frac);
    }
  }

  setSpeed(rate, remember = true) {
    if (remember) this.speed = rate;
    try { this.yt?.setPlaybackRate?.(rate); } catch { /* lecteur pas prêt */ }
  }

  availableSpeeds() {
    try { return this.yt.getAvailablePlaybackRates(); } catch { return [1, 1.25, 1.5, 2]; }
  }

  destroy() {
    clearInterval(this.timer);
    try { this.tick(); } catch { /* rien */ }
    try { this.yt?.destroy(); } catch { /* rien */ }
  }
}
