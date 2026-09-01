# Predicción &amp; Análisis de Apuestas de Fútbol (proyecto académico)

> **Aviso legal:** proyecto educativo de Ingeniería Informática. No gestiona
> dinero real, no está afiliado a ninguna casa de apuestas y no debe usarse
> para apostar dinero real. Todo el saldo y las apuestas son simulados con
> fines de evaluación estadística de un modelo predictivo.

## 1. Objetivo

Construir una web que, para cada jornada de las cinco grandes ligas europeas
(Premier League, LaLiga, Serie A, Bundesliga, Ligue 1):

1. Prediga el resultado de cada partido con un modelo estadístico riguroso
   (Poisson + Elo), no una fórmula simplista.
2. Compare esa predicción contra las cuotas de mercado para detectar
   **apuestas de valor** (value bets).
3. Sugiera un stake razonado (Kelly fraccionado) para simular la inversión
   con saldo virtual.
4. **Valide objetivamente** la fiabilidad del propio modelo, tanto contra
   una temporada pasada completa como de forma continua durante la
   temporada en curso, comparándolo contra estrategias de referencia
   (aleatoria y "apostar al favorito").

El resultado no es una promesa de rentabilidad, sino una herramienta de
análisis: medir, con números, si el sistema predictivo "funciona" mejor que
el azar y el sentido común, y cuánto.

## 2. Arquitectura y stack técnico

| Pieza | Elección | Por qué |
|---|---|---|
| Front-end | HTML + CSS + JavaScript vanilla | Sin build step, cero dependencias de compilación, más rápido de construir y de defender línea a línea en una memoria que un proyecto React con bundler. El proyecto no necesita enrutado complejo ni estado compartido entre componentes — cuatro páginas HTML independientes son suficientes. |
| Backend | Ninguno (sitio 100% estático) | Ver §4. |
| Actualización de datos | GitHub Action diaria → JSON estático | Ver §4. |
| Persistencia del usuario | `localStorage` | El saldo virtual y el historial de apuestas son individuales por navegador; no hay necesidad de cuentas de usuario ni de compartir datos entre dispositivos para un trabajo académico. |
| Gráficas | Chart.js (CDN) | Pedido explícitamente en el enunciado. |
| Despliegue | GitHub Pages / Netlify / Vercel (cualquiera sirve estáticos) | Gratuito y compatible con un sitio sin backend. |
| Datos de partidos/resultados/histórico | football-data.org (plan gratuito) | Cubre las 5 ligas pedidas, incluye histórico de temporadas pasadas, JSON limpio. Límite: 10 peticiones/minuto — irrelevante aquí porque solo llama la Action, no cada visitante. |
| Cuotas de mercado | The Odds API (plan gratuito, 500 peticiones/mes) | football-data.org **no ofrece cuotas** en su plan gratuito. The Odds API sí, para las 5 ligas elegidas. Con una única llamada diaria por liga (5/día ≈ 150/mes) se está muy por debajo del límite gratuito. |

## 3. Estructura de archivos

```
futbol-predicciones/
├── index.html              Inicio: partidos del día
├── picks.html               Picks de valor + simulador de stake
├── analysis.html             Validación del modelo y backtesting
├── history.html               Historial de apuestas simuladas del usuario
├── css/
│   └── styles.css
├── js/
│   ├── config.js             Parámetros centrales (ligas, pesos del modelo, Kelly…)
│   ├── storage.js            Persistencia en localStorage (saldo, historial)
│   ├── data.js                Carga de los JSON estáticos de /data
│   ├── poisson.js            Modelo de distribución de Poisson
│   ├── elo.js                  Rating Elo
│   ├── team-stats.js          Fuerzas ofensivas/defensivas ponderadas + H2H
│   ├── predictor.js           Orquesta poisson+elo+team-stats para predecir un partido
│   ├── kelly.js                Criterio de Kelly fraccionado
│   ├── backtest.js            Backtesting walk-forward y comparación de estrategias
│   ├── charts.js               Helpers de Chart.js
│   ├── home.js / picks.js / analysis.js / history.js   Lógica de cada página
├── data/                      JSON estático, regenerado a diario (no se edita a mano)
│   ├── matches-today.json
│   ├── season-history.json
│   ├── elo-ratings.json
│   └── past-season-validation.json
├── scripts/
│   ├── update-data.js         Script Node ejecutado por el workflow diario
│   └── seed-sample-data.js    Genera datos de EJEMPLO para que la web funcione antes del primer workflow
└── .github/workflows/
    └── update-data.yml         Cron diario de GitHub Actions
```

