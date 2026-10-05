import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlyThoughtNotice } from '@fmm/shared';
import brainMap from './brainMap.json';
import { decodeFlyRates, describeFlyThought, projectPoint, rotationAngle, thoughtStep } from './brainModel.js';

/**
 * The Fruit Fly brain panel: the 244 real neurons from the connectome map,
 * lit by the rates the server recorded while the fly decided. Loaded only in
 * rooms with a Fruit Fly bot, as its own chunk.
 *
 * The canvas draws from the public thought alone — it never sees the board's
 * hidden mines. While the panel is closed, scrolled out of view or its tab is
 * hidden, nothing is drawn and no animation frame is requested.
 */

const STORAGE_KEY = 'fmm.flyBrain';
/** One full turn of the neuron cloud. */
const TURN_MS = 40_000;
/** The 16 recorded steps play over this long, then the last frame holds. */
const THOUGHT_MS = 1_000;
/** While only the slow turn is moving, about 30 frames a second is plenty (a hair under, so a 60 Hz screen draws every second frame). */
const IDLE_FRAME_MS = 30;

const OUTPUT_NEURONS = brainMap.neurons.filter((neuron) => neuron.role === 'output').length;
const NEURON_COUNT = brainMap.neurons.length;

/** Open on desktop by default; on a phone, closed until asked. A choice made with the button is remembered. */
function initialOpen(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'open' || stored === 'closed') return stored === 'open';
  } catch {
    // Storage unavailable — fall through to the screen-size default.
  }
  try {
    return window.matchMedia('(min-width: 641px)').matches;
  } catch {
    return true;
  }
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the viewer asked for less motion, kept up to date if the setting changes while the page is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia(REDUCED_MOTION).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia(REDUCED_MOTION);
    } catch {
      return;
    }
    // Very old browsers can read the setting but not listen for a change.
    if (typeof query.addEventListener !== 'function') return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Layer colours, apart in lightness and not only in hue: near-white inputs,
 * a dim slate for the 200 middle cells, MBON outputs in the signal orange
 * (the dark theme's, which is the one that sits well on this dark canvas).
 */
const LAYER: Record<string, [number, number, number]> = {
  input: [240, 244, 250],
  hidden: [92, 108, 132],
  output: [255, 128, 76],
};
const KEY: { role: string; label: string }[] = [
  { role: 'input', label: 'PN smell inputs' },
  { role: 'hidden', label: 'KC memory cells' },
  { role: 'output', label: 'MBON outputs' },
];

interface Frames {
  /** Step-major rates, one byte each. */
  bytes: Uint8Array;
  steps: number;
}

/** Draws one frame at the given step and rotation angle. */
function paintBrain(canvas: HTMLCanvasElement, frames: Frames | null, step: number, angle: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const unit = Math.min(width, height) / 300;
  context.clearRect(0, 0, width, height);

  const scale = Math.min(width, height) * 0.4;
  const centerX = width / 2;
  const centerY = height / 2;
  const projected = brainMap.neurons.map((neuron) => {
    const point = projectPoint(neuron.position[0], neuron.position[1], neuron.position[2], angle);
    return { x: centerX + point.x * scale, y: centerY + point.y * scale, depth: point.depth };
  });

  context.strokeStyle = 'rgba(140, 147, 157, 0.13)';
  context.lineWidth = Math.max(0.5, 0.6 * unit);
  context.beginPath();
  for (const [pre, post] of brainMap.edges) {
    const from = projected[pre]!;
    const to = projected[post]!;
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
  }
  context.stroke();

  // Back to front, so nearer neurons sit on top of the cloud.
  const order = projected.map((_, index) => index).sort((a, b) => projected[b]!.depth - projected[a]!.depth);
  const rowStart = step * NEURON_COUNT;
  for (const index of order) {
    const neuron = brainMap.neurons[index]!;
    const point = projected[index]!;
    const rate = frames ? frames.bytes[rowStart + index]! / 255 : 0;
    const [red, green, blue] = LAYER[neuron.role]!;
    const alpha = Math.min(1, (0.34 + rate * 0.66) * (0.6 + 0.4 * ((1 - point.depth) / 2)));
    const radius = ((neuron.role === 'output' ? 1.7 : 1.1) + rate * 1.9) * unit;
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

export function FlyBrainPanel({ thought }: { thought: FlyThoughtNotice | null }) {
  const [open, setOpen] = useState(initialOpen);
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** When the current thought arrived, on the animation clock: its 16 steps play from here. */
  const arrivedAt = useRef(0);
  const rotationStart = useRef(performance.now());

  useEffect(() => {
    arrivedAt.current = performance.now();
  }, [thought]);

  // Decoded only while the panel is open, so a closed panel does no work at all.
  const frames = useMemo<Frames | null>(() => {
    if (!open || !thought || thought.neurons !== NEURON_COUNT) return null;
    const bytes = decodeFlyRates(thought.rates, thought.steps, thought.neurons);
    return bytes ? { bytes, steps: thought.steps } : null;
  }, [open, thought]);

  // The paint loop. It asks for animation frames only while the panel is open,
  // its canvas is on screen and the tab is showing; with reduced motion there
  // is no loop at all, just a still frame of the last step.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round((canvas.clientWidth || 280) * dpr);
      const height = Math.round((canvas.clientHeight || 224) * dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };
    const draw = (now: number) => {
      const step = !frames ? 0 : reduced ? frames.steps - 1 : thoughtStep(now - arrivedAt.current, frames.steps, THOUGHT_MS);
      const angle = reduced ? 0 : rotationAngle(now - rotationStart.current, TURN_MS);
      paintBrain(canvas, frames, step, angle);
    };

    let frame = 0;
    let lastDraw = 0;
    let onScreen = true;
    const tick = (now: number) => {
      const thinking = frames !== null && now - arrivedAt.current < THOUGHT_MS;
      if (thinking || now - lastDraw >= IDLE_FRAME_MS) {
        draw(now);
        lastDraw = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const start = () => {
      if (frame === 0 && !reduced && onScreen && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      draw(performance.now());
      start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const sizer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            resize();
            draw(performance.now());
          })
        : null;
    sizer?.observe(canvas);
    // On a phone the panel sits below the board: scrolled out of view, it rests.
    const watcher =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
            if (!onScreen) {
              stop();
              return;
            }
            draw(performance.now());
            start();
          })
        : null;
    watcher?.observe(canvas);

    resize();
    draw(performance.now());
    start();
    return () => {
      stop();
      sizer?.disconnect();
      watcher?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [open, reduced, frames]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed');
    } catch {
      // A remembered toggle is a convenience, never a requirement.
    }
  };

  return (
    <section className="fly-brain" aria-label="Fruit Fly brain">
      <div className="fly-brain-head">
        <h3>
          Fruit Fly brain <span>simulated</span>
        </h3>
        <button type="button" className="ghost fly-toggle" aria-expanded={open} onClick={toggle}>
          {open ? 'Hide the brain' : "Show the fly's brain"}
        </button>
      </div>

      {open && (
        <>
          <canvas
            ref={canvasRef}
            className="fly-canvas"
            role="img"
            aria-label={`The fly's ${NEURON_COUNT} neurons, lighting up as it decides.`}
          />
          <ul className="fly-key">
            {KEY.map(({ role, label }) => (
              <li key={role}>
                <i style={{ background: `rgb(${LAYER[role]!.join(', ')})` }} />
                {label}
              </li>
            ))}
          </ul>
          <p className="fly-live" aria-live="polite">
            {thought ? describeFlyThought(thought, OUTPUT_NEURONS) : 'Waiting for the fly to think…'}
          </p>
          <p className="fly-credit">
            Wiring: the real male fruit-fly connectome (
            <a href={brainMap.provenance.credit.url} target="_blank" rel="noreferrer">
              male-cns v1.0, neuPrint
            </a>
            , CC BY 4.0). Activity: our simulation of it, not a recording from a real fly.
          </p>
        </>
      )}
    </section>
  );
}
