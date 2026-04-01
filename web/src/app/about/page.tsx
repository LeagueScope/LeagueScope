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
            LeagueScope nace de una obsesión muy simple: querer saber
            <em> todo</em> sobre las partidas competitivas de League of Legends.
            Después de años buscando una web que ofreciera información clara,
            concisa y no intrusiva, pensamos: &laquo;¿Y si lo hacemos nosotros,
            y además lo hacemos gratis?&raquo;
          </p>
          <p>
            Así empezó este proyecto, un proyecto personal que se convirtió en
            algo mucho más grande de lo que en un principio concebimos.
            Actualmente, cubrimos más de 80 competiciones profesionales en todo
            el mundo, con datos históricos que se remontan a 2014 y más de
            72.000 partidas analizadas.
          </p>
        </section>

        {/* -- Para quién -- */}
        <section>
          <h2>Para quién es</h2>
          <p>
            Para ti, si estás leyendo esto. Da igual si eres un fan que quiere
            saber cómo le fue a su equipo, un creador de contenido que necesita
            estadísticas fiables para su próximo vídeo o un analista preparando
            la retransmisión del fin de semana.
          </p>
          <p>
            LeagueScope está pensada para cualquier persona que disfrute del
            League of Legends competitivo y quiera entenderlo un poco mejor.
          </p>
        </section>

        {/* -- Qué ofrecemos -- */}
        <section>
          <h2>Qué puedes encontrar aquí</h2>
          <p>
            No son solo estadísticas, es un conjunto de herramientas de análisis
            basadas en datos oficiales de partidas competitivas:
          </p>
          <ul>
            <li>
              <strong>Overview por liga</strong> &mdash; Resumen de temporada
              con meta snapshot, rankings y distribución de resultados por lado.
            </li>
            <li>
              <strong>Standings avanzados</strong> &mdash; Clasificación con 11
              grupos de métricas: early, mid, late game, daño, economía, visión
              y objetivos.
            </li>
            <li>
              <strong>Perfiles de equipo</strong> &mdash; Roster, historial de
              partidas, champion pool, prioridad de draft y diferencial de oro.
            </li>
            <li>
              <strong>Perfiles de jugador</strong> &mdash; Stats completas,
              campeones jugados, match log con builds y runas, y carrera
              histórica.
            </li>
            <li>
              <strong>Perfiles de campeón</strong> &mdash; Matchups, items,
              keystones, desglose por parche y jugadores destacados.
            </li>
            <li>
              <strong>Head-to-Head</strong> &mdash; Compara hasta 4 equipos o
              jugadores con todos los datos lado a lado.
            </li>
            <li>
              <strong>Record y partidas</strong> &mdash; Detalle de builds,
              timeline, gold graph y picks/bans de cada partida.
            </li>
            <li>
              <strong>Filtros por fase</strong> &mdash; Regular Season,
              Playoffs o temporada completa.
            </li>
            <li>
              <strong>Datos históricos</strong> &mdash; Palmarés de jugadores,
              equipos y campeones desde 2014 hasta hoy.
            </li>
          </ul>
        </section>

        {/* -- Ligas -- */}
        <section>
          <h2>+80 competiciones cubiertas</h2>
          <p>
            Las 4 grandes &mdash;LCK, LPL, LEC y LCS&mdash; junto con CBLOL,
            LCP, VCS, LJL y TCL como ligas mayores, ligas de desarrollo como la
            LCK CL, NA CL o EMEA Masters.
          </p>
          <p>
            Ligas regionales como LFL, PRM, LES, NLC, LIT, EBL y Road of
            Legends.
          </p>
          <p>
            Los 3 torneos internacionales más importantes: First Stand, MSI y
            Worlds.
          </p>
          <p>
            Y un archivo extenso de ligas ya extintas: EU LCS, NA LCS, LMS,
            PCS, LLA entre otras muchas más.
          </p>
        </section>

        {/* -- Compromiso solidario -- */}
        <section className="abt-solidario">
          <h2>Por qué es solidario</h2>
          <p>
            Aquí viene la parte que más nos importa. LeagueScope es un proyecto
            completamente sin ánimo de lucro. Actualmente mantener el acceso a
            la API, hosting y dominio cuesta alrededor de
            1.000&#8364; al mes.
          </p>
          <p>
            Todo, absolutamente todo, lo que se recaude por encima de esa cifra
            se donará íntegramente a la <strong>AECC</strong> (Asociación
            Española Contra el Cáncer). Cada mes se publicará un desglose
            transparente de ingresos, gastos y el importe de la donación.
          </p>
          <p>
            Apoyar LeagueScope no es solo mantener una web de estadísticas. Es
            contribuir directamente a la lucha contra el cáncer. Y eso da
            sentido a cada línea de código que se escribe.
          </p>
        </section>

        {/* -- Cómo apoyar -- */}
        <section>
          <h2>Cómo puedes ayudar</h2>
          <p>
            Hay varias formas de contribuir. Como anteriormente se ha comentado,
            todas las aportaciones irán destinadas a cubrir costes operativos, y
            el excedente va directamente a la <strong>AECC</strong>. La web
            sigue siendo 100% gratuita para todos, con o sin suscripción.
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
                Nombre en el Wall of Fame. Acceso al canal de la comunidad.
                Voto en sugerencias y nuevas funcionalidades.
              </div>
            </div>
            <div className="abt-tier abt-tier-open">
              <div className="abt-tier-top">
                <span className="abt-tier-name">Libre</span>
                <span className="abt-tier-price">Tu decides</span>
              </div>
              <div className="abt-tier-body">
                Elige la cantidad con la que te sientas cómodo. Cada euro cuenta
                para el proyecto y para contribuir y apoyar a la <strong>AECC</strong>.
                Dispondrás de los mismos beneficios que la suscripción Supporter.
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
            LeagueScope daría la bienvenida a cualquier equipo u organización
            del mundo de los esports que apoye el proyecto, ya sea de forma
            directa o indirecta. En cada reporte mensual y en nuestras redes se
            hará mención a los equipos que colaboren. Toda aportación no deberá
            influir en publicidad u otros elementos que puedan afectar al
            propósito original de la web.
          </p>

          <div className="abt-cta">
            <a href="#" className="abt-btn">
              Contáctanos para colaborar
            </a>
          </div>
        </section>

        {/* -- Roadmap -- */}
        <section>
          <h2>Qué viene después</h2>
          <p>
            LeagueScope está en desarrollo activo. La primera fase ya está
            completada: cubrir las principales ligas junto a showmatches, ligas
            regionales y más. Se han aplicado los filtros por año, temporada y
            fase para indagar todavía más en estos torneos.
          </p>
          <p>
            Lo que viene: datos en tiempo real durante las partidas en curso,
            perfiles de usuario con tus equipos y jugadores favoritos y
            herramientas avanzadas para indagar todavía más en los datos de cada
            partida.
          </p>
          <p>
            A largo plazo trabajaremos en incorporar modelos predictivos, una
            app móvil nativa tanto en iOS como Android y ampliar la cobertura a
            torneos amateur entre otros.
          </p>
        </section>

        {/* -- Wall of Fame -- */}
        <section>
          <h2>Wall of Fame</h2>
          <div className="abt-wall">
            Aquí aparecerán los nombres de quienes apoyan el proyecto.
            <br />
            <strong>Sé el primero en aparecer aquí.</strong>
          </div>
        </section>

        {/* -- Contacto -- */}
        <section className="abt-contact">
          <h2>Hablemos</h2>
          <p>
            Sugerencias, posibles errores, ideas locas que tengas en mente o
            simplemente ganas de charlar sobre esports. Estamos aquí:
          </p>
          <div className="abt-links">
            <a href="#" aria-label="Discord de LeagueScope">Discord</a>
            <a href="#" aria-label="Twitter / X de LeagueScope">Twitter / X</a>
            <a href="mailto:contacto@leaguescope.com">
              contacto@leaguescope.com
            </a>
          </div>
        </section>

        {/* -- Footer personal -- */}
        <footer className="abt-footer">
          <p className="abt-quote">
            Hagas lo que hagas, disfruta de ello, que nadie ni nada te diga
            cómo debes disfrutar de tu vida.
          </p>
          <span>LeagueScope &mdash; 2024-2026</span>
        </footer>

      </article>
    </div>
  );
}