Los módulos de `js/` que contienen la lógica del modelo (`config.js`,
`poisson.js`, `elo.js`, `team-stats.js`, `predictor.js`, `kelly.js`,
`backtest.js`) están escritos para funcionar **tanto en el navegador como
en Node** (exportan vía `module.exports` cuando detectan un entorno Node).
Así, `scripts/update-data.js` reutiliza exactamente el mismo código de
predicción y backtesting que usa la web — evita mantener dos
implementaciones del modelo que puedan divergir.

## 4. Actualización diaria de datos: por qué GitHub Actions y no `fetch` en el navegador

Se valoraron las dos opciones del enunciado:

- **(a) Petición desde el navegador en cada visita:** requeriría exponer
  la API key de football-data.org y de The Odds API en el JavaScript
  público del cliente (cualquiera podría leerla y agotar la cuota
  gratuita). Además, football-data.org limita a 10 peticiones/minuto, lo
  que con varios visitantes simultáneos sería inviable. Y CORS no está
  garantizado para peticiones directas desde el navegador a estas APIs.
- **(b) Tarea programada gratuita que actualice un JSON una vez al día:**
  las claves quedan solo en Secrets de GitHub, nunca en código público; una
  única petición diaria por liga está muy por debajo de cualquier límite
  gratuito; y el sitio sigue siendo 100% estático (compatible con GitHub
  Pages/Netlify/Vercel sin funciones serverless).

Se eligió **(b)**, implementada como un workflow de GitHub Actions
(`.github/workflows/update-data.yml`) que corre `scripts/update-data.js`
cada día a las 06:00 UTC, y comitea los JSON regenerados en `/data`. El
front-end (`js/data.js`) solo hace `fetch` a esos ficheros estáticos del
propio repositorio.

## 5. Metodología matemática del modelo

### 5.1 Goles esperados y distribución de Poisson

Para un partido entre un equipo local y uno visitante, se estiman sus
goles esperados (λ) combinando varias señales, y con esos λ se calcula la
probabilidad de cada marcador posible.

**Fórmula de Poisson**, probabilidad de que un equipo marque exactamente
*k* goles dada su media esperada λ:

```
P(X = k) = (λ^k · e^-λ) / k!
```

**Cálculo de λ_local y λ_visitante** (`js/poisson.js`, función
`expectedGoals`):

```
λ_local      = mediaGolesLiga × ataqueLocal(local) × defensaVisitante(fuera) × ajusteElo      × ajusteH2H_local
λ_visitante  = mediaGolesLiga × ataqueVisitante(fuera) × defensaLocal(local) × (1/ajusteElo)   × ajusteH2H_visitante
```

- `mediaGolesLiga`: goles/partido medios de toda la competición (normaliza
  las fuerzas de los equipos entre sí).
- `ataqueLocal(local)` / `defensaVisitante(fuera)`, etc.: fuerzas relativas
  a la media de la liga (1.0 = rinde como la media), calculadas por
  separado para el rol de local y de visitante, porque el rendimiento de
  un equipo en casa y fuera no es simétrico (`js/team-stats.js`).
- `ajusteElo`: multiplicador derivado de la diferencia de rating Elo entre
  ambos equipos (§5.2).
- `ajusteH2H`: pequeño ajuste según enfrentamientos directos recientes
  (§5.3).

**Ponderación por recencia** (`js/team-stats.js`, función `weightedRatio`):
las fuerzas ofensivas/defensivas de cada equipo se calculan como una media
ponderada entre sus últimos `recentFormWindow` partidos (peso
`recentFormWeight`, 0.6 por defecto) y el resto de la temporada (peso
`1 - recentFormWeight`). Si un equipo tiene pocos partidos disputados, se
aplica una regresión a la media (`shrinkFactor`) para no sobre-reaccionar
a una muestra pequeña.

**Matriz de resultados** (`js/poisson.js`, funciones `scoreMatrix` y
`outcomeProbabilities`): se asume independencia entre el marcador del
local y del visitante (simplificación estándar; ver limitaciones en §7) y
se construye la matriz `P(i goles local, j goles visitante) = P_local(i) × P_visitante(j)`
para `i, j` de 0 a 8. Sumando las celdas por encima/en/debajo de la
diagonal se obtiene `P(1)`, `P(X)`, `P(2)`.

