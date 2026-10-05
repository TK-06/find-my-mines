import { momentTitle, momentWhen, type KeyMoment } from '@fmm/shared';
import { momentCardText } from '../../data/reviewModel.js';

interface Props {
  moments: readonly KeyMoment[];
  names: string[];
  you: number | null;
  /** Jump to this move on the board. */
  onJump: (move: number) => void;
}

/**
 * The moments worth a look, as cards in move order. Each one is a button that
 * jumps the board to that move. On a phone they scroll sideways.
 */
export function KeyMoments({ moments, names, you, onJump }: Props) {
  if (moments.length === 0) return null;

  return (
    <section aria-labelledby="rv-moments-title" className="rv-moments-wrap">
      <h3 id="rv-moments-title" className="rv-section-title">
        Key moments
      </h3>
      <ul className="rv-moments">
        {moments.map((moment) => (
          <li key={`${moment.kind}-${moment.move}`}>
            <button type="button" className={`rv-moment kind-${moment.kind}`} onClick={() => onJump(moment.move)}>
              <span className="rv-moment-head">
                <span className="rv-moment-title">{momentTitle(moment.kind)}</span>
                <span className="rv-moment-move">{upFirstWord(momentWhen(moment))}</span>
              </span>
              <span className="rv-moment-text">{momentCardText(moment, names, you)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "move 9" → "Move 9", "moves 5 to 7" → "Moves 5 to 7". */
function upFirstWord(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
