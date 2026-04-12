# 📚 PandaScore API - Endpoints de League of Legends

**Base URL:** `https://api.pandascore.co`

**Autenticación:** Bearer Token en header `Authorization: Bearer {API_KEY}`

**Paginación:** `?page=1&per_page=50` (máx 100 por página)

**Filtros:** `?filter[field]=value` | **Rangos:** `?range[field]=min,max` | **Ordenar:** `?sort=field` o `?sort=-field` (desc)

---

## 📊 RESUMEN DE CATEGORÍAS

| Categoría | Endpoints | Plan Requerido |
|-----------|-----------|----------------|
| Champions | 4 | Free |
| Items | 4 | Free |
| Runes | 6 | Free |
| Spells | 2 | Free |
| Masteries | 2 | Free |
| Leagues | 1 | Free |
| Series | 4 | Free |
| Tournaments | 4 | Free |
| Matches | 5 | Free |
| Teams | 2 | Free |
| Players | 1 | Free |
| Games | 5 | Historical+ |
| Stats | 8 | Historical+ |

---

## 🏆 1. CHAMPIONS (Datos estáticos del juego)

### Lista todos los campeones (versión actual)
```
GET /lol/champions
```
**Plan:** Free  
**Descripción:** Obtiene todos los campeones en su estado actual  
**Filtros útiles:** `?filter[name]=Ahri`, `?filter[id]=123`  
**Retorna:** Array de objetos Champion con stats base, habilidades, videogame_versions

### Obtener un campeón específico
```
GET /lol/champions/{lol_champion_id}
```
**Plan:** Free  
**Parámetros:** `lol_champion_id` (integer, requerido)  
**Retorna:** Objeto Champion completo

### Lista campeones para TODAS las versiones
```
GET /lol/versions/all/champions
```
**Plan:** Free  
**Descripción:** Todos los campeones en todas sus versiones históricas  
**Útil para:** Tracking de cambios entre parches

### Lista campeones para una versión específica
```
GET /lol/versions/{lol_version_name}/champions
```
**Plan:** Free  
**Parámetros:** `lol_version_name` (string, ej: "14.1.1")  
**Ejemplo:** `/lol/versions/14.1.1/champions?filter[name]=Sejuani`

---

## 🎒 2. ITEMS (Objetos del juego)

### Lista todos los items
```
GET /lol/items
```
**Plan:** Free  
**Retorna:** Array de items con stats, costes, componentes

### Obtener un item específico
```
GET /lol/items/{lol_item_id}
```
**Plan:** Free

### Lista items para todas las versiones
```
GET /lol/versions/all/items
```
**Plan:** Free

### Lista items para una versión específica
```
GET /lol/versions/{lol_version_name}/items
```
**Plan:** Free

---

## 🔮 3. RUNES (Sistema de runas)

### Lista runas (sistema antiguo - legacy)
```
GET /lol/runes
```
**Plan:** Free  
**Nota:** Sistema de runas pre-Reforged

### Obtener una runa legacy
```
GET /lol/runes/{lol_rune_id}
```
**Plan:** Free

### Lista runas Reforged (sistema actual)
```
GET /lol/runes-reforged
```
**Plan:** Free  
**Retorna:** Runas del sistema actual (Precision, Domination, etc.)

### Lista rune paths (árboles de runas)
```
GET /lol/runes-reforged-paths
```
**Plan:** Free  
**Retorna:** Los 5 árboles principales de runas

### Obtener un rune path específico
```
GET /lol/runes-reforged-paths/{lol_rune_path_id}
```
**Plan:** Free

### Obtener una runa Reforged específica
```
GET /lol/runes-reforged/{lol_rune_reforged_id}
```
**Plan:** Free

---

## ✨ 4. SPELLS (Hechizos de invocador)

### Lista todos los hechizos
```
GET /lol/spells
```
**Plan:** Free  
**Retorna:** Flash, Ignite, Teleport, etc.

### Obtener un hechizo específico
```
GET /lol/spells/{lol_spell_id}
```
**Plan:** Free

---

## 📖 5. MASTERIES (Sistema antiguo de maestrías)

### Lista todas las maestrías
```
GET /lol/masteries
```
**Plan:** Free  
**Nota:** Sistema legacy pre-runas Reforged

### Obtener una maestría específica
```
GET /lol/masteries/{lol_mastery_id}
```
**Plan:** Free

---

## 🏟️ 6. LEAGUES (Ligas/Competiciones)