### 5.2 Rating Elo

El Elo resume la fuerza relativa global de un equipo de forma más estable
que mirar solo sus últimos partidos, y se actualiza tras cada resultado
real a lo largo de la temporada (`js/elo.js`).

**Probabilidad esperada de victoria local** antes del partido (incluye una
ventaja de campo en puntos Elo, `homeAdvantageElo = 60` por defecto):

```
E_local = 1 / (1 + 10^((Elo_visitante − (Elo_local + ventajaCampo)) / 400))
```

**Actualización tras el resultado real** (S = 1 si gana el local, 0.5 si
empate, 0 si gana el visitante; K = sensibilidad del ajuste):

```
Elo_local'     = Elo_local     + K × (S       − E_local)
Elo_visitante' = Elo_visitante + K × ((1−S)   − (1 − E_local))
```

**Traducción del Elo a un multiplicador de goles esperados** para Poisson
(`expectedGoalMultiplier`), acotada con una tangente hiperbólica para
evitar multiplicadores extremos con diferencias de Elo muy grandes:

```
diff = (Elo_local + ventajaCampo) − Elo_visitante
multiplicador = 1 + tanh(diff / 400) × 0.4
```

### 5.3 Enfrentamientos directos (H2H)

Se toman los últimos `h2hWindow` (5) enfrentamientos directos entre ambos
equipos, normalizados siempre a la perspectiva "local actual vs. visitante
actual" aunque en el pasado jugaran en campo contrario. Si el promedio de
goles marcados en esos enfrentamientos se desvía de la media de liga, se
aplica un ajuste acotado a ±15% (`h2hWeight = 0.15`) sobre λ — un factor
fino, nunca dominante frente a Poisson+Elo (`js/team-stats.js`,
`headToHeadMultiplier`).

### 5.4 Value betting y Kelly fraccionado

Un partido genera un **pick de valor** cuando la probabilidad estimada por
el modelo supera a la probabilidad implícita en la cuota ofrecida en al
menos `minEdgeToFlag` (3% por defecto):

```
EV = probabilidad_modelo × cuota_decimal − 1
```

Para el stake sugerido se usa el **Criterio de Kelly**, fraccionado para
amortiguar el riesgo de que el modelo tenga error de estimación (que
siempre lo tiene):

```
b  = cuota_decimal − 1
f* = (b·p − (1−p)) / b                        (Kelly puro)
f_sugerida = f* × kellyFraction × confianza     (kellyFraction = 1/4 por defecto)
stake = saldo_virtual × f_sugerida
```

`confianza` ∈ [0.25, 1] crece con el número de partidos jugados por ambos
equipos (menos histórico → menos confianza → stake menor, aunque el EV
calculado sea alto). El stake final se acota además a un máximo del 5%
del saldo (`maxStakePct`) como tope de seguridad (`js/kelly.js`).

## 6. Validación del modelo (backtesting)

### 6.1 Contra una temporada pasada completa

Antes de usarse con partidos reales, el modelo se valida con un
**backtesting "walk-forward"** (`js/backtest.js`, función `walkForward`):
para predecir el partido *N*, el modelo solo puede usar los partidos
`1..N-1` de esa misma temporada — nunca datos posteriores al partido que
predice. Esto evita el error de validación más común en estos proyectos
(*data leakage*: entrenar con información que en la realidad aún no
existía en el momento de la predicción).

Con esos resultados se calcula:
- **% de acierto** del pick 1X2 del modelo.
- **Intervalo de confianza al 95%** de ese porcentaje (aproximación
  normal: `p ± 1.96·√(p(1−p)/n)`), para no interpretar un 55% de acierto
  sobre 20 partidos como si fuera tan fiable como un 55% sobre 300.
- **ROI**, con la salvedad indicada en `scripts/update-data.js`: como
  football-data.org no da cuotas históricas en el plan gratuito, el ROI de
  la validación contra temporada pasada se estima con la cuota "justa"
  implícita (`1 / probabilidad_modelo`, sin margen de casa) como
  aproximación neutral — **no** son cuotas reales de mercado. El ROI con
  cuotas de mercado reales sí se calcula para la temporada en curso
  (§6.2), donde The Odds API aporta cuotas reales.

Esta validación se ejecuta una vez (y se cachea 25 días, porque una
temporada cerrada no cambia) dentro del propio workflow diario, y se
muestra en `analysis.html`.

