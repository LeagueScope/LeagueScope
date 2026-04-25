# LeagueScope — Design Tokens

Documento vivo con los elementos visuales de **leaguescope.com**. Fuente de verdad: `web/src/app/globals.css`, `web/src/app/home.css`, `web/src/components/navbar.css` y `web/public/`.

---

## 1. Paleta de colores

### 1.1 Superficies (fondos escalonados)

| Token | HEX | Uso |
|---|---|---|
| `--surface-base` | `#0e1117` | Fondo de página |
| `--surface-card` | `#141820` | Tarjetas, navbar, footer |
| `--surface-inset` | `#1a1f2b` | Celdas anidadas, inputs, sub-paneles |
| `--surface-hover` | `#222938` | Hover sobre superficies, scrollbar thumb |

Variantes puntuales en componentes: `#0f1219` (slate oscuro), `#11141d`, `#1c212b`.

### 1.2 Bordes

| Token | Valor | Uso |
|---|---|---|
| `--border-card` | `rgba(255, 255, 255, 0.08)` | Borde exterior de tarjetas |
| `--border-inner` | `rgba(255, 255, 255, 0.05)` | Divisores internos, tablas |

Grosor estándar: **1 px**. Para puntos de foco o CTAs se usa 1.5–2 px (incluidas variantes `dashed`).

### 1.3 Acento primario — Amber

El color primario de marca. Coincide con la gradiente naranja/ámbar del logo.

| Token | HEX / RGBA | Uso |
|---|---|---|
| `--accent` | `#f0a500` | Enlaces activos, subrayado del item activo en navbar, CTAs |
| `--accent-dim` | `rgba(240, 165, 0, 0.10)` | Fondo de chips activos |
| `--accent-soft` | `rgba(240, 165, 0, 0.20)` | Borde de elementos focus / hover |

Escala pasiva en rgba: `0.03`, `0.06`, `0.10`, `0.20`, `0.25`, `0.35`.

### 1.4 Acento secundario — Azul

| Token | HEX | Uso |
|---|---|---|
| `--accent-secondary` | `#60a5fa` | Info, links externos, acentos fríos |

### 1.5 Colores semánticos

| Significado | HEX | Token / uso |
|---|---|---|
| Victoria / positivo | `#4ade80` | `--clr-win`, iconografía verde |
| Positivo (gradiente) | `#22c55e` | Par del anterior en gradientes |
| Verde accent (live) | `#30d158` | LIVE badge, dots encendidos |
| Derrota / negativo | `#f87171` | `--clr-loss`, rojos suaves |
| Error / alerta | `#ef4444` | Badge "Playoffs", errores duros |
| Rojo iOS | `#ff453a` | LIVE rojo intenso |
| Neutral / empate | `#94a3b8` | `--clr-mid`, texto secundario |
| Warning / dorado | `#fbbf24`, `#eab308` | Highlights amarillos |
| Ámbar oscuro | `#d97706` | Hover/estados amber intensos |
| Premium / oro | `#ffd700` | Medallas, destacados editoriales |
| Naranja (Internacional) | `#f97316`, `#fb923c` | Badges de eventos internacionales |

### 1.6 Texto

| Token | HEX | Uso |
|---|---|---|
| `--text-primary` | `#f8fafc` | Titulares, datos principales |
| `--text-secondary` | `#94a3b8` | Subtítulos, labels |
| `--text-muted` | `#7a8ba0` | Captions, metadatos |
| (puntual) | `#64748b`, `#cbd5e1`, `#e2e8f0` | Variantes en componentes concretos |

---

## 2. Tipografía

### 2.1 Familias

Cargadas en `layout.tsx` desde Google Fonts:

```
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@700;800;900&display=swap">
```

| Familia | Fallback | Uso |
|---|---|---|
| **Inter** | `system-ui, -apple-system, sans-serif` | Toda la UI, titulares, párrafos |
| **JetBrains Mono** | `monospace` | Números, BO tags, scores, marcadores, datos |

### 2.2 Pesos disponibles

- **Inter:** 400, 500, 600, 700, 800, 900
- **JetBrains Mono:** 700, 800, 900

### 2.3 Escala de tamaños (uso real)

| Tamaño | Peso típico | Dónde |
|---|---|---|
| 8 px | 900 | Divisores "VS", micro-labels |
| 9 px | 700–900 | BO tags, filtros comprimidos |
| 10 px | 700–900 | Abreviaturas, metadatos de tabla |
| 11 px | 500–700 | Nav items (UPPERCASE), scores |
| 12 px | 400–700 | Cuerpo denso, stats |
| 13 px | 700–900 | Headlines de card |
| 14 px | 400–900 | Cuerpo base, títulos de sección |
| 15–16 px | 600–800 | Subtítulos grandes, brand wordmark |
| 18–20 px | 700 | Títulos de columna |
| 24 px | 900 | Títulos de bloque |
| 48 px | 900 | Hero event title |
| 52 px | 900 | Display — evento internacional destacado |

