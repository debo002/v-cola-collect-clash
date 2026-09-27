import { FLAVORS } from './game/cards';
import { ZONES } from './game/zones';
import { FlavorCard } from './components/FlavorCard';
import { assetUrl } from './components/assetPaths';
import './App.css';

const LOGO = assetUrl('assets/cards/v7-logo.png');

function App() {
  return (
    <main className="demo">
      <header className="demo-head">
        <img src={LOGO} alt="V7 logo" className="demo-logo" />
        <div>
          <h1>V Cola: Collect &amp; Clash</h1>
          <p>Phase 1 demo — real cans, placeholder chrome</p>
        </div>
      </header>

      <section aria-label="Collection">
        <h2>Collection — {FLAVORS.length} flavors</h2>
        <div className="card-grid">
          {FLAVORS.map((flavor) => (
            <FlavorCard key={flavor.id} flavor={flavor} />
          ))}
        </div>
      </section>

      <section aria-label="Zones">
        <h2>Zones</h2>
        <div className="zone-list">
          {ZONES.map((zone) => (
            <div key={zone.id} className={`zone zone-${zone.id}`}>
              <strong>{zone.name}</strong>
              <span>{zone.tagline}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Hidden card">
        <h2>Hidden card</h2>
        <div className="card card-back" aria-label="Hidden card placeholder">
          <img src={LOGO} alt="" aria-hidden="true" />
          <span aria-hidden="true">?</span>
        </div>
        <p className="demo-note">Pass-and-play reveal placeholder — final back art later.</p>
      </section>
    </main>
  );
}

export default App;
