(() => {
  const PROJECT_ID = "Vpa6JQ9WnxiC9cgDUWnu";
  const RUNTIME_URL =
    "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js";
  const SCENE_LAYOUT = [
    {
      position: "upper-right",
      section: "Value propositions",
      progress: 0.56,
    },
    { position: "bottom-center", section: "One install", progress: 0.5 },
  ];

  const atmosphere = document.createElement("div");
  atmosphere.id = "landing-atmosphere";
  atmosphere.setAttribute("aria-hidden", "true");

  const toneMap = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  toneMap.classList.add("landing-atmosphere-filters");
  toneMap.innerHTML = `
    <defs>
      <filter id="landing-muted-brand-blue" color-interpolation-filters="sRGB">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues=".05 .07 .09 .11 .14 .17 .2 .24 .29 .36 .9" />
          <feFuncG type="table" tableValues=".11 .13 .15 .17 .2 .23 .27 .31 .37 .45 .95" />
          <feFuncB type="table" tableValues=".22 .24 .27 .3 .34 .38 .43 .49 .57 .68 1" />
        </feComponentTransfer>
      </filter>
    </defs>
  `;

  const createScene = ({ position, section, progress }) => {
    const scene = document.createElement("div");
    scene.className = `landing-atmosphere-scene landing-atmosphere-scene--${position}`;
    scene.dataset.landingAnchor = section;
    scene.dataset.landingAnchorProgress = String(progress);
    scene.dataset.usProject = PROJECT_ID;
    scene.dataset.usFps = "30";
    scene.dataset.usDpi = "1.5";
    scene.dataset.usScale = "1";
    return scene;
  };

  atmosphere.append(toneMap, ...SCENE_LAYOUT.map(createScene));
  document.body.prepend(atmosphere);

  const updateBounds = () => {
    const atmosphereStart = Array.from(
      document.querySelectorAll('section[data-screen-label="Validation"]'),
    ).reduce((documentBottom, candidate) => {
      const rect = candidate.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return documentBottom;
      return Math.max(
        documentBottom,
        Math.max(0, window.scrollY + rect.bottom),
      );
    }, 0);
    const page = Array.from(
      document.querySelectorAll("#dc-root .landing-page"),
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const pageRect = page?.getBoundingClientRect();
    const documentHeight = pageRect
      ? window.scrollY + pageRect.bottom
      : document.body.scrollHeight;

    if (atmosphereStart <= 0 || documentHeight <= window.innerHeight) return;

    atmosphere.style.setProperty(
      "--landing-atmosphere-start",
      `${atmosphereStart}px`,
    );
    atmosphere.style.setProperty(
      "--landing-atmosphere-height",
      `${Math.max(0, documentHeight - atmosphereStart)}px`,
    );

    SCENE_LAYOUT.forEach(({ position, section, progress }) => {
      const anchor = Array.from(
        document.querySelectorAll(`section[data-screen-label="${section}"]`),
      ).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const scene = atmosphere.querySelector(
        `.landing-atmosphere-scene--${position}`,
      );
      if (!anchor || !scene) return;

      const anchorRect = anchor.getBoundingClientRect();
      const documentTop = window.scrollY + anchorRect.top;
      const heading = anchor.querySelector("h1, h2, h3");
      let sceneTop = documentTop + anchorRect.height * progress;

      if (position === "problem-center") {
        scene.style.setProperty(
          "--landing-scene-left",
          `${window.scrollX + anchorRect.left + anchorRect.width / 2}px`,
        );
      }

      if (position === "bottom-center" && heading) {
        const headingRect = heading.getBoundingClientRect();
        sceneTop = window.scrollY + headingRect.top + headingRect.height / 2;
        scene.style.setProperty(
          "--landing-scene-left",
          `${window.scrollX + headingRect.left + headingRect.width / 2}px`,
        );
      }

      scene.style.setProperty(
        "--landing-scene-top",
        `${Math.max(0, sceneTop - atmosphereStart)}px`,
      );
    });
  };

  let boundsFrame = 0;
  const scheduleBoundsUpdate = () => {
    window.cancelAnimationFrame(boundsFrame);
    boundsFrame = window.requestAnimationFrame(updateBounds);
  };

  const revealWhenReady = () => {
    const initializedScenes = atmosphere.querySelectorAll(
      '[data-us-initialized="true"], canvas',
    );
    if (initializedScenes.length > 0) {
      document.body.classList.add("landing-atmosphere-ready");
      return true;
    }
    return false;
  };

  const sceneObserver = new MutationObserver(() => {
    if (revealWhenReady()) sceneObserver.disconnect();
  });
  sceneObserver.observe(atmosphere, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  const initialize = () => {
    if (typeof window.UnicornStudio?.init !== "function") return;
    window.UnicornStudio.init();
    window.UnicornStudio.isInitialized = true;
    window.requestAnimationFrame(revealWhenReady);
  };

  const existingRuntime = document.querySelector(
    `script[src="${RUNTIME_URL}"]`,
  );

  if (typeof window.UnicornStudio?.init === "function") {
    initialize();
  } else if (existingRuntime) {
    existingRuntime.addEventListener("load", initialize, { once: true });
  } else {
    window.UnicornStudio = window.UnicornStudio || { isInitialized: false };
    const runtime = document.createElement("script");
    runtime.src = RUNTIME_URL;
    runtime.async = true;
    runtime.dataset.landingUnicornRuntime = "true";
    runtime.addEventListener("load", initialize, { once: true });
    document.body.appendChild(runtime);
  }

  const pageObserver = new ResizeObserver(scheduleBoundsUpdate);
  const pageRoot = document.querySelector("#dc-root");
  if (pageRoot) pageObserver.observe(pageRoot);
  pageObserver.observe(document.body);

  const contentObserver = new MutationObserver(scheduleBoundsUpdate);
  if (pageRoot) {
    contentObserver.observe(pageRoot, { childList: true, subtree: true });
  }

  scheduleBoundsUpdate();
  window.setTimeout(updateBounds, 250);
  window.setTimeout(updateBounds, 1000);
  window.addEventListener("load", scheduleBoundsUpdate, { once: true });
  window.addEventListener("resize", scheduleBoundsUpdate, { passive: true });
})();
