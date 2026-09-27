import { useEffect, useState } from 'react';
import { assetUrl } from './components/assetPaths';
import { addCopy, emptyCollection, removeCopy, type Collection } from './game/collection';
import { FLAVORS } from './game/cards';
import { loadCollection, saveCollection } from './storage/collectionStore';
import { loadDeck, saveDeck } from './storage/deckStore';
import type { FlavorId } from './game/types';
import { Collection as Inventory } from './screens/Collection';
import { Deck } from './screens/Deck';
import { Scan } from './screens/Scan';
import { QuickPlay } from './screens/QuickPlay';
import './App.css';

type Tab = 'play' | 'cards' | 'deck' | 'scan';

const LOGO = assetUrl('assets/cards/v7-logo.png');

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'cards', label: 'Cards' },
  { id: 'deck', label: 'Deck' },
  { id: 'scan', label: 'Scan' },
];

function App() {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [deck, setDeck] = useState<FlavorId[]>([]);
  const [tab, setTab] = useState<Tab>('play');

  useEffect(() => {
    loadCollection()
      .then(setCollection)
      .catch(() => setCollection(emptyCollection()));
    loadDeck()
      .then(setDeck)
      .catch(() => setDeck([]));
  }, []);

  function update(next: Collection) {
    setCollection(next);
    saveCollection(next).catch(() => {
      // Demo: persistence is best-effort; the game stays playable in memory.
    });
  }

  function updateDeck(picks: FlavorId[]) {
    setDeck(picks);
    saveDeck(picks).catch(() => {
      // Best-effort like the collection above.
    });
  }

  if (!collection) {
    return (
      <main className="demo">
        <p className="demo-note">Loading collection…</p>
      </main>
    );
  }

  return (
    <main className="demo">
      <header className="demo-head">
        <img src={LOGO} alt="V7 logo" className="demo-logo" />
        <div>
          <h1>V Cola: Collect &amp; Clash</h1>
          <p>Phase 1 demo — local pass-and-play</p>
        </div>
      </header>

      {tab === 'play' ? <QuickPlay collection={collection} deck={deck} /> : null}

      {tab === 'cards' ? (
        <Inventory
          collection={collection}
          onAdd={(id) => {
            try {
              update(addCopy(collection, id));
            } catch {
              // Unknown id — ignore demo taps for flavors outside the 11.
            }
          }}
          onRemove={(id) => update(removeCopy(collection, id))}
          onUnlockAll={() => {
            let next = emptyCollection();
            for (const flavor of FLAVORS) next = addCopy(next, flavor.id);
            update(next);
          }}
          onReset={() => update(emptyCollection())}
        />
      ) : null}

      {tab === 'deck' ? <Deck collection={collection} picks={deck} onChange={updateDeck} /> : null}

      {tab === 'scan' ? (
        <Scan collection={collection} onUnlock={(id) => update(addCopy(collection, id))} />
      ) : null}

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </main>
  );
}

export default App;