### Lista todas las ligas de LoL
```
GET /lol/leagues
```
**Plan:** Free  
**Descripción:** LEC, LCK, LPL, LCS, ligas regionales, etc.  
**Filtros:** `?filter[name]=LEC`, `?filter[slug]=lec`

**Campos retornados:**
- `id`: ID único
- `name`: Nombre completo (ej: "League of Legends European Championship")
- `slug`: Identificador URL-friendly (ej: "lec")
- `url`: URL oficial
- `image_url`: Logo de la liga
- `series`: Array de temporadas
- `videogame`: Objeto del videojuego

---

## 📅 7. SERIES (Temporadas/Splits)

### Lista todas las series de LoL
```
GET /lol/series
```
**Plan:** Free  
**Descripción:** Splits, temporadas (ej: "LEC Spring 2024")

### Series pasadas
```
GET /lol/series/past
```
**Plan:** Free

### Series en curso
```
GET /lol/series/running
```
**Plan:** Free

### Series próximas
```
GET /lol/series/upcoming
```
**Plan:** Free

**Campos retornados:**
- `id`, `slug`, `name`
- `full_name`: Nombre completo
- `begin_at`, `end_at`: Fechas
- `year`: Año
- `season`: Temporada (spring, summer, etc.)
- `league`: Objeto de la liga padre
- `tournaments`: Array de torneos dentro de la serie

---

## 🏆 8. TOURNAMENTS (Torneos específicos)

### Lista todos los torneos de LoL
```
GET /lol/tournaments
```
**Plan:** Free  
**Descripción:** Regular Season, Playoffs, Groups, etc.

### Torneos pasados
```
GET /lol/tournaments/past
```
**Plan:** Free

### Torneos en curso
```
GET /lol/tournaments/running
```
**Plan:** Free

### Torneos próximos
```
GET /lol/tournaments/upcoming
```
**Plan:** Free

**Campos retornados:**
- `id`, `slug`, `name`
- `begin_at`, `end_at`
- `tier`: S/A/B/C/D (importancia)
- `prizepool`: Premio
- `live_supported`: Si tiene datos en vivo
- `serie`: Serie padre
- `league`: Liga padre
- `teams`: Equipos participantes
- `expected_roster`: Roster esperado
- `matches`: Partidos del torneo

---

## ⚔️ 9. MATCHES (Partidos/Enfrentamientos)

### Lista todos los matches de LoL
```
GET /lol/matches
```
**Plan:** Free  
**Descripción:** Partidos (BO1, BO3, BO5)

### Matches pasados
```
GET /lol/matches/past
```
**Plan:** Free

### Matches en curso
```
GET /lol/matches/running
```
**Plan:** Free

### Matches próximos
```
GET /lol/matches/upcoming
```
**Plan:** Free

### Obtener un match específico
```
GET /lol/matches/{match_id_or_slug}
```
**Plan:** Free  
**Parámetros:** `match_id_or_slug` (int o string)

**Campos retornados:**
- `id`, `slug`, `name`
- `status`: not_started, running, finished, canceled
- `match_type`: best_of
- `number_of_games`: Número de juegos (1, 3, 5)
- `scheduled_at`: Fecha programada
- `begin_at`, `end_at`: Fechas reales
- `opponents`: Array con los 2 equipos
- `winner`: Equipo ganador
- `results`: Marcador (ej: [{score: 2}, {score: 1}])
- `games`: Array de juegos individuales
- `tournament`, `serie`, `league`
- `live_embed_url`: URL del stream
- `streams_list`: Lista de streams

---

## 👥 10. TEAMS (Equipos)

### Lista todos los equipos de LoL
```
GET /lol/teams
```
**Plan:** Free  
**Filtros:** `?filter[name]=G2`, `?filter[slug]=g2-esports`

### Lista equipos de una serie específica
```
GET /lol/series/{serie_id_or_slug}/teams
```
**Plan:** Free

**Campos retornados:**
- `id`, `slug`, `name`, `acronym`
- `image_url`: Logo del equipo
- `location`: País
- `players`: Roster actual
- `current_videogame`: Videojuego principal

---

## 🎮 11. PLAYERS (Jugadores)

### Lista todos los jugadores de LoL
```
GET /lol/players
```
**Plan:** Free  
**Filtros:** `?filter[name]=Faker`, `?filter[slug]=faker`

