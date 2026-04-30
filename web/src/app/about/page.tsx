import type { Metadata } from 'next';
import Image from 'next/image';
import './about.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export const metadata: Metadata = {
  title: 'Sobre LeagueScope, Quiénes somos',
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

      {/* ============================================================
          HERO
         ============================================================ */}
      <header className="abt-hero">
        <div className="abt-hero-eyebrow">Sobre el proyecto</div>
        <Image
          src="/LeagueScope_Logo.png"
          alt="LeagueScope logo"
          className="abt-logo"
          width={200}
          height={200}
        />
        <h1>LeagueScope</h1>
        <p className="abt-claim">
          La plataforma de estadísticas de League of Legends esports más
          completa en español.
        </p>
        <p className="abt-tagline">
          Gratuita &middot; Sin anuncios &middot; Sin paywalls &middot;
          100% solidaria
        </p>

        <div className="abt-hero-meta">
          <span><strong>+80</strong> campeonatos</span>
          <span><strong>+72.000</strong> partidas</span>
          <span><strong>2014-2026</strong> archivo</span>
        </div>
      </header>

      {/* ============================================================
          LEAD, Magazine-style opening
         ============================================================ */}
      <section className="abt-lead">
        <p>
          LeagueScope es un proyecto independiente sin ánimo de lucro. No
          tiene inversores, no vende datos, no muestra anuncios y no esconde
          nada detrás de una suscripción. Su única misión: reunir en un solo
          sitio, en castellano y sin condiciones, toda la información del
          esport de League of Legends.
        </p>
      </section>

      {/* ============================================================
          BODY
         ============================================================ */}
      <article className="abt-body">

        {/* -- 01 ORIGEN -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">01</span> Origen
          </div>
          <h2>Cómo empezó todo</h2>

          <p className="abt-dropcap">
            L eagueScope nació de una idea muy concreta: que toda la
            información de las ligas profesionales de League of Legends
            pudiera estar en un único sitio, en castellano, organizada con
            la misma profundidad para todas las regiones y accesible sin
            condiciones.
          </p>

          <p>
            Lo que empezó como un cuaderno personal de fin de semana acabó
            convertido en una API, una base de datos con varios millones de
            filas, un frontend en producción y un dominio propio. Hoy la
            plataforma cubre <strong>más de veinte competiciones
            activas</strong> y, sumando ligas extintas, fusiones, showmatches
            y torneos internacionales, supera los <strong>ochenta campeonatos
            procesados y las setenta y dos mil partidas analizadas</strong>.
            Y sigue creciendo cada semana.
          </p>

          <blockquote className="abt-pull">
            Sin oficina. Solo un proyecto, muchas horas de
            trabajo y la convicción de que los datos del esport que nos
            gusta deberían estar al alcance de cualquier aficionado.
          </blockquote>
        </section>

        {/* -- 02 MANIFIESTO -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">02</span> Manifiesto
          </div>
          <h2>En qué creo, y qué no haré nunca</h2>

          <p>
            Antes de explicar qué hace LeagueScope, conviene dejar claro qué
            nunca va a hacer. Estos son los principios sobre los que se
            sostiene el proyecto y la línea roja que no se cruza, pase lo
            que pase.
          </p>

          <ol className="abt-principles">
            <li className="abt-principle">
              <span className="abt-principle-num">I</span>
              <div className="abt-principle-body">
                <h3>Información antes que monetización</h3>
                <p>
                  Cada herramienta nace porque alguien la necesita, no porque
                  genere engagement. No habrá funciones bloqueadas, no habrá
                  un tier premium con datos exclusivos, no habrá vídeos
                  reproduciéndose solos.
                </p>
              </div>
            </li>

            <li className="abt-principle">
              <span className="abt-principle-num">II</span>
              <div className="abt-principle-body">
                <h3>Cero anuncios, para siempre</h3>
                <p>
                  Sin banners, sin patrocinios intrusivos, sin acuerdos de
                  afiliados con casas de apuestas. La página debe leerse
                  como un periódico, no como una autopista de pop-ups.
                </p>
              </div>
            </li>

            <li className="abt-principle">
              <span className="abt-principle-num">III</span>
              <div className="abt-principle-body">
                <h3>Neutralidad editorial</h3>
                <p>
                  LeagueScope no toma partido. No favorece equipos ni
                  regiones, y no favorece a quien paga. Si una organización
                  quiere apoyar el proyecto, su aportación nunca cambiará
                  una sola cifra ni el orden de un ranking.
                </p>
              </div>
            </li>

            <li className="abt-principle">
              <span className="abt-principle-num">IV</span>
              <div className="abt-principle-body">
                <h3>Transparencia total</h3>
                <p>
                  Cada mes, un desglose público de ingresos, gastos y
                  donaciones. Cada métrica tendrá su explicación pública.
                  Cada error que se reporte se corrige a la vista de todos.
                </p>
              </div>
            </li>
          </ol>
        </section>

        {/* -- 03 AUDIENCIA -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">03</span> Audiencia
          </div>
          <h2>Para quién está pensado</h2>

          <p className="abt-dropcap">
            L a respuesta corta es: para cualquiera al que le guste el
            esport. La larga merece un par de líneas.
          </p>

          <p>
            LeagueScope está pensado para el aficionado que se levanta los
            miércoles a las diez para ver el LCK en directo, y también para
            el que en mitad de un cast recuerda haber visto a un jugador en
            la NA Academy hace tres años y necesita confirmarlo en treinta
            segundos. Para el que <strong>hace contenido</strong> y necesita
            un dato concreto sin pelearse con quince filtros, para el <strong>
            analista amateur</strong> que quiere mirar la regular season de
            la TCL con el mismo detalle que la de la LCK, para el <strong>
            caster</strong> que prepara una previa y para el <strong>jugador
            competitivo</strong> que quiere estudiar a sus rivales antes de
            un scrim.
          </p>

          <p>
            No hace falta ser analista profesional ni haber jugado en
            Challenger. Solo que el juego te guste lo suficiente como para
            querer mirarlo de cerca.
          </p>
        </section>

        {/* -- 04 CAPACIDADES -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">04</span> Capacidades
          </div>
          <h2>Qué puedes encontrar aquí</h2>

          <p className="abt-dropcap">
            L eagueScope no es una web llena de tablas por llenar tablas. Cada
            vista, cada gráfico y cada filtro existe porque resolvía un
            problema real, propio o de la comunidad. La plataforma se
            organiza en cuatro grandes áreas que cubren todo el ciclo de
            seguimiento de una competición: explorar, perfilar, comparar y
            recordar.
          </p>

          <h3>Explorar una liga al detalle</h3>
          <p>
            Cada competición tiene su propia ventana, con un overview que
            resume el pulso de la temporada, qué picks están funcionando,
            cómo se reparten las victorias por lado del mapa, qué equipos
            están subiendo. A partir de ahí, la clasificación se desdobla en
            <strong> once bloques de métricas avanzadas</strong> que cubren
            early game, mid game, late game, daño, economía, control de
            visión y objetivos neutrales. Lo que las clasificaciones
            oficiales nunca te cuentan.
          </p>
          <p>
            Todos los filtros se pueden aplicar por <strong>fase </strong>
            (Regular Season, Playoffs o temporada completa), por <strong>
            parche</strong> y por <strong>periodo de fechas</strong>, para
            que puedas mirar la situación exactamente en el momento que te
            interese y no tengas que conformarte con el agregado del split.
          </p>

          <h3>Perfiles en profundidad</h3>
          <p>
            El perfil de <strong>jugador</strong> reúne todas sus stats, su
            historial de partidas con builds y runas exactas, su champion
            pool con tasas de victoria por campeón y un timeline de toda su
            carrera competitiva, equipo a equipo. El perfil de <strong>
            equipo</strong> añade el roster actual, los rosters históricos,
            las prioridades de draft y las curvas de oro acumulado por
            partida. Y el perfil de <strong>campeón</strong> desglosa
            matchups, items, keystones, rendimiento por parche y los
            jugadores que más lo dominan en el panorama competitivo.
          </p>

          <h3>Comparar y analizar</h3>
          <p>
            La herramienta <strong>Head-to-Head</strong> permite enfrentar
            hasta cuatro equipos o jugadores lado a lado, ideal para previas
            o para entender diferencias estilísticas entre regiones. El
            <strong> Match Record</strong> recoge todo lo que pasó en una
            partida concreta, builds finales, timeline minuto a minuto, gold
            graph y draft completo, todo en una sola pantalla, sin tener
            que navegar entre pestañas.
          </p>

          <h3>Memoria histórica</h3>
          <p>
            El <strong>archivo desde 2014</strong> es una de las áreas a las
            que más cuidado se le dedica. No solo los resultados oficiales,
            sino el palmarés completo de jugadores, equipos y campeones a lo
            largo de toda la historia competitiva. Quién levantó qué trofeo,
            quién tiene más pentakills en Worlds, qué campeón se mantuvo en
            prioridad durante tres años seguidos. Los datos antiguos no se
            archivan ni se borran: forman parte de la historia del esport y
            deben quedar consultables.
          </p>
        </section>

        {/* -- 05 COBERTURA -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">05</span> Cobertura
          </div>
          <h2>Más de ochenta competiciones, una sola web</h2>

          <p>
            La cobertura se construyó por capas, empezando por las cuatro
            ligas principales y bajando hasta el último torneo regional. Hoy
            es probablemente la cobertura más amplia y consistente
            disponible públicamente en español.
          </p>

          <p>
            <strong>Las cuatro grandes.</strong> LCK, LPL, LEC y LCS. Las que
            marcan el meta global y las que se ven en directo desde antes
            del desayuno. Cubiertas split a split, con archivo completo y
            datos por parche.
          </p>
          <p>
            <strong>El bloque emergente.</strong> CBLOL, LCP, VCS, LJL y
            TCL. Ligas que llevan años produciendo talento que acaba en los
            grandes torneos internacionales. Tienen el mismo nivel de
            detalle que las cuatro grandes.
          </p>
          <p>
            <strong>Ligas de desarrollo.</strong> LCK Challengers, NA
            Challengers y EMEA Masters. Donde se forja el talento joven y
            donde aparecen los nombres que dentro de un año estarán jugando
            en una liga superior.
          </p>
          <p>
            <strong>Torneos internacionales.</strong> First Stand, MSI,
            Worlds y EWC. Los puntos del calendario donde el meta de cada
            región se mide contra el resto.
          </p>
          <p>
            <strong>Ligas regionales europeas.</strong> LFL, PRM, LES, NLC,
            LIT, EBL y Road of Legends, entre otras. La base sobre la que se
            construye el EMEA Masters cada split.
          </p>
          <p>
            <strong>Archivo histórico.</strong> EU LCS, NA LCS, LMS, PCS, LLA
            y otras ligas extintas que dejaron momentos inolvidables y que
            hoy siguen vivas con otro nombre. Los datos antiguos no se
            borran: forman parte de la historia y deben quedar consultables.
          </p>
        </section>

        {/* -- 06 DATOS -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">06</span> Datos
          </div>
          <h2>De dónde vienen las cifras</h2>

          <p className="abt-dropcap">
            U na pregunta razonable, sobre todo cuando ves números que no
            aparecen en ningún otro sitio. ¿De dónde sale todo esto?
          </p>

          <p>
            LeagueScope se nutre de Pandascore, siendo este el principal
            proveedor de datos, sus datos se normalizan y se vuelven a
            verificar antes de entrar en la base de datos. Cada partida que
            ves en la web ha pasado por un proceso de ingestión que
            comprueba consistencia, detecta anomalías y deduplica
            automáticamente.
          </p>

          <p>
            Cuando una métrica es derivada, por ejemplo, una eficiencia o
            un ratio compuesto, siempre se puede consultar la fórmula
            exacta. Cuando una clasificación depende de una decisión
            editorial, como qué se considera playoff o cómo se cuenta una
            eliminación temprana, el criterio queda documentado.
          </p>

          <p>
            Y si encuentras un error, hay una sola regla: se arregla lo
            antes posible. Por eso el canal de Discord y el correo están
            siempre abiertos.
          </p>
        </section>

        {/* -- 07 SOLIDARIO -- */}
        <section className="abt-solidario">
          <div className="abt-eyebrow">
            <span className="abt-num">07</span> Compromiso
          </div>
          <h2>Por qué LeagueScope es un proyecto solidario</h2>

          <p className="abt-dropcap">
            S i hay una sección de toda la página que merece una lectura
            atenta, es esta.
          </p>

          <p>
            LeagueScope no tiene ánimo de lucro. No es una frase para quedar
            bien: está en la propia estructura del proyecto. Mantener la API
            de datos, la infraestructura cloud, el dominio y los servicios
            asociados cuesta aproximadamente <strong>900&#8364; al
            mes</strong>. Esa es la cifra que la plataforma necesita para
            seguir viva. Ni un euro más.
          </p>

          <p>
            Cada euro que entre por encima de esa cifra va íntegro a la
            <strong> AECC</strong> (Asociación Española Contra el Cáncer).
            Sin comisiones intermedias, sin reservas, sin fondos propios.
            Cada mes se publicará un desglose claro y verificable de los
            ingresos, los gastos y el importe exacto transferido a la
            asociación. Nada escondido, nada maquillado.
          </p>

          <p>
            Si una afición, por pequeña que sea, puede generar un impacto
            fuera de sí misma, debería hacerlo. Los E-Sports no tienen por qué
            ser solo entretenimiento: si toda la energía que se dedica a
            este juego puede traducirse, aunque sea modestamente, en ayudar
            a quien lo está pasando mal, el círculo se cierra.
          </p>

          <blockquote className="abt-pull">
            Ningún proyecto de afición debería ser una excusa para
            enriquecerse a costa de su comunidad. Pero sí puede ser una
            razón para devolverle algo a quien más lo necesita.
          </blockquote>
        </section>

        {/* -- 08 APOYO -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">08</span> Apoyo
          </div>
          <h2>Cómo puedes echar una mano</h2>

          <p>
            Apoyar el proyecto no implica pagar por nada. La web es y
            seguirá siendo gratis para todo el mundo, con o sin suscripción,
            con o sin donación. Pero si quieres que llegue más lejos y más
            rápido, hay algunas formas.
          </p>

          <h3>Aportación libre</h3>
          <p>
            El sistema es muy simple: aportas lo que quieras, cuando
            quieras. No hay cuotas, no hay tier mínimo, no hay paquete
            premium. Cada euro que entre cubre los gastos del mes y, una
            vez cubiertos, se transfiere íntegro a la AECC.
          </p>
          <p>
            La voz sobre el rumbo de la plataforma, qué ligas cubrir, qué
            métricas añadir, qué prioridades marcar, es de toda la
            comunidad por igual. Aportar no da más voto que cualquier otro
            usuario. La web es para todos, paguen o no paguen.
          </p>

          <div className="abt-cta">
            <a href="#" className="abt-btn abt-btn-primary">
              Donación vía PayPal
            </a>
          </div>

          <h3>Gestos de agradecimiento</h3>
          <p>
            A cambio de esa confianza, lo que sí hay son pequeños gestos
            simbólicos para reconocer públicamente a quienes apoyan el
            proyecto. Ninguno limita el acceso al resto de usuarios.
          </p>

          <ul className="abt-thanks">
            <li>
              <strong>Nombre en el Wall of Fame.</strong> Si así lo deseas,
              tu nombre aparece de forma permanente en la página de
              agradecimientos de la web, junto a la fecha de tu aportación.
            </li>
            <li>
              <strong>Mención en el reporte mensual.</strong> Cada mes se
              publica un desglose verificable de ingresos, gastos y
              donación a la AECC. Quien haya aportado en ese periodo
              aparece nombrado en el reporte público.
            </li>
            <li>
              <strong>Aportación dedicada.</strong> Si quieres dedicar la
              donación a alguien (en memoria, en honor o como homenaje), se
              incluye su nombre junto al tuyo tanto en el Wall of Fame como
              en el reporte mensual.
            </li>
            <li>
              <strong>Respuesta personal.</strong> Cada aportación recibe
              una respuesta por correo agradeciendo el apoyo, sin
              plantillas y sin formularios automáticos.
            </li>
            <li>
              <strong>Acceso al canal abierto de la comunidad.</strong> Un
              espacio en Discord, abierto también a quien no aporte, donde
              se discuten las próximas funcionalidades, se comparten
              hallazgos del meta y se reportan errores.
            </li>
          </ul>

          <h3>Colaboraciones con equipos y organizaciones</h3>
          <p>
            Si representas a un equipo, una asociación o cualquier
            organización relacionada con esports y quieres apoyar el
            proyecto a una escala mayor, serás bienvenido. Habrá mención en
            los reportes mensuales, en redes y un agradecimiento permanente
            en esta misma página.
          </p>
          <p>
            Lo único innegociable es lo de siempre: la aportación no
            condiciona ni la neutralidad editorial, ni la ausencia de
            publicidad, ni la posición de tu equipo en ninguna
            clasificación. Si esa condición no encaja, mejor no avanzar. Si
            encaja, hablamos.
          </p>

          <div className="abt-cta">
            <a href="mailto:contact@leaguescope.com" className="abt-btn">
              Contáctanos para colaborar
            </a>
          </div>
        </section>

        {/* -- 09 ROADMAP -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">09</span> Roadmap
          </div>
          <h2>Qué viene después</h2>

          <p>
            El proyecto avanza por etapas, sin fechas comprometidas y con
            una premisa: mejor entregar bien tarde que entregar mal pronto.
            Estas son las grandes líneas de los próximos meses y años.
          </p>

          <h3>Fase actual, completada</h3>
          <p>
            Cobertura completa de las ligas principales, regionales, ligas
            de desarrollo y showmatches, con filtros por año, split, fase y
            parche. Perfiles de jugador, equipo y campeón en producción.
            Comparativas Head-to-Head y match record disponibles.
          </p>

          <h3>Próximamente</h3>
          <p>
            Datos en tiempo real durante las partidas en curso, con timeline
            sincronizado y mapa en vivo. Perfiles de usuario para guardar
            tus equipos y jugadores favoritos, con notificaciones cuando
            juegan. Herramientas más avanzadas para escarbar en cada partida,
            comparador de drafts, análisis de teamfights, métricas de
            macro decision-making.
          </p>

          <h3>A medio y largo plazo</h3>
          <p>
            Modelos predictivos entrenados con el archivo histórico.
            Aplicación móvil nativa para iOS y Android. Cobertura de
            torneos amateur y circuitos universitarios, especialmente en
            España y Latinoamérica.
          </p>

          <p>
            Sin fechas. Solo la constancia de seguir trabajándolo cada
            semana.
          </p>
        </section>

        {/* -- 10 WALL OF FAME -- */}
        <section>
          <div className="abt-eyebrow">
            <span className="abt-num">10</span> Wall of Fame
          </div>
          <h2>La gente que sostiene el proyecto</h2>

          <p>
            Cuando alguien apoye económicamente el proyecto, su nombre
            aparecerá aquí (siempre que así lo desee). Es la forma de
            reconocer públicamente a quienes hacen posible que la plataforma
            siga adelante.
          </p>

          <div className="abt-wall">
            Aquí aparecerán los nombres de quienes apoyen el proyecto.
            <br />
            <strong>Puedes ser el primero.</strong>
          </div>
        </section>

        {/* -- 11 CONTACTO -- */}
        <section className="abt-contact">
          <div className="abt-eyebrow">
            <span className="abt-num">11</span> Contacto
          </div>
          <h2>Hablemos</h2>

          <p>
            Sugerencias, errores, ideas, propuestas de colaboración,
            peticiones para cubrir un torneo concreto o, simplemente, ganas
            de hablar de esports. La puerta está abierta y se lee
            absolutamente todo lo que llega.
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

        {/* -- FOOTER -- */}
        <footer className="abt-footer">
          <p className="abt-quote">
            &ldquo;A veces, son las personas de las que nadie se imagina
            nada las que hacen cosas que nadie puede imaginar.&rdquo;
          </p>
          <span className="abt-quote-author">Alan Turing</span>
          <span>LeagueScope, 2026</span>
        </footer>

      </article>
    </div>
  );
}
