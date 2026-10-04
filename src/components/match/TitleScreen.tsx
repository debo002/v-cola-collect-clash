import { assetUrl } from '../assetPaths';
import { useI18n } from '../../i18n';
import type { Players } from '../../storage/playersStore';
import { DeckIcon, PlayIcon } from '../icons';
import { QuickGuide } from '../QuickGuide';

/**
 * Title screen: logo, Play, Deck, language toggle, compact player setup.
 * Replaces the old card/form menu + web chrome (no header, no tab bar).
 */

/** Fullscreen toggle (only rendered where the Fullscreen API is available). */
function FullscreenButton({ label }: { label: string }) {
  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary title-fullscreen"
      onClick={() => {
        document.documentElement.requestFullscreen().catch(() => {});
      }}
    >
      {label}
    </button>
  );
}
export function TitleScreen({
  players,
  onPlayersChange,
  onPlay,
  onOpenDeck,
  onCustomGame,
  onPlayOnline,
}: {
  players: Players;
  onPlayersChange: (players: Players) => void;
  onPlay: () => void;
  onOpenDeck: () => void;
  onCustomGame: () => void;
  onPlayOnline?: () => void;
}) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="title-screen">
      <FullscreenButton label={t.fullscreen} />
      <div className="title-brand">
        <img src={assetUrl('assets/cards/v7-logo.png')} alt="V7 Logo" className="title-logo" />
        <div className="title-headings">
          <h1 className="title-game">{t.appTitle}</h1>
          <p className="title-sub">{t.arenaSubtitle}</p>
          <div className="arena-brand-badge">
            <span className="brand-origin">من مصر للعالم</span>
            <span className="brand-dot">•</span>
            <span className="brand-claim">100% Natural • Vitamins &amp; Taste</span>
          </div>
        </div>
      </div>

      <div className="title-actions">
        <button type="button" className="btn btn-primary btn-xl" onClick={onPlay}>
          <PlayIcon size={22} />
          {t.quickPlayBtn}
        </button>
        <button type="button" className="btn btn-secondary btn-xl" onClick={onOpenDeck}>
          <DeckIcon size={22} />
          {t.tabDeck}
        </button>
        <button type="button" className="btn btn-secondary btn-xl" onClick={onCustomGame}>
          {t.customGame}
        </button>
        {onPlayOnline ? (
          <button type="button" className="btn btn-secondary btn-xl" onClick={onPlayOnline}>
            {t.playOnline}
          </button>
        ) : null}
        <QuickGuide menu />
        <div className="lang-switcher" role="group" aria-label="Language">
          <button
            type="button"
            className={`lang-btn${lang === 'en' ? ' active' : ''}`}
            onClick={() => setLang('en')}
            title="English"
          >
            EN
          </button>
          <span className="lang-divider">|</span>
          <button
            type="button"
            className={`lang-btn${lang === 'ar' ? ' active' : ''}`}
            onClick={() => setLang('ar')}
            title="العربية"
          >
            عربي
          </button>
        </div>
      </div>

      <div className="title-players">
        <label>
          {t.player1Name}
          <input
            value={players.p1}
            maxLength={12}
            onChange={(e) => onPlayersChange({ ...players, p1: e.target.value })}
            placeholder="Player 1"
          />
        </label>
        <label>
          {t.player2Name}
          <input
            value={players.p2}
            maxLength={12}
            onChange={(e) => onPlayersChange({ ...players, p2: e.target.value })}
            placeholder="Player 2"
          />
        </label>
      </div>
    </div>
  );
}
