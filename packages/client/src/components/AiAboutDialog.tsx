import { AI_MODEL_NAME, type AiAbout, type AiModel } from '@fmm/shared';
import { useEffect, useRef } from 'react';
import { FLY_CREDIT } from '../data/aiPlay.js';
import { Avatar } from './Avatar.js';
import { useAiAbout } from './useAiAbout.js';

interface Props {
  /** The opponent last clicked on the card, playable or not. */
  model: AiModel;
  onAbout: () => Promise<AiAbout | null>;
  onClose: () => void;
}

/**
 * The server's language model, as the AI and Fruit Fly sections quote it.
 * The answer is the one the lobby card asked for (see useAiAbout), so this
 * rarely has to wait.
 */
function LlmLine({ onAbout, none }: { onAbout: () => Promise<AiAbout | null>; none: string }) {
  const about = useAiAbout(onAbout);

  return (
    <p className="about-live" role="status" aria-live="polite">
      {about === 'checking' ? (
        'Checking…'
      ) : about === null ? (
        'Could not check which language model this server uses just now.'
      ) : about.llm ? (
        <>
          Language model: <code>{about.llm.model}</code> via {about.llm.provider}
        </>
      ) : (
        none
      )}
    </p>
  );
}

function AboutAi({ onAbout }: { onAbout: Props['onAbout'] }) {
  return (
    <>
      <p>
        A Minesweeper solver works out each covered cell’s chance of being a mine from the open numbers
        only — never the hidden mines. The difficulty sets how often it makes a deliberate mistake. A
        language model picks from the solver’s shortlist and writes its chat lines.
      </p>
      <LlmLine
        onAbout={onAbout}
        none="No language model is connected on this server, so it plays on the solver alone and stays quiet in chat."
      />
    </>
  );
}

function AboutFly({ onAbout }: { onAbout: Props['onAbout'] }) {
  return (
    <>
      <p>
        244 neurons from the male fruit fly connectome: 24 olfactory projection neurons feed 200 Kenyon
        cells, which feed 20 mushroom-body output neurons, joined by 9,076 connections (MaleCNS v1.0, via
        neuPrint). The wiring is the real fly’s; only a small readout on the output neurons was trained, on
        10,000 simulated games.
      </p>
      <p>
        It uses no solver. For each covered cell it is told only what a player can see nearby: how many
        neighbours are open, their numbers, mines already found, and how many more mines those numbers
        still need. On held-out boards its pick is a mine 48% of the time, against 21% for a random cell
        and 59% for the solver. The same readout without the circuit scores 46%, so the neurons add a
        little.
      </p>
      <p>
        Difficulty is how sleepy it is. On Hard it opens the cell its neurons want most; on Medium and Easy
        it picks more loosely, in proportion to how much it wants each cell. In simulated Classic matches
        the Hard fly wins about half its games against the AI on Medium. It runs on the server’s CPU, in
        about 10 ms a move on the Classic board.
      </p>
      <p>
        In chat it says a line from the language model when one is connected, and otherwise stock buzzing.
      </p>
      <LlmLine
        onAbout={onAbout}
        none="No language model is connected on this server, so its chat lines are the stock buzzing."
      />
      {/* The data's licence (CC BY 4.0) wants this wherever the circuit is used. */}
      <p className="fly-credit">
        <a href={FLY_CREDIT.href} target="_blank" rel="noreferrer">
          {FLY_CREDIT.text}
        </a>
        {' · '}
        <a href={FLY_CREDIT.licenseHref} target="_blank" rel="noreferrer">
          {FLY_CREDIT.license}
        </a>
      </p>
    </>
  );
}

function AboutJev({ onAbout }: { onAbout: Props['onAbout'] }) {
  const about = useAiAbout(onAbout);

  return (
    <>
      <p>
        JEV is TypeSafe AI’s fast-choice model. It chooses among the solver’s shortlist, given each cell’s
        odds, and answers with a probability for every option in well under a second. On Easy and Medium it
        is sometimes handed only worse cells, as the AI is.
      </p>
      <p className="about-live" role="status" aria-live="polite">
        {about === 'checking' ? (
          'Checking…'
        ) : about === null ? (
          'Could not check whether this server can play JEV just now.'
        ) : about.jev ? (
          <>
            Model: <code>{about.jev.model}</code> via {about.jev.provider}
          </>
        ) : (
          'This server has no JEV key, so JEV can’t be played here.'
        )}
      </p>
      <p className="fly-credit">
        <a href="https://typesafe.ai" target="_blank" rel="noreferrer">
          typesafe.ai
        </a>
      </p>
    </>
  );
}

/**
 * "About this opponent": how the chosen computer player decides, in plain
 * sentences, so nobody has to take the lobby card's one-liner on trust.
 *
 * Focus moves into the dialog when it opens, stays inside it while it is open,
 * and goes back to the button that opened it when it closes.
 */
export function AiAboutDialog({ model, onAbout, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      // Keep Tab inside the dialog: the page behind it is inert while it is open.
      const focusable = cardRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
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
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-about-title"
      // Only a click on the backdrop itself closes; clicks inside the card bubble here too.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card about-dialog" ref={cardRef}>
        <button ref={closeRef} type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>

        <div className="about-head">
          <Avatar name={AI_MODEL_NAME[model]} bot={model} size={40} />
          <h2 id="ai-about-title">About {AI_MODEL_NAME[model]}</h2>
        </div>

        {model === 'ai' && <AboutAi onAbout={onAbout} />}
        {model === 'fly' && <AboutFly onAbout={onAbout} />}
        {model === 'jev' && <AboutJev onAbout={onAbout} />}
      </div>
    </div>
  );
}
