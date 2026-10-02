import { useEffect, useState } from 'react';
import { addCopy, type Collection } from './game/collection';
import { FLAVOR_IDS } from './game/cards';
import { clearCollection, loadCollection, saveCollection } from './storage/collectionStore';
import { loadDeck, saveDeck } from './storage/deckStore';
import { DEFAULT_PLAYERS, loadPlayers, savePlayers, type Players } from './storage/playersStore';
import type { FlavorId } from './game/types';
import { Deck } from './screens/Deck';
import { QuickPlay } from './screens/QuickPlay';
import { I18nProvider, useI18n } from './i18n';
import { Stage } from './components/Stage';
import './App.css';

type Tab = 'play' | 'deck';

function MainApp() {
  const { isRTL } = useI18n();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [deck, setDeck] = useState<FlavorId[]>([]);
  const [players, setPlayers] = useState<Players>(DEFAULT_PLAYERS);
  const [tab, setTab] = useState<Tab>('play');

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
  if (tab === 'play') {
    return (
      <main className={`demo${isRTL ? ' rtl' : ''}`}>
        <QuickPlay
          collection={collection}
          players={players}
          onPlayersChange={updatePlayers}
          onOpenDeck={() => setTab('deck')}
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