### 2.4 Letter-spacing recurrente

| Contexto | Valor |
|---|---|
| Hero titles | `-2px` (condensado) |
| Brand wordmark | `-0.5px` |
| Nav items UPPERCASE | `0.08em` |
| Section titles UPPERCASE | `2px` (tracking amplio editorial) |
| Subnav / breadcrumbs | `0.06em` – `0.1em` |

### 2.5 Line-height

- Datos numéricos y títulos compactos: **1**
- Párrafos cortos: **1.4**
- Párrafos largos: **1.6**
- Hero "display": **0.9**

---

## 3. Radios, sombras y líneas

### 3.1 Border-radius (tokens)

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | `0px` | Celdas, tags, estética editorial plana |
| `--radius-card` | `2px` | Tarjetas principales |
| `--radius-lg` | `4px` | Módulos grandes / agrupaciones |

Radios puntuales observados en componentes: `1px`, `3px`, `5px`, `7px`, `8px`, `10px`, `14px`, `16px`, `20px`, y `50%` (avatares, dots, iconos circulares).

> **Principio:** la marca tira a **ángulos vivos / editorial-flat**. El 0–4 px domina; círculos solo para avatares y dots semánticos.

### 3.2 Sombras

| Token | Valor | Uso |
|---|---|---|
| `--shadow-soft` | `0 4px 20px rgba(0, 0, 0, 0.3)` | Elevación suave (dropdowns, modals) |
| `--shadow-card` | `0 8px 32px rgba(0, 0, 0, 0.6)` | Cards flotantes, layers superiores |

Efectos puntuales: `box-shadow: 0 0 10px rgba(248, 113, 113, 0.5)` para pulse LIVE rojo.

### 3.3 Grosor de líneas

- **Estándar:** 1 px solid
- **Focus / énfasis:** 1.5 px (a veces dashed)
- **Separadores duros:** 2 px dashed `var(--border-inner)`

---

## 4. Layout y espaciado

| Token / medida | Valor |
|---|---|
| Max-width del main (`#app`) | **2200 px** |
| Padding lateral del main | 24 px desktop · 16 px ≤1024 · 12 px ≤768 · 8 px ≤600 |
| Altura del navbar | **56 px** (sticky, z-index 1000) |
| Separación navbar → contenido | `margin-bottom: 24px` |
| Padding home editorial | `60px 40px` (con overhang `-150px` a cada lado) |
| Gap estándar entre secciones | 48–60 px |
| Gap entre cards | 32 px |

Breakpoints usados (mobile-first queries `max-width`):
- 600 px (móvil compacto)
- 768 px (tablet)
- 1024 px (portátil pequeño)
- 1150 px (ruptura de grid 2→1 en major leagues)

---

## 5. Logo — variantes

| Fichero | Formato | Dimensiones | Fondo | Uso recomendado |
|---|---|---|---|---|
| `web/public/LeagueScope_Logo.png` | PNG, RGBA | 2000 × 2000 | Transparente | **Master** — navbar (32×32), favicons, fondos oscuros, avatares redimensionando |
| `web/public/LeagueLogo.PNG` | PNG, RGBA | 2000 × 2000 | Negro sólido | Variante para materiales donde se necesite un "frame" oscuro (social cards, email blocks) |
| `web/public/favicon.ico` | ICO multi-tamaño | 16×16 + 32×32 | Transparente | Favicon del navegador |

**Mark visual:** cinta/ribbon en forma de "W" (o "WW" encadenada) con gradiente naranja→ámbar (de `#f0a500` a tonos `#f97316`/`#fb923c`), cara interior en rojo/naranja más saturado.

**Wordmark:** el texto "LeagueScope" aparece a continuación del mark en la navbar como `<span class="arcane-brand-text">` con:

- Familia: Inter
- Tamaño: **16 px**
- Peso: **800**
- Color: `var(--text-primary)` (`#f8fafc`)
- Letter-spacing: `-0.5px`

No existe un SVG oficial ni variantes claras/oscuras separadas más allá del archivo con fondo negro. **Pendiente de producir**:

- SVG vectorial del mark (útil para BIMI, emails, print, retina sin lossy).
- Variante monocromo (solo blanco y solo negro) para casos restringidos.
- Versión horizontal "mark + wordmark" empaquetada como asset único.
- Versión cuadrada con padding fijo pensada para avatares sociales.

---

## 6. Iconografía y elementos recurrentes

