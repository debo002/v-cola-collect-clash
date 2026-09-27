import { useEffect, useState } from 'react';
import { assetUrl } from './components/assetPaths';
import { addCopy, emptyCollection, removeCopy, type Collection } from './game/collection';
import { FLAVORS } from './game/cards';
import { loadCollection, saveCollection } from './storage/collectionStore';
import { Collection as CollectionScreen } from './screens/Collection';
import { QuickPlay } from './screens/QuickPlay';
import './App.css';

const LOGO = assetUrl('assets/cards/v7-logo.png');

function App() {
  const [collection, setCollection] = useState<Collection | null>(null);

  useEffect(() => {
    loadCollection()
      .then(setCollection)
      .catch(() => setCollection(emptyCollection()));
  }, []);

  function update(next: Collection) {
    setCollection(next);
    saveCollection(next).catch(() => {
      // Demo: persistence is best-effort; the game stays playable in memory.
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

      <CollectionScreen
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

      <QuickPlay collection={collection} />
    </main>
  );
}

export default App;
