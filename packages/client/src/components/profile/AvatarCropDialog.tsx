import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  AVATAR_UNREADABLE,
  clampView,
  cropFromView,
  decodeImage,
  type CropSquare,
  type CropView,
  type DecodedImage,
} from '../../data/avatar.js';

interface Props {
  /** The picture the player chose; already passed checkAvatarFile. */
  file: File;
  onCancel: () => void;
  /** The square of the picture to keep, in its own pixels. */
  onSave: (crop: CropSquare) => void;
  /** The upload is running: nothing can be changed or closed until it ends. */
  saving?: boolean;
}

/** The stage's largest width on screen; narrower screens shrink it with CSS. */
const STAGE_SIZE = 320;
/** The two sizes a picture is shown at: the profile card and the scoreboard. */
const PREVIEWS = [
  { size: 56, label: 'Profile' },
  { size: 24, label: 'Scoreboard' },
] as const;

/** A step of the arrow keys, in frame units, and of + / − in zoom. */
const KEY_MOVE = 0.03;
const KEY_ZOOM = 0.1;

const HOME: CropView = { zoom: AVATAR_MIN_ZOOM, offsetX: 0, offsetY: 0 };

/**
 * Choosing which part of a picture to keep. The stage shows exactly the square
 * that will be cut out, with the round mask dimming what falls outside the
 * circle — the circle is what the player sees everywhere, so it is what is
 * framed. Drag moves the picture, the slider, wheel or a pinch zooms it.
 *
 * The picture is decoded with the same function `squareAvatar` uses, so the
 * crop handed to onSave is in the pixels that will be cut. Nothing is sent
 * anywhere from here: the parent does the upload.
 *
 * Focus moves into the dialog when it opens, stays inside it while it is open,
 * and goes back to whatever opened it when it closes.
 */