Directorio raíz: `web/public/`.

### 6.1 Logos de liga — `/logos/` (49 ficheros)

Organizados por liga. Nomenclatura mixta (`logo_LEC.png`, `logo_LCK.png`, `logo_LPL.png`, `logo_LCS.png`, `logo_MSI.png`, `logo_Worlds.png`, `lrn_logo.png`, `lta_north_logo.png`, `lck_cl_logo.png`, `na_cl_logo.png`, `road_logo.png`, `vcs_logo.png`, `nlc_logo.png`, `lvp_logo.png`, `no_logo.png` como placeholder, etc.).

Se consumen vía el mapa `LEAGUE_LOGO` en `web/src/lib/constants.ts`.

### 6.2 Iconos de rol — `/rol/`

`top.png`, `jng.png`, `mid.png`, `bot.png`, `sup.png`. Expuestos por `ROLE_ICON`.

### 6.3 Objetivos del mapa — `/objetives/`

`baron.png`, `baronblue.png`, `baronred.png`, `dragon.png`, `dragonblue.png`, `dragonred.png`, `riftherald.png`, `riftblue.png`, `riftred.png`, `grub.png`, `camp.png`, `turretblue.png`, `turretred.png`, `inhibblue.png`, `inhibred.png`.

Variantes `blue`/`red` para diferenciar por lado en timelines y cards.

### 6.4 Dragones elementales — `/dragons/`

`infernal.png`, `ocean.png`, `mountain.png`, `cloud.png`, `hextech.png`, `chemtech.png`, `elder.png`.

### 6.5 Social — `/social/`

`discord.webp`, `instagram.png`, `x.png`.

### 6.6 Patrones de gradient recurrentes

| Nombre interno | Gradient | Uso |
|---|---|---|
| Accent dim → transparente | `linear-gradient(to right, var(--accent-dim), transparent)` | Underlays de sección destacada |
| Verde accent | `linear-gradient(90deg, #4ade80, #22c55e)` | Barras de victoria / progreso positivo |
| Rojo accent | `linear-gradient(90deg, #ef4444, #f87171)` | Barras de derrota / alerta |
| Orange spotlight | `linear-gradient(135deg, rgba(249, 115, 22, 0.2), rgba(251, 146, 60, 0.1))` | Eventos internacionales (MSI, Worlds, EWC) |
| White-lift | `linear-gradient(to bottom, rgba(255, 255, 255, 0.03), transparent)` | Rim light superior de cards |

---

## 7. Badges y tags (patrones editoriales)

Detectados en `home.css`. Útiles para copiar estilos en social / presentación:

```
.p1-bo-tag
  font-family: JetBrains Mono · 9px · 700
  color: --text-muted
  border: 1px solid --border-inner
  padding: 1px 6px
  letter-spacing: 0.5px

.p1-playoffs-tag
  font-size: 9px · font-weight: 900
  color: #ef4444
  background: rgba(239, 68, 68, 0.08)
  border: 1px solid rgba(239, 68, 68, 0.3)
  padding: 2px 7px
  letter-spacing: 1px

.p1-section-title-text
  font-size: 14px · font-weight: 900
  letter-spacing: 2px  (UPPERCASE)
```

**Regla de oro editorial:** tipografías condensadas (letter-spacing negativo) para displays; tipografía expandida (letter-spacing alto) para labels en mayúsculas.

---

## 8. Scrollbar

```
::-webkit-scrollbar        { width: 8px; }
::-webkit-scrollbar-track  { background: var(--surface-base); }
::-webkit-scrollbar-thumb  { background: var(--surface-hover); border-radius: 4px; }
```

---

## 9. Resumen 1-line para quien diseñe un asset externo

> Dark editorial · fondo `#0e1117` · card `#141820` · accent ámbar `#f0a500` (+ azul frío `#60a5fa`) · verde/rojo `#4ade80`/`#f87171` para resultados · Inter 400–900 + JetBrains Mono 700–900 para datos · esquinas casi rectas (0–4 px) · sombras densas (hasta 60 % alpha) · logo ribbon naranja→ámbar sobre transparente.

---

## 10. Pendientes para cerrar el sistema

1. **Producir SVG del logo** (mark + wordmark + combinadas).
2. **Variantes monocromo** del logo (blanco puro y negro puro) para restricciones de color.
3. **Versión cuadrada con padding** (para avatar social / favicon retina).
4. **Tokens oficiales en JSON / Style Dictionary** si se contempla exportar a Figma o a otros consumidores.
5. **Ficha BIMI** (SVG Tiny P/S del mark) para que el logo aparezca junto al remitente en Gmail/Yahoo/Apple Mail.
6. **Plantilla de social card** (1200×630) con la paleta base + logo claro.
