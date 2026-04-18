import type { Metadata } from 'next';
import Image from 'next/image';
import './about.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export const metadata: Metadata = {
  title: 'Sobre LeagueScope — Quiénes somos',
  description:
    'LeagueScope es una plataforma gratuita, sin anuncios y 100% solidaria de estadísticas de League of Legends esports. Conoce nuestra historia, misión y cómo puedes apoyar.',
  alternates: { canonical: `${SITE}/about` },
  openGraph: {
    title: 'Sobre LeagueScope',
    description:
      'Estadísticas de LoL esports gratuitas, sin anuncios y 100% solidarias. Conoce el proyecto.',
    url: `${SITE}/about`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Sobre LeagueScope',
    description:
      'Estadísticas de LoL esports gratuitas, sin anuncios y 100% solidarias.',
  },
};

export default function AboutPage() {
  return (
    <div className="abt">

      {/* ---- HERO ---- */}
      <header className="abt-hero">
        <Image
          src="/LeagueScope_Logo.png"
          alt="LeagueScope logo"
          className="abt-logo"
          width={200}
          height={200}
        />
        <h1>LeagueScope</h1>
        <p className="abt-claim">
          La plataforma de estadísticas de League of Legends más completa
          en español.
        </p>
        <p className="abt-tagline">
          Gratuita &middot; Sin anuncios &middot; Sin paywalls &middot; 100%
          solidaria
        </p>
      </header>

      {/* ---- BODY ---- */}
      <article className="abt-body">

        {/* -- Historia -- */}
        <section>
          <h2>La historia detrás</h2>
          <p>
            LeagueScope nace de una idea muy simple: una web que ofrezca toda
            la información posible de forma clara, concisa y sin anuncios ni
            paywalls. Busqué algo así y no lo encontré. Así que me puse a
            construirlo.
          </p>
          <p>
            Lo que empezó como un proyecto personal para entender mejor mis
            ligas favoritas se fue haciendo grande a base de fines de semana.
            Hoy LeagueScope cubre más de 20 competiciones activas y, sumando
            ligas extintas, fusiones, showmatches y torneos internacionales,
            supera los <strong>80 campeonatos procesados y las 72.000 partidas
            analizadas</strong>. Y sigue creciendo.
          </p>
        </section>

        {/* -- Para quién -- */}
        <section>
          <h2>Para quién es</h2>
          <p>Para ti.</p>
          <p>
            Si eres de los que se pone el LCK a las 10 de la mañana, esto es
            para ti. Si haces vídeos y necesitas un dato concreto sin tener
            que pelearte con mil filtros, esto es para ti. Si estás preparando
            un cast y quieres comparar dos rosters rápido, esto es para ti. Y
            si simplemente quieres entender por qué tu equipo pierde siempre
            en el side rojo, también.
          </p>
          <p>No hace falta ser analista. Solo que te guste el juego.</p>
        </section>

        {/* -- Qué ofrecemos -- */}
        <section>
          <h2>Qué puedes encontrar aquí</h2>
          <p>
            No es una web llena de tablas por llenar tablas. Cada herramienta
            nació porque yo mismo la necesitaba en algún momento.
          </p>

          <h3>Explorar una liga</h3>
          <ul>
            <li>
              <strong>Overview</strong> &mdash; El pulso de la temporada: meta,
              rankings y cómo está yendo cada lado del mapa.
            </li>
            <li>
              <strong>Standings avanzados</strong> &mdash; Clasificación con 11
              bloques de métricas (early, mid, late, daño, economía, visión,
              objetivos). Lo que las clasificaciones oficiales no te cuentan.
            </li>
            <li>
              <strong>Filtros por fase</strong> &mdash; Regular Season,
              Playoffs o temporada completa.
            </li>
          </ul>

          <h3>Perfiles en profundidad</h3>
          <ul>
            <li>
              <strong>Equipo</strong> &mdash; Roster, historial, champion pool,
              prioridad de draft y oro acumulado.
            </li>
            <li>
              <strong>Jugador</strong> &mdash; Stats completas, campeones,
              match log con builds y runas, y toda su carrera.
            </li>
            <li>
              <strong>Campeón</strong> &mdash; Matchups, items, keystones,
              desglose por parche y los jugadores que más lo petan con él.
            </li>
          </ul>

          <h3>Comparar y analizar</h3>
          <ul>
            <li>
              <strong>Head-to-Head</strong> &mdash; Hasta 4 equipos o jugadores
              comparados lado a lado.
            </li>
            <li>
              <strong>Record de partida</strong> &mdash; Builds, timeline, gold
              graph y draft, todo en una.
            </li>
          </ul>

          <h3>Memoria histórica</h3>
          <ul>
            <li>
              <strong>Archivo desde 2014</strong> &mdash; Palmarés de jugadores,
              equipos y campeones de toda la historia competitiva.
            </li>
          </ul>
        </section>

        {/* -- Ligas -- */}
        <section>
          <h2>+80 competiciones cubiertas</h2>
          <p>
            <strong>Las principales.</strong> LCK, LPL, LEC y LCS, más el
            bloque emergente: CBLOL, LCP, VCS, LJL y TCL.
          </p>
          <p>
            <strong>Ligas de desarrollo.</strong> Donde se forja el talento:
            LCK CL, NA CL y EMEA Masters, con los mejores equipos de cada
            región luchando por el ascenso.
          </p>
          <p>
            <strong>Torneos internacionales.</strong> First Stand, MSI, Worlds
            y EWC.
          </p>
          <p>
            <strong>Ligas regionales.</strong> LFL, PRM, LES, NLC, LIT, EBL y
            Road of Legends, entre otras.
          </p>
          <p>
            <strong>Archivo histórico.</strong> Ligas ya extintas como EU LCS,
            NA LCS, LMS, PCS y LLA, que nos dejaron momentos inolvidables y
            hoy siguen vivas bajo otro nombre.
          </p>
        </section>

        {/* -- Compromiso solidario -- */}
        <section className="abt-solidario">
          <h2>Por qué es solidario</h2>
          <p>Aquí está la parte que más me importa.</p>
          <p>
            LeagueScope no tiene ánimo de lucro. Punto. Mantener la API, el
            hosting y el dominio cuesta unos <strong>900&#8364; al mes</strong>,
            y eso es todo lo que el proyecto necesita para seguir vivo.
          </p>
          <p>
            Cada euro que entre por encima de esa cifra va íntegro a la{' '}
            <strong>AECC</strong> (Asociación Española Contra el Cáncer). Cada
            mes publicaré un desglose claro de ingresos, gastos y donación:
            nada escondido, nada maquillado.
          </p>
        </section>

        {/* -- Cómo apoyar -- */}
        <section>
          <h2>Cómo puedes ayudar</h2>
          <p>
            Apoyar el proyecto no implica pagar por nada. La web seguirá siendo
            gratis para todo el mundo, con o sin suscripción. Pero si quieres
            echar una mano, hay formas.
          </p>

          <h3>Suscripciones individuales</h3>
          <div className="abt-tiers">
            <div className="abt-tier">
              <div className="abt-tier-top">
                <span className="abt-tier-name">Supporter</span>
                <span className="abt-tier-price">
                  5&#8364;<small>/mes</small>
                </span>
              </div>
              <div className="abt-tier-body">
                Tu nombre en el Wall of Fame, acceso al canal de la comunidad
                y voto en las próximas funcionalidades.
              </div>
            </div>
            <div className="abt-tier abt-tier-open">
              <div className="abt-tier-top">
                <span className="abt-tier-name">Libre</span>
                <span className="abt-tier-price">Tú decides</span>
              </div>
              <div className="abt-tier-body">
                Si los 5&#8364; no te encajan, cada euro será bienvenido. Suma
                para el proyecto y para la <strong>AECC</strong>, y te da los
                mismos beneficios que el tier Supporter.
              </div>
            </div>
          </div>

          <div className="abt-cta">
            <a href="#" className="abt-btn abt-btn-primary">
              Donación vía PayPal
            </a>
          </div>

          <h3>Colaboraciones con equipos</h3>
          <p>
            Si eres un equipo u organización y quieres apoyar, serás bienvenido
            con los brazos abiertos. Haré mención en los reportes mensuales y
            en redes.
          </p>
          <p>
            Lo único que pido: que la aportación no condicione la neutralidad
            ni la ausencia de publicidad en la web. Eso es innegociable.
          </p>

          <div className="abt-cta">
            <a href="mailto:contact@leaguescope.com" className="abt-btn">
              Contáctanos para colaborar
            </a>
          </div>
        </section>

        {/* -- Roadmap -- */}
        <section>
          <h2>Qué viene después</h2>
          <p>
            <strong>Fase actual &mdash; hecho.</strong> Ligas principales,
            regionales, showmatches y filtros por año, split y fase.
          </p>
          <p>
            <strong>Próximamente.</strong> Datos en tiempo real durante las
            partidas en curso, perfiles de usuario con tus equipos y jugadores
            favoritos guardados, y herramientas más avanzadas para escarbar en
            cada partida.
          </p>
          <p>
            <strong>A medio-largo plazo.</strong> Modelos predictivos, app
            móvil (iOS y Android) y cobertura de torneos amateur.
          </p>
          <p>No hay fechas prometidas. Solo la promesa de seguir trabajándolo.</p>
        </section>

        {/* -- Wall of Fame -- */}
        <section>
          <h2>Wall of Fame</h2>
          <div className="abt-wall">
            Aquí aparecerán los nombres de quienes apoyen el proyecto.
            <br />
            <strong>Puedes ser el primero.</strong>
          </div>
        </section>

        {/* -- Contacto -- */}
        <section className="abt-contact">
          <h2>Hablemos</h2>
          <p>
            Sugerencias, errores, ideas locas o simplemente ganas de hablar de
            esports: aquí estoy.
          </p>
          <div className="abt-links">
            <a href="https://www.instagram.com/leaguescope?igsh=eGw4ZTJ1M2hzNmRt" target="_blank" rel="noopener noreferrer" aria-label="Instagram de LeagueScope" className="abt-social-link">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0z" fill="#E4405F"/>
                <path d="M12 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8z" fill="#E4405F"/>
                <circle cx="18.406" cy="5.594" r="1.44" fill="#E4405F"/>
              </svg>
              Instagram
            </a>
            <a href="https://x.com/LeagueScope" target="_blank" rel="noopener noreferrer" aria-label="Twitter / X de LeagueScope" className="abt-social-link">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Twitter / X
            </a>
            <a href="https://discord.gg/zn2NW4E4" target="_blank" rel="noopener noreferrer" aria-label="Discord de LeagueScope" className="abt-social-link">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#5865F2" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Discord
            </a>
            <a href="mailto:contact@leaguescope.com" className="abt-social-link">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
              contact@leaguescope.com
            </a>
          </div>
        </section>

        {/* -- Footer personal -- */}
        <footer className="abt-footer">
          <p className="abt-quote">
            Hagas lo que hagas, disfruta de ello. Que nadie ni nada te diga
            cómo debes vivir tu vida.
          </p>
          <span>LeagueScope &mdash; 2026</span>
        </footer>

      </article>
    </div>
  );
}
