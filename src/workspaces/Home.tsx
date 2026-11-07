import { Icon } from '../components/Icons';
import { useI18n } from '../i18n';

function HeroOrbit() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <svg viewBox="0 0 440 360" className="orbit-svg">
        <defs>
          <radialGradient id="star-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e0fbff" />
            <stop offset="28%" stopColor="#7ce9ff" />
            <stop offset="62%" stopColor="#2f8df0" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="orbit-line" x1="0" x2="1">
            <stop offset="0" stopColor="#38d9ff" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#38d9ff" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <circle cx="220" cy="180" r="160" fill="url(#star-glow)" opacity="0.24" />
        <circle cx="220" cy="180" r="88" fill="url(#star-glow)" opacity="0.5" />
        <circle cx="220" cy="180" r="34" fill="url(#star-glow)" />
        <ellipse
          cx="220"
          cy="180"
          rx="155"
          ry="52"
          fill="none"
          stroke="url(#orbit-line)"
          strokeWidth="1.4"
          transform="rotate(-18 220 180)"
        />
        <ellipse
          cx="220"
          cy="180"
          rx="108"
          ry="36"
          fill="none"
          stroke="url(#orbit-line)"
          strokeWidth="1"
          strokeDasharray="3 6"
          transform="rotate(28 220 180)"
          opacity="0.7"
        />
        <circle cx="352" cy="122" r="7.5" fill="#fbbf24" />
        <circle cx="352" cy="122" r="14" fill="#fbbf24" opacity="0.16" />
        <circle cx="146" cy="238" r="4.6" fill="#a78bfa" />
        <circle cx="146" cy="238" r="10" fill="#a78bfa" opacity="0.16" />
        <circle cx="92" cy="102" r="1.6" fill="#e7edf9" opacity="0.8" />
        <circle cx="360" cy="268" r="1.3" fill="#e7edf9" opacity="0.65" />
        <circle cx="318" cy="56" r="1.8" fill="#7ce9ff" opacity="0.8" />
        <path
          d="M283 233c-20 7-51 8-73 0"
          fill="none"
          stroke="#38d9ff"
          strokeWidth="1.5"
          strokeDasharray="4 5"
          opacity="0.7"
        />
      </svg>
      <div className="hero-chips">
        <span>FITS · cubes</span>
        <span>BLS · trapezoid</span>
        <span>ADI · RDI</span>
        <span>5σ contrast</span>
      </div>
    </div>
  );
}

