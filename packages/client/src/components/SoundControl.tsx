import { useEffect, useId, useRef, useState, type FocusEvent, type Ref } from 'react';
import { setSoundSetting, useSoundSettings } from '../sound/settings.js';
import { canVibrate } from '../sound/vibration.js';

/**
 * The speaker button at the end of the header, and the little popover it
 * opens: one switch for sound, one for vibration. Both start on.
 *
 * Built like the Share popover: Esc or a click outside closes it, tabbing out
 * of it does too, and Esc hands focus back to the button. Opening moves focus
 * onto the first switch, so a keyboard user can flip it straight away.
 */
export function SoundControl() {
  const settings = useSoundSettings();
  // iPhones and iPads have no navigator.vibrate: the switch is shown, but off and dimmed.
  const vibrationSupported = canVibrate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstSwitchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const noteId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    firstSwitchRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    // pointerdown, not click: a press that starts outside and ends inside is
    // still a click outside.
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  /** Tabbing out closes it. Focus going nowhere (a click on plain text inside) leaves it open. */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !wrapRef.current?.contains(next)) close(false);
  };

  return (
    <div className="sound-control" ref={wrapRef} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-button sound-button${open ? ' active' : ''}`}
        aria-label={settings.sound ? 'Sound and vibration settings' : 'Sound and vibration settings, sound is off'}
        title="Sound and vibration"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <SpeakerIcon muted={!settings.sound} />
      </button>

      {open && (
        <div id={panelId} className="sound-pop card" role="dialog" aria-label="Sound and vibration">
          <SwitchRow
            label="Sound"
            checked={settings.sound}
            inputRef={firstSwitchRef}
            onChange={(on) => setSoundSetting('sound', on)}
          />
          <SwitchRow
            label="Vibration"
            checked={vibrationSupported && settings.vibration}
            disabled={!vibrationSupported}
            describedBy={noteId}
            onChange={(on) => setSoundSetting('vibration', on)}
          />
          <p id={noteId} className="muted sound-note">
            iPhones and iPads don’t support vibration in the browser.
          </p>
        </div>
      )}
    </div>
  );
}

interface SwitchRowProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (on: boolean) => void;
}

/**
 * A labelled on/off switch. A real checkbox underneath — Space flips it and
 * screen readers say "switch, on" — with the track and thumb drawn over it.
 */
function SwitchRow({ label, checked, disabled, describedBy, inputRef, onChange }: SwitchRowProps) {
  return (
    <label className={`switch-row${disabled ? ' disabled' : ''}`}>
      <span>{label}</span>
      <input
        ref={inputRef}
        className="switch-input"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

/** A speaker; with waves when sound is on, with a cross when it is off. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a8 8 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}