### 6.2 Continua, durante la temporada actual

`analysis.html` ejecuta el mismo `walkForward` **en el navegador**, pero
sobre los partidos ya jugados de la temporada en curso (con cuotas reales
de The Odds API cuando están disponibles), y compara tres estrategias de
selección de pick con el mismo stake fijo (2% del saldo):

- **Modelo** (Poisson + Elo, esta web)
- **Favorito** (apostar siempre a la cuota más baja del mercado)
- **Aleatorio** (elegir 1/X/2 al azar)

Y tres criterios de stake, usando siempre el pick del modelo:

- **Kelly fraccionado (¼)**
- **Stake fijo** (2% del saldo en cada pick)
- **Stake aleatorio**

Los resultados (nº de apuestas, % de acierto, ROI, saldo final simulado)
se muestran en tabla y como evolución del saldo en un gráfico de líneas.

## 7. Limitaciones honestas

- **Ningún modelo estadístico de fútbol "acierta el máximo" de forma
  consistente.** El fútbol tiene un componente de azar estructural
  (decisiones arbitrales, lesiones en directo, rebotes) que ningún modelo
  captura del todo; un % de acierto del 50-55% en 1X2 con IC razonable ya
  es una señal de que el modelo aporta algo frente al azar (33% esperado
  al elegir al azar entre 1/X/2, no 50%).
- **Independencia de marcadores en Poisson:** el modelo asume que el
  marcador del local y del visitante son estadísticamente independientes.
  En la realidad hay una ligera correlación negativa, especialmente en
  marcadores bajos (0-0, 1-0, 0-1), que modelos más avanzados (Dixon-Coles)
  corrigen con un término adicional. No se implementó aquí por mantener el
  modelo explicable y con las herramientas gratuitas disponibles, pero
  queda documentado como mejora futura.
- **ROI de la validación histórica sin cuotas reales** (ver §6.1): es una
  aproximación con cuotas "justas" calculadas a partir del propio modelo,
  no cuotas de mercado reales de esa temporada pasada. El ROI con cuotas
  reales de mercado solo está disponible para la temporada actual.
- **Emparejamiento de cuotas por nombre de equipo** (`matchOdds` en
  `scripts/update-data.js`): The Odds API y football-data.org no
  comparten un identificador común de equipo, así que el cruce se hace
  normalizando nombres; en casos raros (nombres muy distintos entre
  fuentes) un partido puede quedarse sin cuotas y por tanto sin picks ese
  día.
- **Rating Elo reiniciado cada temporada** a `startingElo` (1500) en lugar
  de arrastrar el rating final de la temporada anterior con un ligero
  "reset a la media" (práctica habitual en sistemas Elo de fútbol reales).
  Simplificación consciente para no depender de tener el histórico
  perfectamente encadenado entre temporadas desde el primer día.
- **The Odds API, plan gratuito:** 500 peticiones/mes. Con 5 ligas y una
  actualización diaria (~150 peticiones/mes) hay margen, pero si se amplía
  a más ligas o más actualizaciones/día, se agotaría la cuota gratuita.
- **Kelly fraccionado sigue siendo sensible al error de estimación del
  modelo.** El tope del 5% del saldo (`maxStakePct`) y el factor de
  confianza mitigan, pero no eliminan, el riesgo de sobreapostar si el
  modelo está sesgado en un mercado concreto.

## 8. Cómo desplegarlo

1. Crear un repositorio en GitHub con este contenido.
2. En **Settings → Secrets and variables → Actions**, añadir:
   - `FOOTBALL_DATA_API_KEY` (gratuita en [football-data.org](https://www.football-data.org/client/register))
   - `ODDS_API_KEY` (gratuita en [the-odds-api.com](https://the-odds-api.com))
3. Lanzar manualmente el workflow una vez (pestaña *Actions* →
   *Actualizar datos diarios* → *Run workflow*) para generar los primeros
   JSON reales — hasta entonces, la web funciona con los datos de ejemplo
   de `scripts/seed-sample-data.js`.
4. Desplegar el contenido estático en GitHub Pages, Netlify o Vercel
   (no requiere build step: es HTML/CSS/JS plano).

## 9. Ejecutar los datos de ejemplo en local

```bash
node scripts/seed-sample-data.js   # genera /data con datos ficticios plausibles
# después, servir la carpeta con cualquier servidor estático, ej.:
npx serve .
```
