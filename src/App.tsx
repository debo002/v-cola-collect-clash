import { useEffect, useState } from 'react';
import { addCopy, type Collection } from './game/collection';
import { FLAVOR_IDS } from './game/cards';
import { clearCollection, loadCollection, saveCollection } from './storage/collectionStore';
import { loadDeck, saveDeck } from './storage/deckStore';
import { DEFAULT_PLAYERS, loadPlayers, savePlayers, type Players } from './storage/playersStore';
import type { FlavorId } from './game/types';
import { Deck } from './screens/Deck';
import { QuickPlay } from './screens/QuickPlay';
import { OnlinePlay } from './screens/OnlinePlay';
import { loadSession, type OnlineSession } from './net/sessionStore';
import { I18nProvider, useI18n } from './i18n';
import { Stage } from './components/Stage';
import './App.css';

type Tab = 'play' | 'deck' | 'online';

function MainApp() {
  const { isRTL, t } = useI18n();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [deck, setDeck] = useState<FlavorId[]>([]);
  const [players, setPlayers] = useState<Players>(DEFAULT_PLAYERS);
  const [tab, setTab] = useState<Tab>('play');
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [resumeSession, setResumeSession] = useState<OnlineSession | null>(null);
  const [matchActive, setMatchActive] = useState(false);

  useEffect(() => {
    loadCollection()
      .then(setCollection)
      .catch(() => setCollection({}));
    loadDeck()
      .then(setDeck)
      .catch(() => setDeck([]));
    loadPlayers()
      .then(setPlayers)
      .catch(() => setPlayers(DEFAULT_PLAYERS));
    loadSession()
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  function updateDeck(picks: FlavorId[]) {
    setDeck(picks);
    saveDeck(picks).catch(() => {});
  }

  function updatePlayers(next: Players) {
    setPlayers(next);
    savePlayers(next).catch(() => {});
  }

  async function handleResetCollection() {
    await clearCollection();
    setCollection({});
    setDeck([]);
    await saveDeck([]);
  }

  /** Starter pack: 1 copy of each flavor for empty collections. */
  function handleStarterPack() {
    const base = collection ?? {};
    const next = FLAVOR_IDS.reduce((acc, id) => addCopy(acc, id), base);
    setCollection(next);
    saveCollection(next).catch(() => {});
  }

  if (!collection) {
    return (
      <Stage>
        <main className={`demo${isRTL ? ' rtl' : ''}`}>
          <p className="demo-note">Loading collection…</p>
        </main>
      </Stage>
    );
  }

  // Active match renders its own stage (top bar + board); no web chrome.
  if (tab === 'online') {
    return (
      <main className={`demo${isRTL ? ' rtl' : ''}`}>
        <OnlinePlay
          key={resumeSession ? `${resumeSession.code}-${resumeSession.seat}` : 'fresh'}
          players={players}
          resumeSession={resumeSession}
          onExit={() => {
            setResumeSession(null);
            setTab('play');
            loadSession()
              .then(setSession)
              .catch(() => setSession(null));
          }}
        />
      </main>
    );
  }

  if (tab === 'play') {
    return (
      <main className={`demo${isRTL ? ' rtl' : ''}`}>
        {session !== null && !matchActive ? (
          <div className="rejoin-banner" role="status">
            <span>{t.onlineRejoin}</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setResumeSession(session);
                setTab('online');
              }}
            >
              {t.onlineRejoin}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Dismiss"
              onClick={() => setSession(null)}
            >
              ✕
            </button>
          </div>
        ) : null}
        <QuickPlay
          collection={collection}
          players={players}
          onPlayersChange={updatePlayers}
          onMatchActiveChange={setMatchActive}
          onOpenDeck={() => setTab('deck')}
          onPlayOnline={() => {
            setResumeSession(null);
            setTab('online');
          }}
        />
      </main>
    );
  }

  return (
    <main className={`demo${isRTL ? ' rtl' : ''}`}>
      <Stage>
        <Deck
          collection={collection}
          picks={deck}
          onChange={updateDeck}
          onResetCollection={handleResetCollection}
          onStarterPack={handleStarterPack}
          onBack={() => setTab('play')}
        />
      </Stage>
    </main>
  );
}

function App() {
  return (
    <I18nProvider>
      <MainApp />
    </I18nProvider>
  );
}

export default App;
