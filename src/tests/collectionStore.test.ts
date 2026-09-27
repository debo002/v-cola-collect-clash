import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addCopy, emptyCollection, ownsFlavor } from '../game/collection';
import { clearCollection, loadCollection, saveCollection } from '../storage/collectionStore';

describe('collection IndexedDB store', () => {
  beforeEach(async () => {
    await clearCollection();
  });

  it('loads an empty collection when nothing was saved', async () => {
    const loaded = await loadCollection();
    expect(loaded).toEqual({});
    expect(ownsFlavor(loaded, 'v-cola')).toBe(false);
  });

  it('round-trips a collection through save and load', async () => {
    let c = emptyCollection();
    c = addCopy(c, 'v-cola');
    c = addCopy(c, 'blueberry');
    c = addCopy(c, 'blueberry');
    await saveCollection(c);
    expect(await loadCollection()).toEqual(c);
  });

  it('overwrites the previous save, not merges', async () => {
    await saveCollection(addCopy(emptyCollection(), 'v-cola'));
    await saveCollection(addCopy(emptyCollection(), 'pomegranate'));
    const loaded = await loadCollection();
    expect(ownsFlavor(loaded, 'pomegranate')).toBe(true);
    expect(ownsFlavor(loaded, 'v-cola')).toBe(false);
  });

  it('clear wipes back to empty', async () => {
    await saveCollection(addCopy(emptyCollection(), 'v-lemon'));
    await clearCollection();
    expect(await loadCollection()).toEqual({});
  });
});