**Campos retornados:**
- `id`, `slug`, `name`
- `first_name`, `last_name`
- `nationality`: País
- `birthday`: Fecha de nacimiento
- `image_url`: Foto
- `role`: top, jun, mid, adc, sup
- `current_team`: Equipo actual
- `current_videogame`: Videojuego

---

## 🎯 12. GAMES (Juegos individuales) - HISTORICAL+

### Obtener un juego específico
```
GET /lol/games/{lol_game_id}
```
**Plan:** Historical+  
**Descripción:** Datos completos de un juego (Game 1, Game 2, etc. de un match)

**Campos retornados:**
- `id`, `status`, `position` (número de juego en el match)
- `length`: Duración en segundos
- `begin_at`, `end_at`
- `finished`: Boolean
- `winner`: Equipo/lado ganador
- `winner_type`: "Team"
- `match_id`
- `teams`: Array con datos de ambos equipos incluyendo:
  - `team`: Objeto del equipo
  - `color`: "blue" o "red"
  - `first_baron`, `first_dragon`, `first_tower`, `first_blood`, `first_herald`, `first_voidgrub`, `first_atakhan`
  - `baron_kills`, `dragon_kills`, `tower_kills`, `herald_kills`, `voidgrub_kills`, `atakhan_kills`
  - `gold_earned`
  - `players`: Array con datos de cada jugador
- `players`: Array detallado de los 10 jugadores con:
  - `player`: Objeto del jugador
  - `team`: Equipo
  - `champion`: Campeón usado
  - `role`: Posición
  - `kills`, `deaths`, `assists`
  - `cs` (minions), `gold_earned`
  - `damage_dealt`, `damage_taken`
  - `wards_placed`, `wards_destroyed`
  - `items`: Array de items finales
  - `runes`: Runas usadas
  - `spells`: Hechizos de invocador

### Lista juegos de un match
```
GET /lol/matches/{match_id_or_slug}/games
```
**Plan:** Historical+

### Lista juegos terminados de un equipo
```
GET /lol/teams/{team_id_or_slug}/games
```
**Plan:** Historical+

### Lista eventos Play-by-Play de un juego
```
GET /lol/games/{lol_game_id}/events
```
**Plan:** Historical+  
**Descripción:** Timeline de todos los eventos del juego

**Tipos de eventos:**
- `kill`: Asesinato de jugador
- `tower_kill`: Torre destruida
- `dragon_kill`: Dragón eliminado
- `baron_kill`: Baron eliminado
- `herald_kill`: Heraldo eliminado
- `voidgrub_kill`: Voidgrub eliminado
- `atakhan_kill`: Atakhan eliminado
- `inhibitor_kill`: Inhibidor destruido

**Campos por evento:**
- `type`: Tipo de evento
- `timestamp`: Tiempo en el juego (segundos)
- `killer`: Jugador/entidad que realizó la acción
- `victim`: Jugador/entidad afectada
- `assistants`: Array de asistentes
- `position`: Coordenadas {x, y} en el mapa

### Lista frames Play-by-Play de un juego
```
GET /lol/games/{lol_game_id}/frames
```
**Plan:** Historical+  
**Descripción:** Snapshots del estado del juego cada ~10 segundos

**Campos por frame:**
- `timestamp`: Tiempo en el juego
- `teams`: Estado de cada equipo (gold, torres, dragones, barones, etc.)
- `players`: Estado de cada jugador (gold, cs, items, level, position)

---

## 📈 13. STATS (Estadísticas agregadas) - HISTORICAL+

### Stats de jugadores en un match
```
GET /lol/matches/{match_id_or_slug}/players/stats
```
**Plan:** Historical+  
**Descripción:** Estadísticas agregadas de todos los jugadores del match

### Stats globales de un jugador
```
GET /lol/players/{player_id_or_slug}/stats
```
**Plan:** Historical+  
**Descripción:** Estadísticas de carrera del jugador

**Campos retornados:**
- `games_count`: Total de juegos
- `averages`: Promedios por juego
  - `kills`, `deaths`, `assists`, `kda`
  - `cs`, `gold_earned`
  - `damage_dealt`, `damage_taken`
  - `wards_placed`
- `totals`: Totales acumulados
- `champions`: Campeones más jugados con stats

### Stats de jugador en una serie
```
GET /lol/series/{serie_id_or_slug}/players/{player_id_or_slug}/stats
```
**Plan:** Historical+

### Stats de jugador en un torneo
```
GET /lol/tournaments/{tournament_id_or_slug}/players/{player_id_or_slug}/stats
```
**Plan:** Historical+