export function AvatarCropDialog({ file, onCancel, onSave, saving = false }: Props) {
  const [decoded, setDecoded] = useState<DecodedImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<CropView>(HOME);

  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageCanvas = useRef<HTMLCanvasElement>(null);
  const previewCanvases = useRef<(HTMLCanvasElement | null)[]>([]);
  /** Fingers (or the mouse) currently down on the stage, with where they last were. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  // Read the file. The bitmap holds memory until it is closed, so it is closed
  // on the way out — and at once, should the file arrive after the dialog has gone.
  useEffect(() => {
    let live = true;
    let mine: DecodedImage | null = null;
    decodeImage(file).then(
      (image) => {
        if (!live) {
          image.close();
          return;
        }
        mine = image;
        setDecoded(image);
      },
      (error: unknown) => {
        console.error('[avatar] could not read the picture:', error);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      mine?.close();
    };
  }, [file]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Once there is a picture to move, the stage is where the keys are.
  useEffect(() => {
    if (decoded) stageRef.current?.focus();
  }, [decoded]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!saving) onCancel();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      // Keep Tab inside the dialog: the page behind it is inert while it is open.
      const focusable = cardRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const inside = cardRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  /** Applies a change to the view, held inside the picture. */
  function adjust(change: (v: CropView) => CropView) {
    if (!decoded) return;
    setView((v) => clampView(decoded.width, decoded.height, change(v)));
  }

  // The wheel needs preventDefault, which only a non-passive listener may call —
  // React's own onWheel is passive, and the page would scroll under the dialog.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !decoded) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Firefox reports lines where others report pixels.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => clampView(decoded.width, decoded.height, { ...v, zoom: v.zoom * Math.exp(-delta * 0.0015) }));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [decoded]);

  const crop = useMemo(
    () => (decoded ? cropFromView(decoded.width, decoded.height, view) : null),
    [decoded, view],
  );

  // Draw the stage and both previews from the one crop. Canvases are sized in
  // device pixels so they stay sharp on a dense screen.
  useEffect(() => {
    if (!decoded || !crop) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const targets: [HTMLCanvasElement | null, number][] = [
      [stageCanvas.current, STAGE_SIZE],
      ...PREVIEWS.map((p, i): [HTMLCanvasElement | null, number] => [previewCanvases.current[i] ?? null, p.size]),
    ];
    for (const [canvas, size] of targets) {
      const context = canvas?.getContext('2d');
      if (!canvas || !context) continue;
      const pixels = Math.round(size * ratio);
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, pixels, pixels);
      context.drawImage(decoded.image, crop.sx, crop.sy, crop.side, crop.side, 0, 0, pixels, pixels);
    }
  }, [decoded, crop]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!decoded || saving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const start = pinch.current;
      // Two fingers apart by more than they started means zoom in.
      if (start.distance > 0) {
        adjust((v) => ({ ...v, zoom: start.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / start.distance) }));
      }
      return;
    }

    // A drag is a fraction of the stage however big it is drawn on this screen.
    const frame = e.currentTarget.getBoundingClientRect().width;
    if (!(frame > 0)) return;
    adjust((v) => ({
      ...v,
      offsetX: v.offsetX + (now.x - before.x) / frame,
      offsetY: v.offsetY + (now.y - before.y) / frame,
    }));
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onStageKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (saving) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_MOVE, 0],
      ArrowRight: [KEY_MOVE, 0],
      ArrowUp: [0, -KEY_MOVE],
      ArrowDown: [0, KEY_MOVE],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      adjust((v) => ({ ...v, offsetX: v.offsetX + move[0], offsetY: v.offsetY + move[1] }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      adjust((v) => ({ ...v, zoom: v.zoom + KEY_ZOOM }));
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      adjust((v) => ({ ...v, zoom: v.zoom - KEY_ZOOM }));
    }
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-title"
      aria-describedby="crop-help"
    >
      <div className="card crop-dialog" ref={cardRef} aria-busy={saving}>
        <h2 id="crop-title">Position your picture</h2>
        <p id="crop-help" className="muted">
          Drag to move. Zoom with the slider, the mouse wheel or a pinch.
        </p>

        {failed ? (
          <p role="alert" className="form-error crop-note">
            {AVATAR_UNREADABLE}
          </p>
        ) : !decoded ? (
          <p role="status" className="muted crop-note">
            Loading…
          </p>
        ) : (
          <>
            <div
              ref={stageRef}
              className="crop-stage"
              role="group"
              tabIndex={0}
              aria-label="Picture position. Arrow keys move it, plus and minus zoom."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onStageKeyDown}
            >
              <canvas ref={stageCanvas} aria-hidden="true" />
              <div className="crop-mask" />
              <div className="crop-ring" />
            </div>

            <div className="crop-zoom">
              <label htmlFor="crop-zoom" className="muted">
                Zoom
              </label>
              <input
                id="crop-zoom"
                type="range"
                min={AVATAR_MIN_ZOOM}
                max={AVATAR_MAX_ZOOM}
                step={0.01}
                value={view.zoom}
                disabled={saving}
                aria-valuetext={`${view.zoom.toFixed(1)} times`}
                onChange={(e) => adjust((v) => ({ ...v, zoom: Number(e.target.value) }))}
              />
              <span className="muted" aria-hidden="true">
                {view.zoom.toFixed(1)}×
              </span>
            </div>

            <div className="crop-previews" aria-label="How it will look">
              {PREVIEWS.map((p, i) => (
                <div key={p.size} className="crop-preview">
                  <canvas
                    ref={(el) => {
                      previewCanvases.current[i] = el;
                    }}
                    style={{ width: p.size, height: p.size }}
                    aria-hidden="true"
                  />
                  <span className="muted">{p.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="crop-actions">
          <button ref={cancelRef} type="button" className="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          {decoded && (
            <button type="button" disabled={saving || !crop} onClick={() => crop && onSave(crop)}>
              {saving ? 'Saving…' : 'Save picture'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
