import { useEffect, useState } from 'react';
import { Icon } from './components/Icons';
import { LanguageToggle, useI18n } from './i18n';
import { Home } from './workspaces/Home';
import { TransitWorkspace } from './workspaces/TransitWorkspace';
import { ImagingWorkspace } from './workspaces/ImagingWorkspace';
import { About } from './workspaces/About';

type View = 'home' | 'transit' | 'imaging' | 'about';

export interface DemoSignal {
  kind: 'transit' | 'imaging';
  nonce: number;
}

export default function App() {
  const { t } = useI18n();
  const [view, setView] = useState<View>('home');
  const [demoSignal, setDemoSignal] = useState<DemoSignal | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  const open = (next: View) => setView(next);
  const startDemo = (kind: 'transit' | 'imaging') => {
    setDemoSignal({ kind, nonce: Date.now() });
    setView(kind === 'transit' ? 'transit' : 'imaging');
  };

  const tabs: Array<{ id: View; label: string; icon: 'planet' | 'transit' | 'telescope' | 'info' }> = [
    { id: 'home', label: t('Головна'), icon: 'planet' },
    { id: 'transit', label: t('Транзити'), icon: 'transit' },
    { id: 'imaging', label: t('Пряме зображення'), icon: 'telescope' },
    { id: 'about', label: t('Документація'), icon: 'info' },
  ];

  return (
    <div className="app-shell">
      <div className="bg-stars" aria-hidden="true" />
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => open('home')}>
            <span className="brand-mark">
              <Icon name="planet" size={24} />
            </span>
            <span className="brand-text">
              <strong>ExoScope</strong>
              <small>{t('полювання на екзопланети')}</small>
            </span>
          </button>
          <nav className="nav-tabs" aria-label="Main">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={`nav-tab ${view === tab.id ? 'is-active' : ''}`}
                onClick={() => open(tab.id)}
              >
                <Icon name={tab.icon} size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="local-pill">
              <span className="pulse-dot" /> {t('локально')}
            </span>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="app-main">
        <div hidden={view !== 'transit'}>
          <TransitWorkspace demoSignal={demoSignal?.kind === 'transit' ? demoSignal : null} />
        </div>
        <div hidden={view !== 'imaging'}>
          <ImagingWorkspace demoSignal={demoSignal?.kind === 'imaging' ? demoSignal : null} />
        </div>
        {view === 'home' && <Home onOpen={open} onDemo={startDemo} />}
        {view === 'about' && <About />}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="brand-mark small">
              <Icon name="planet" size={18} />
            </span>
            <div>
              <strong>ExoScope</strong>
              <p>
                {t(
                  'Браузерний конвеєр для пошуку екзопланет транзитним методом і методом прямого зображення.',
                )}
              </p>
            </div>
          </div>
          <div className="footer-meta">
            <span>MIT License</span>
            <span>React · TypeScript · esbuild</span>
            <span>{t('Дані не залишають ваш пристрій')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