export function Home({
  onOpen,
  onDemo,
}: {
  onOpen: (view: 'transit' | 'imaging') => void;
  onDemo: (kind: 'transit' | 'imaging') => void;
}) {
  const { t } = useI18n();
  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Icon name="spark" size={15} /> {t('у браузері · без сервера · open source')}
          </span>
          <h1>
            {t('Полюйте на екзопланети')}
            <br />
            <span className="grad-text">{t('у власних зоряних кадрах')}</span>
          </h1>
          <p className="hero-lead">
            {t(
              'ExoScope — це повний конвеєр аналізу зоряних зображень: від FITS-кадрів до кандидатів у екзопланети. Транзитна фотометрія з BLS-пошуком періоду та пряме зображення з висококонтрастним ADI/RDI.',
            )}
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => onOpen('transit')}>
              <Icon name="transit" /> {t('Транзитна фотометрія')}
            </button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => onOpen('imaging')}>
              <Icon name="telescope" /> {t('Пряме зображення')}
            </button>
          </div>
          <div className="hero-demo-row">
            <span>{t('Спробувати без даних:')}</span>
            <button type="button" className="link-btn" onClick={() => onDemo('transit')}>
              {t('демо-транзит')} →
            </button>
            <button type="button" className="link-btn" onClick={() => onDemo('imaging')}>
              {t('демо-ADI')} →
            </button>
          </div>
          <div className="hero-facts">
            <div>
              <strong>100%</strong>
              <span>{t('локально у браузері')}</span>
            </div>
            <div>
              <strong>FITS + PNG</strong>
              <span>{t('куби NAXIS=3, 8–64 біт')}</span>
            </div>
            <div>
              <strong>2</strong>
              <span>{t('методи пошуку')}</span>
            </div>
          </div>
        </div>
        <HeroOrbit />
      </section>

      <section className="mode-grid">
        <article className="mode-card mode-transit">
          <div className="mode-head">
            <span className="mode-icon">
              <Icon name="transit" size={24} />
            </span>
            <div>
              <span className="mode-kicker">{t('Метод 1')}</span>
              <h2>{t('Транзитна фотометрія')}</h2>
            </div>
          </div>
          <p>
            {t(
              'Знайдіть періодичне затемнення зорі планетою. Від апертурної фотометрії та диференціальної кривої світла до BLS, фіту трапецією та веттингу хибнопозитивів.',
            )}
          </p>
          <ul className="check-list">
            <li>{t('Автоматичне вирівнювання кадрів і вибір зірок порівняння')}</li>
            <li>{t('BLS-пошук періоду, трапецієподібна модель, похибки параметрів')}</li>
            <li>{t('Odd–even, вторинний мінімум, зсув центроїда, red noise, блендинг')}</li>
          </ul>
          <div className="mode-actions">
            <button type="button" className="btn btn-primary" onClick={() => onOpen('transit')}>
              <Icon name="arrow" /> {t('Відкрити транзитний аналіз')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onDemo('transit')}>
              <Icon name="play" /> {t('Запустити демо')}
            </button>
          </div>
        </article>

        <article className="mode-card mode-imaging">
          <div className="mode-head">
            <span className="mode-icon">
              <Icon name="telescope" size={24} />
            </span>
            <div>
              <span className="mode-kicker">{t('Метод 2')}</span>
              <h2>{t('Пряме зображення')}</h2>
            </div>
          </div>
          <p>
            {t(
              'Відокремте світло планети від сяйва зорі. ADI/RDI-віднімання PSF, обертання поля, карта SNR, крива контрастності та пошук компаньйонів.',
            )}
          </p>
          <ul className="check-list">
            <li>{t('Медіанний PSF-референс, субпіксельне вирівнювання, ADI або RDI')}</li>
            <li>{t('Кути PARANG із заголовків або ручне обертання поля')}</li>
            <li>{t('Кандидати з SNR, контрастом, Δmag, відстанню та позиційним кутом')}</li>
          </ul>
          <div className="mode-actions">
            <button type="button" className="btn btn-primary" onClick={() => onOpen('imaging')}>
              <Icon name="arrow" /> {t('Відкрити аналіз зображень')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onDemo('imaging')}>
              <Icon name="play" /> {t('Запустити демо')}
            </button>
          </div>
        </article>
      </section>

      <section className="feature-section">
        <div className="section-head">
          <span className="eyebrow">
            <Icon name="layers" size={14} /> {t('Що всередині')}
          </span>
          <h2>{t('Максимум інструментів для аналізу зірок')}</h2>
          <p>
            {t(
              'Усе працює у браузері: жоден кадр не залишає ваш компʼютер. Результати можна експортувати у CSV, JSON, Markdown і PNG.',
            )}
          </p>
        </div>
        <div className="feature-grid">
          {[
            {
              icon: 'file' as const,
              title: t('FITS та куби'),
              text: t(
                '8/16/32-бітні цілі, 32/64-бітні дійсні, BSCALE/BZERO, багатоплощинні куби NAXIS=3, а також PNG/JPEG/WEBP.',
              ),
            },
            {
              icon: 'star' as const,
              title: t('Пошук і вимір зірок'),
              text: t(
                'Локальна карта фону, адаптивний поріг, звʼязні компоненти, субпіксельні центроїди, FWHM, елонгація та насичення.',
              ),
            },
            {
              icon: 'target' as const,
              title: t('Диференціальна фотометрія'),
              text: t(
                'Субпіксельні апертури, кільце неба, вирівнювання за зорями, ансамбль зірок порівняння, детрендинг і бінінг.',
              ),
            },
            {
              icon: 'chart' as const,
              title: t('BLS і транзитна модель'),
              text: t(
                'Пошук періоду та тривалості, локальне уточнення, MCMC-подібні похибки через чисельну коваріацію, SNRt, χ²/dof.',
              ),
            },
            {
              icon: 'shield' as const,
              title: t('Веттинг кандидатів'),
              text: t(
                'Перевірки парних/непарних транзитів, вторинного мінімуму, центроїда, червоного шуму, форми, насичення та блендингу.',
              ),
            },
            {
              icon: 'eye' as const,
              title: t('Високий контраст'),
              text: t(
                'ADI/RDI, карта SNR, радіальний шум, 1σ/5σ криві контрастності, автоматичний пошук точкових джерел.',
              ),
            },
          ].map((feature) => (
            <div className="feature" key={feature.title}>
              <span className="feature-icon">
                <Icon name={feature.icon} size={19} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flow-section">
        <div className="section-head">
          <span className="eyebrow">
            <Icon name="layers" size={14} /> {t('Робочий процес')}
          </span>
          <h2>{t('Три кроки від кадрів до кандидата')}</h2>
        </div>
        <div className="flow-grid">
          <div className="flow-step">
            <span className="flow-number">01</span>
            <h3>{t('Завантажте кадри')}</h3>
            <p>
              {t(
                'Перетягніть FITS-файли, куб або серію зображень. ExoScope визначить час, розмір і шкалу з заголовків.',
              )}
            </p>
          </div>
          <div className="flow-step">
            <span className="flow-number">02</span>
            <h3>{t('Запустіть конвеєр')}</h3>
            <p>
              {t(
                'Виберіть цільову зорю або центр системи. Фотометрія, BLS-пошук або ADI виконуються локально з прогресом.',
              )}
            </p>
          </div>
          <div className="flow-step">
            <span className="flow-number">03</span>
            <h3>{t('Перевірте та експортуйте')}</h3>
            <p>
              {t(
                'Перегляньте графіки, параметри, веттинг і контрастність. Збережіть звіт, криву світла та зображення.',
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="closing-grid">
        <div className="closing-card">
          <span className="closing-icon">
            <Icon name="shield" size={20} />
          </span>
          <div>
            <h3>{t('Приватність за замовчуванням')}</h3>
            <p>
              {t(
                'Жодних завантажень на сервер. Усі обчислення виконуються у вашому браузері; дані зникають після закриття вкладки.',
              )}
            </p>
          </div>
        </div>
        <div className="closing-card">
          <span className="closing-icon">
            <Icon name="info" size={20} />
          </span>
          <div>
            <h3>{t('Чесні обмеження')}</h3>
            <p>
              {t(
                'Набір до ~60 млн пікселів, кадри до 1536 px за найбільшою стороною (з бінінгом більших). Результати — кандидати, а не відкриття.',
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="disclaimer-strip">
        <Icon name="warn" size={17} />
        <p>
          {t(
            'ExoScope — інструмент для досліджень і навчання. Автоматичні кандидати потребують незалежного підтвердження, спектроскопії та перевірки на інструментальних артефактах.',
          )}
        </p>
      </section>
    </div>
  );
}
