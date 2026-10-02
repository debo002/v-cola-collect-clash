import { PhoneIcon } from '../icons';

/** Pass-the-phone "look away" screen. Renders no cards — hidden info safe. */
export function PassScreen({
  passerName,
  receiverName,
  lookAway,
  passTo,
  imPlayer,
  showCards,
  onReveal,
}: {
  passerName: string;
  receiverName: string;
  lookAway: string;
  passTo: string;
  imPlayer: string;
  showCards: string;
  onReveal: () => void;
}) {
  return (
    <div className="lookaway" role="alert">
      <div className="lookaway-icon">
        <PhoneIcon size={48} />
      </div>
      <div className="lookaway-text">
        <strong>
          {passTo} {receiverName}
        </strong>
        <p>
          {passerName}, {lookAway} {receiverName}.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={(e) => {
            e.stopPropagation();
            onReveal();
          }}
        >
          {imPlayer} {receiverName} — {showCards}
        </button>
      </div>
    </div>
  );
}
