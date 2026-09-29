import { useEffect, useState } from 'react';
import { assetUrl } from './components/assetPaths';
import type { Collection } from './game/collection';
import { clearCollection, loadCollection } from './storage/collectionStore';
import { loadDeck, saveDeck } from './storage/deckStore';
import { DEFAULT_PLAYERS, loadPlayers, savePlayers, type Players } from './storage/playersStore';
import type { FlavorId } from './game/types';
import { Deck } from './screens/Deck';
import { QuickPlay } from './screens/QuickPlay';
import { I18nProvider, useI18n } from './i18n';
import './App.css';

type Tab = 'play' | 'deck';

const LOGO = assetUrl('assets/cards/v7-logo.png');

function MainApp() {
  const { lang, setLang, t, isRTL } = useI18n();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [deck, setDeck] = useState<FlavorId[]>([]);
  const [players, setPlayers] = useState<Players>(DEFAULT_PLAYERS);
  const [tab, setTab] = useState<Tab>('play');
  const [isMatchActive, setIsMatchActive] = useState(false);

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

  if (!collection) {
    return (
      <main className="demo">
        <p className="demo-note">Loading collection…</p>
      </main>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'play', label: t.tabPlay },
    { id: 'deck', label: t.tabDeck },
  ];

  return (
    <main className={`demo${isRTL ? ' rtl' : ''}`}>
      {/* Top App Header (Hidden during active match to keep full game immersion) */}
      {!isMatchActive && (
        <header className="demo-head">
          <img src={LOGO} alt="V7 logo" className="demo-logo" />
          <div className="demo-head-text">
            <h1>{t.appTitle}</h1>
            <p>{t.appSubtitle}</p>
          </div>
          <div className="lang-switcher">
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
        </header>
      )}

      {tab === 'play' ? (
        <QuickPlay
          collection={collection}
          players={players}
          onPlayersChange={updatePlayers}
          onMatchActiveChange={setIsMatchActive}
        />
      ) : null}

      {tab === 'deck' ? (
        <Deck
          collection={collection}
          picks={deck}
          onChange={updateDeck}
          onResetCollection={handleResetCollection}
        />
      ) : null}

      {/* Hide bottom navigation mid-match! */}
      {!isMatchActive && (
        <nav className="tabbar" aria-label="Main">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              className={tab === tabItem.id ? 'active' : ''}
              aria-current={tab === tabItem.id ? 'page' : undefined}
              onClick={() => setTab(tabItem.id)}
            >
              {tabItem.label}
            </button>
          ))}
        </nav>
      )}
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