### Stats globales de un equipo
```
GET /lol/teams/{team_id_or_slug}/stats
```
**Plan:** Historical+

**Campos retornados:**
- `games_count`, `wins`, `losses`
- `win_rate`
- `averages` / `totals`:
  - `kills`, `deaths`, `assists`
  - `gold_earned`
  - `baron_kills`, `dragon_kills`, `tower_kills`
  - `first_blood_rate`, `first_tower_rate`, `first_baron_rate`
  - `voidgrub_kills`, `atakhan_kills` (desde patch 14.1.1+)
- `game_length_average`

### Stats de equipo en una serie
```
GET /lol/series/{serie_id_or_slug}/teams/{team_id_or_slug}/stats
```
**Plan:** Historical+

### Stats de TODOS los equipos en una serie
```
GET /lol/series/{serie_id_or_slug}/teams/stats
```
**Plan:** Historical+

### Stats de equipo en un torneo
```
GET /lol/tournaments/{tournament_id_or_slug}/teams/{team_id_or_slug}/stats
```
**Plan:** Historical+

---

## 🔴 14. LIVE DATA (WebSocket) - PRO LIVE

### Matches en vivo
```
GET /lives
```
**Plan:** Pro Live  
**Descripción:** Lista de matches con WebSocket abierto

**WebSocket URL:** Incluida en la respuesta para conectar y recibir:
- **Frames feed:** Estado del juego cada ~1 segundo
- **Events feed:** Eventos en tiempo real

---

## 🔧 PARÁMETROS COMUNES

### Filtrado
```
?filter[name]=G2
?filter[slug]=g2-esports
?filter[id]=123
?filter[status]=finished
?filter[tier]=s,a          # Múltiples valores
?filter[videogame]=lol
```

### Rangos
```
?range[begin_at]=2024-01-01,2024-12-31
?range[scheduled_at]=2024-06-01,
```

### Ordenación
```
?sort=scheduled_at         # Ascendente
?sort=-scheduled_at        # Descendente
?sort=name,-begin_at       # Múltiples campos
```

### Paginación
```
?page=1&per_page=50
?page[number]=2&page[size]=30
```

---

## 📋 EJEMPLOS DE USO COMÚN

### 1. Obtener partidos de hoy de la LEC
```
GET /lol/matches?filter[league_slug]=lec&filter[status]=not_started,running
```

### 2. Obtener stats de Caps en LEC 2024 Spring
```
GET /lol/series?filter[league_slug]=lec&filter[year]=2024&filter[season]=spring
# Obtener serie_id de la respuesta
GET /lol/series/{serie_id}/players/caps/stats
```

### 3. Obtener timeline de un juego específico
```
GET /lol/matches/{match_id}/games
# Obtener game_id del array
GET /lol/games/{game_id}/events
```

### 4. Comparar dos equipos en un torneo
```
GET /lol/tournaments/{tournament_id}/teams/g2-esports/stats
GET /lol/tournaments/{tournament_id}/teams/fnatic/stats
```

### 5. Obtener todos los campeones del meta actual
```
GET /lol/versions/{current_patch}/champions
```

### 6. Obtener historial de enfrentamientos de un equipo
```
GET /lol/teams/g2-esports/games?filter[finished]=true&sort=-begin_at&per_page=50
```

---

## 💰 PLANES Y ACCESO

| Plan | Precio | Acceso |
|------|--------|--------|
| **Free** | $0 | Leagues, Series, Tournaments, Matches, Teams, Players, Champions, Items, Runes, Spells |
| **Historical** | ~$50-200/mes | + Games, Stats, Events, Frames (post-game) |
| **Pro Live** | ~$500+/mes | + WebSocket live data, real-time frames/events |

---

## 📝 NOTAS IMPORTANTES

1. **Rate Limiting:** Respetar límites de la API (varía según plan)
2. **Versionado de campeones:** Los IDs de campeones cambian entre parches si hay cambios de stats
3. **Datos de objetivos nuevos:** Voidgrubs (desde patch 14.1.1) y Atakhan (desde patch 14.X)
4. **Posiciones de kills:** Solo disponibles vía GRID API (no PandaScore)
5. **Cobertura:** No todas las ligas menores tienen datos completos de games/stats

---

## 🔗 REFERENCIAS

- Documentación oficial: https://developers.pandascore.co/docs
- API Reference: https://developers.pandascore.co/reference
- Changelog: https://developers.pandascore.co/changelog
- Slack de soporte: https://join.slack.com/t/pandascore/
