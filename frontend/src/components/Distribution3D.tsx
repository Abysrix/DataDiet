/**
 * A small data-driven WebGL panel: one column per real distribution count.
 *
 * The scene is deliberately quiet — a one-off reveal, no idle spin — and the
 * same counts stay available as text in the legend. If WebGL2 is unavailable,
 * or three.js cannot start, the component renders the dependency-free BarList
 * instead. jsdom cannot exercise a GPU context, so the automated test covers
 * that fallback path, not the rendered pixels.
 */

import { useEffect, useRef, useState } from "react";
import type { MeshStandardMaterial } from "three";
import { BarList, type BarItem } from "./ui/BarList";
import { TONE_SOLID } from "./ui/statusClasses";
import { resolveTone, type Tone, type ToneInput } from "../lib/semantic";

type ThreeModule = typeof import("three");
type RenderMode = "checking" | "webgl" | "fallback";

export interface Distribution3DProps {
  items: Array<BarItem & { tone: ToneInput }>;
}

/** Mirror of the status quartet in `index.css`, with a CSS-variable read first. */
const TOKEN_COLORS: Record<Tone, { variable: string; fallback: string }> = {
  neutral: { variable: "--color-neutral", fallback: "#64748b" },
  info: { variable: "--color-info", fallback: "#0284c7" },
  success: { variable: "--color-success", fallback: "#059669" },
  warning: { variable: "--color-warning", fallback: "#d97706" },
  caution: { variable: "--color-caution", fallback: "#ea580c" },
  critical: { variable: "--color-critical", fallback: "#e11d48" },
  accent: { variable: "--color-accent", fallback: "#4f46e5" },
};

function colorForTone(tone: ToneInput): string {
  const token = TOKEN_COLORS[resolveTone(tone)];
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token.variable)
    .trim();
  return value || token.fallback;
}

function describe(items: Distribution3DProps["items"]): string {
  const counts = items.map((item) => `${item.label} ${item.value}`).join(", ");
  return `Three-dimensional bar chart of the scoped distribution: ${counts}. Bar height represents the record count.`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;

    const update = () => setReduced(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return reduced;
}

/**
 * Build the scene once, reveal the bars once, then stop the loop. Nothing is
 * allocated inside the animation frame; only existing meshes are transformed.
 */
function createScene(
  THREE: ThreeModule,
  options: {
    canvas: HTMLCanvasElement;
    host: HTMLDivElement;
    context: WebGL2RenderingContext;
    items: Distribution3DProps["items"];
    reducedMotion: boolean;
  },
): () => void {
  const { canvas, host, context, items, reducedMotion } = options;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 2.4, 5.4);
  camera.lookAt(0, 0.9, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    alpha: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(resource: T): T => {
    disposables.push(resource);
    return resource;
  };

  // One unit box and one material per semantic tone: no per-frame allocation.
  const barGeometry = track(new THREE.BoxGeometry(0.72, 1, 0.72));
  const materials = new Map<Tone, MeshStandardMaterial>();
  const materialFor = (role: Tone): MeshStandardMaterial => {
    const existing = materials.get(role);
    if (existing) return existing;
    const material = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorForTone(role)),
        roughness: 0.62,
        metalness: 0.04,
      }),
    );
    materials.set(role, material);
    return material;
  };
  items.forEach((item) => materialFor(resolveTone(item.tone)));

  const peak = Math.max(1, ...items.map((item) => item.value));
  const bars = items.map((item, index) => {
    const height = item.value === 0 ? 0.04 : 0.28 + (item.value / peak) * 2.1;
    const mesh = new THREE.Mesh(barGeometry, materialFor(resolveTone(item.tone)));
    mesh.position.x = (index - (items.length - 1) / 2) * 1.08;
    mesh.scale.y = height;
    mesh.position.y = height / 2;
    return { mesh, height };
  });
  const group = new THREE.Group();
  bars.forEach(({ mesh }) => group.add(mesh));
  scene.add(group);

  const baseGeometry = track(new THREE.BoxGeometry(items.length * 1.08 + 0.5, 0.04, 1.3));
  const baseMaterial = track(
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colorForTone("neutral")), transparent: true, opacity: 0.35 }),
  );
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = -0.03;
  scene.add(base);

  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const clock = new THREE.Clock();
  let progress = reducedMotion ? 1 : 0;
  let revealed = reducedMotion;
  let visible = true;

  const applyProgress = (value: number) => {
    const eased = 1 - Math.pow(1 - value, 3);
    bars.forEach(({ mesh, height }) => {
      const current = height * eased;
      mesh.scale.y = current;
      mesh.position.y = current / 2;
    });
  };

  const resize = () => {
    const width = Math.max(1, Math.floor(host.clientWidth));
    const height = Math.max(1, Math.floor(host.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (revealed) renderer.render(scene, camera);
  };

  const animate = () => {
    const delta = clock.getDelta();
    progress = Math.min(1, progress + delta / 0.55);
    applyProgress(progress);
    renderer.render(scene, camera);
    if (progress >= 1) {
      revealed = true;
      renderer.setAnimationLoop(null);
    }
  };

  const start = () => {
    if (revealed || !visible || document.hidden) return;
    clock.start();
    renderer.setAnimationLoop(animate);
  };

  const stop = () => renderer.setAnimationLoop(null);

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  if (resizeObserver) resizeObserver.observe(host);
  else window.addEventListener("resize", resize);

  let intersectionObserver: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    intersectionObserver.observe(host);
  }

  document.addEventListener("visibilitychange", onVisibility);
  applyProgress(progress);
  resize();
  if (reducedMotion) renderer.render(scene, camera);
  else start();

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    resizeObserver?.disconnect();
    if (!resizeObserver) window.removeEventListener("resize", resize);
    intersectionObserver?.disconnect();
    disposables.forEach((resource) => resource.dispose());
    renderer.dispose();
  };
}

export function Distribution3D({ items }: Distribution3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<RenderMode>("checking");
  const reducedMotion = usePrefersReducedMotion();
  const ariaLabel = describe(items);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    const context = (() => {
      try {
        return canvas.getContext("webgl2", { alpha: true, antialias: true });
      } catch {
        return null;
      }
    })();

    if (!context) {
      setMode("fallback");
      return;
    }

    void import("three")
      .then((THREE) => {
        if (disposed) return;
        teardown = createScene(THREE, { canvas, host, context, items, reducedMotion });
        setMode("webgl");
      })
      .catch(() => {
        if (!disposed) setMode("fallback");
      });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [items, reducedMotion]);

  if (mode === "fallback") {
    return (
      <div className="rounded-control border border-line bg-surface px-card-x py-card-y">
        <p className="mb-stack text-meta text-ink-muted">
          3D view unavailable here; the same API counts are shown as bars.
        </p>
        <BarList items={items} />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-stack sm:grid-cols-[minmax(0,1fr)_9.5rem]">
      <div
        ref={hostRef}
        className="relative h-56 min-w-0 overflow-hidden rounded-control border border-line bg-surface-sunken"
      >
        <canvas ref={canvasRef} role="img" aria-label={ariaLabel} className="block h-full w-full" />
        {mode === "checking" ? (
          <span
            role="status"
            className="absolute inset-0 grid place-items-center text-meta text-ink-muted"
          >
            Preparing chart…
          </span>
        ) : null}
      </div>
      <ol className="grid content-start gap-2" aria-label="Risk band counts">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-2 text-meta">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-pill ${TONE_SOLID[resolveTone(item.tone)]}`}
              />
              <span className="truncate text-ink-secondary">{item.label}</span>
            </span>
            <span className="font-medium tabular-nums text-ink">{item.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
