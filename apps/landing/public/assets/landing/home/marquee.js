// Pause control for the homepage logo marquees (WCAG 2.2.2 Pause, Stop, Hide).
// Every strip that is actually scrolling becomes a toggle button: click, tap, Enter or Space
// pauses or resumes all strips. A strip that is static at the current width (the trusted-by
// grid on desktop) gets no control. The page re-renders parts of itself, so the controls are
// re-applied whenever the DOM changes, and the paused state lives on <html>.
class MarqueePause {
  static tracks = '[style*="om-marquee"], .om-trusted-track';

  constructor(root) {
    this.root = root;
    this.paused = false;
    this.pending = false;
  }

  start() {
    this.root.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-marquee-control]")) this.toggle();
    });
    this.root.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("[data-marquee-control]")) {
        event.preventDefault();
        this.toggle();
      }
    });
    new MutationObserver(() => this.schedule()).observe(this.root, { childList: true, subtree: true });
    addEventListener("resize", () => this.schedule());
    this.sync();
  }

  toggle() {
    this.paused = !this.paused;
    document.documentElement.classList.toggle("om-marquee-paused", this.paused);
    this.sync();
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.sync();
    });
  }

  sync() {
    for (const track of this.root.querySelectorAll(MarqueePause.tracks)) {
      const strip = track.parentElement;
      if (getComputedStyle(track).animationName !== "none") {
        strip.setAttribute("data-marquee-control", "");
        strip.setAttribute("role", "button");
        strip.setAttribute("tabindex", "0");
        strip.setAttribute("aria-label", "Pause scrolling logos");
        strip.setAttribute("aria-pressed", String(this.paused));
      } else if (strip.hasAttribute("data-marquee-control")) {
        for (const name of ["data-marquee-control", "role", "tabindex", "aria-label", "aria-pressed"]) strip.removeAttribute(name);
      }
    }
  }
}

new MarqueePause(document.body).start();
