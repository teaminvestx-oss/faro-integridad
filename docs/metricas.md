# FARO · Metodología de métricas

Toda métrica visible en la app tiene aquí su fórmula y su test
(`tests/metrics.test.mjs`, se ejecuta con `npm test`). El código que las
calcula vive en un único módulo: [`js/metrics.js`](../js/metrics.js).
**Una métrica sin fórmula documentada y sin test no se despliega.**

## Reglas transversales de credibilidad (Fase 0)

1. **Guard de retornos**: cualquier retorno con |valor| > **500%** se considera
   dato corrupto, se descarta (no se muestra) y se registra un aviso en consola.
2. **Win rate SIN topes, con su intervalo**: se muestra el **valor real** —incluidos
   el 0% y el 100%— acompañado del **intervalo de Wilson al 95%** y del tamaño de
   muestra. (Corregido LIGA193, 3-ago-2026: esta regla decía «se capa a [5%, 95%],
   nunca se muestra 0% ni 100%» y llevaba tiempo siendo falsa —`js/metrics.js:98`
   dice «valor real, sin tope» y /metodologia publica «sin topes artificiales»—.
   El tope se sustituyó por el intervalo porque capar es maquillar: 7 de 7 es 100%,
   y lo honesto no es escribir 95% sino decir que su intervalo va del orden de
   65% a 100%. Un documento que manda algo que el código no hace es peor que no
   tener documento: el siguiente que lo lea «restaurará» el tope.)
3. **Provisional vs verificado**: el % de acierto se muestra **siempre que haya
   muestra** (≥1 cerrada), pero con menos de **20 señales cerradas** se marca
   **«provisional»** (muestra en construcción, sin sello verificado); a partir de
   **20** pasa a **«verificado»**. El sello/badge verde solo aparece con ≥20.
   (Decisión jun-2026: «constatar, no predecir» — se enseña el dato real con su
   muestra, y la muestra siempre visible es la salvaguarda anti-cherry-picking.)
4. **Tamaño de muestra siempre visible**: todo % de acierto va acompañado del
   número de señales sobre el que se calcula («83% acierto en 24»).
5. **Probabilidades**: se aceptan en fracción (0.72) o porcentaje (72) y se
   normalizan a fracción. Valores fuera de [0, 100] se descartan.
6. **Precio con antigüedad**: cuando se muestra un precio «actual», se indica
   la antigüedad del dato («actual · hace 12m») usando `signals.price_updated_at`.

## Fórmulas

### Retorno de una señal — `signalReturnPct(entry, exit, bias)`
```
retorno % = signo · (salida − entrada) / entrada · 100
signo = +1 si LONG, −1 si SHORT
```
- `salida` = `current_price` si la señal está abierta; `closed_price` si está cerrada.
- Si falta entrada o salida, o el resultado supera ±500% → `null` (no se muestra).

### Win rate — `winRate(ganadas, cerradas)`
```
win rate % = ganadas / cerradas · 100   (capado a [5, 95])
ganada  = señal con status hit_tp1 o hit_tp2
cerrada = señal con status hit_tp1, hit_tp2 o hit_sl
```
Las señales `anulada` (en ventana de 5 min), `expirada` (zona sin activar en
30 días) y `pendiente` **no cuentan** en ninguna métrica: ni como ganadas ni
como perdidas. Permanecen visibles con su estado y motivo.
- `cerradas = 0` → sin historial (pct=null). `1 ≤ cerradas < 20` → se muestra el %
  marcado **provisional**. `cerradas ≥ 20` → **verificado**. Devuelve
  `{ pct, n, insufficient, provisional, verified, hasData }` (`insufficient` = `!verified`, compat).

### Señales publicadas vs. cerradas — dos contadores, no uno  ★ LIGA130
```
publicadas = todas las señales del analista MENOS las anuladas en la ventana de 5 min
             (abiertas + pendientes de zona + cerradas + expiradas sin activarse)
cerradas   = hit_tp1 · hit_tp2 · hit_sl · closed_time · closed_analyst
```
- El **contador de señales** y los **umbrales de división** (20/40/80) cuentan
  **publicadas**: miden transparencia y volumen, y una señal publicada quedó sellada e
  inmutable se cerrara como se cerrara. Antes contaban cerradas bajo la etiqueta
  «publicadas», así que un analista con 4 señales activas y ningún cierre salía con
  «0 señales» y su división no progresaba.
- **Todas las métricas de rendimiento** —% de acierto, media por operación, drawdown,
  peor señal, realizado— se calculan sobre **cerradas**, y van rotuladas «cerradas»
  en cada superficie donde aparecen.
- El sello **«✓ verificado» del % de acierto** exige **20 CERRADAS** (`MIN_SAMPLE`);
  hasta ahí el porcentaje se muestra como *provisional*. No es lo mismo que la
  división «Verificado», que mide publicadas: son dos cosas y no se mezclan.
- **Cada uno de los cuatro cubos tiene una superficie donde se ve** ★ LIGA226. Si se
  cuenta, se enseña: un número que el usuario no puede abrir no es comprobable. El
  perfil reparte el histórico con tres predicados y no cabe nada por el hueco:

  | cubo | predicado | dónde se ve |
  |---|---|---|
  | abiertas (incluye `status` nulo, que es el default del esquema) | `_esViva` | pestaña **Activas** |
  | pendientes de zona + expiradas sin activarse | `_sinActivar` | pestaña **Sin activar** |
  | cerradas | `CLOSED_STATES` | pestaña **Historial** |
  | anuladas en la ventana de 5 min | — | en ninguna, y tampoco en `publicadas` |

  El fallo que lo motivó: el perfil solo tenía Historial y Activas, así que una zona
  `pending` o `expired` se contaba en «N señales publicadas» y no aparecía en ninguna de
  las dos. Un test exige que todo estado público caiga en **exactamente un** cubo.
- Las que **no entraron** (`pending`, `expired`, `voided`) no tienen resultado y la ficha
  no puede insinuar que lo tengan: ni cierre, ni retorno, ni «pérdida realizada», ni un
  `0` donde no hubo entrada (la entrada es la **zona declarada**). Sin entrada sellada no
  hay porcentaje contra el que medir, así que el objetivo y el stop se rotulan
  «declarado» en vez de «recorrido/riesgo previsto —».

### Track record a mercado — `trackRecord(señales, {sinceMs})`  ★ métrica publicable
```
realizado %  = Σ retorno_i           sobre CERRADAS con entrada y closed_price válidos
flotante %   = Σ retorno_i           sobre ABIERTAS con current_price válido
total %      = realizado + flotante  ← mark-to-market
media/op %   = realizado / nº cerradas con retorno válido
```
**Es la única cifra de rentabilidad que FARO publica como titular.** Toda superficie
que saque un % de rentabilidad fuera del perfil —tarjeta compartible descargable,
imagen OG del enlace, preview en redes— usa `total`, con `realizado` y `flotante`
al lado y con el mismo peso visual. Motivo: una cifra que solo cuenta lo realizado
**miente por omisión**, porque esconde lo que el analista está perdiendo ahora mismo;
y esas imágenes viajan fuera de la plataforma con el sello «verificado».

- Convención **aditiva**, la misma que la curva de equity y el drawdown: misma
  cantidad por señal, sin componer ni reinvertir. Por eso `total = realizado +
  flotante` es una suma legítima. `media/op` es una **media**: no se puede sumar al
  flotante ni leerse como el resultado del analista (era el error de la tarjeta
  antes de LIGA126).
- Abiertas **sin** `current_price`: no se estiman. Se cuentan en `openNoPrice` y la
  superficie lo declara («N sin precio no computan»).
- `sinceMs` acota los **cierres** a una ventana (12 meses para el criterio de nivel).
  Las abiertas entran **siempre**: su riesgo es de hoy, no de hace un año.
- Sin cerradas ni abiertas → `total = null`. Nunca un `0%` que parezca un resultado.
- Estados `expirada`, `anulada` y `pendiente` siguen fuera de todo (ver arriba).
- La función vive en `js/metrics.js`. `supabase/functions/og-card/index.ts` la
  **duplica** porque corre en Deno sin bundler; `tests/track-record.test.mjs`
  ejecuta las dos implementaciones contra las mismas señales y exige el mismo
  número, así que no pueden divergir.

### Rentabilidad media por operación — `avgReturn(retornos)`
```
media % = Σ retornos válidos / nº retornos válidos
```
- Solo señales **cerradas** con entrada y `closed_price` válidos.
- Retornos descartados por el guard no entran ni en numerador ni denominador.
- Métrica **secundaria**: se muestra siempre rotulada «(cerradas)» y nunca como
  titular de una imagen compartible (ver `trackRecord`).

### P&L flotante (feed, «pos. 1.000€»)
```
P&L € = Σ ( retorno %_i / 100 · 1.000€ )   sobre señales abiertas con precio
```
Hipótesis: 1.000€ invertidos en cada señal abierta. Es ilustrativo, no real.

### «% en ganancia» (KPI del feed)
```
% = abiertas con retorno > 0 / abiertas con precio · 100
```
Es un **hecho actual** sobre las señales abiertas (no un historial), por eso no
se le aplican el cap ni la muestra mínima del win rate.

### Racha (puntos verdes/rojos)
Secuencia de las últimas señales cerradas (más reciente primero):
verde = ganada (TP), rojo = perdida (SL). Sin datos de cierre cargados se
muestra «sin cierres aún» — el patrón ilustrativo se eliminó (jul-2026):
nunca se pintan rachas inventadas.

### Niveles de analista — `_trLevel(nPublicadas, winRate, mtm12)`
| Nivel | Requisitos |
|---|---|
| Élite | ≥ 80 **publicadas** · ≥ 60% acierto (sobre cerradas) · rentab. total 12m > 0 |
| Destacado | ≥ 40 **publicadas** · ≥ 55% acierto (sobre cerradas) · rentab. total 12m > 0 |
| Verificado | ≥ 20 **publicadas** |
| Nuevo | el resto |

El **volumen** se mide en publicadas (ver arriba: es lo que acredita transparencia);
el **acierto** y la **rentabilidad** siguen saliendo de las cerradas y del
mark-to-market. Consecuencia asumida (LIGA130): «Verificado» solo exige volumen, así
que un analista con 20 publicadas y ningún cierre alcanza esa división — que es
exactamente lo que la metodología dice que significa («acredita transparencia, no
calidad»). Su **% de acierto seguirá marcado «provisional»** hasta las 20 cerradas, y
las divisiones promocionadas (Destacado y Élite) son inalcanzables sin cierres porque
exigen acierto y rentabilidad positiva.

Los mismos umbrales están replicados en `supabase/functions/badge/index.ts` (Deno) y
`tests/badge.test.mjs` comprueba que no divergen del front.

### Orden del ranking (LIGA170)
```
orden (dentro de cada división) = Σ retorno realizado del periodo (12m/3m/1m)
```
- Aditivo y SOLO señales cerradas de la ventana: el flotante se enseña en la fila
  («no puntúa») y jamás ordena (regla LIGA154, intacta). El número grande de la
  fila ES la clave de orden.
- La media por operación, el acierto (con muestra), la R media y las entradas
  alcanzadas acompañan en la fila; sin filtro de clase se añade el «total a
  mercado» de por vida (el mismo titular del perfil). Con filtro de clase no:
  sería un número global junto a métricas de una clase (regla LIGA152).
- Sin «media anual»: anualizar ventanas parciales es una proyección disfrazada.

### Proximidad de zonas (Escenarios)
```
cerca (⚡) si |precio_actual − centro_zona| / precio_actual < 6%
```
`centro_zona` = media del rango de entrada del plan.

### Señales de zona (Fase 1.11 · activación por velas LIGA157)
Una señal `pendiente` se activa solo cuando el precio toca la zona; su
`entry` pasa a ser el **precio real de activación** y la rentabilidad se mide
desde ahí — nunca desde un precio que el mercado no tocó.

Desde LIGA157 la detección no depende solo del último precio de cada sondeo
(cada 5 min): si una **vela de 15 minutos** posterior a la publicación pisó la
banda, la señal se activa aunque el precio ya se haya ido. La entrada estampada
sigue siendo un precio negociado de verdad: el **borde de la banda cruzado**
(donde ejecutaría una limitada puesta en la zona; long entra por `zone_high`,
short por `zone_low`) o el **cierre de la vela** si quedó entera dentro. El
evento `activated` lleva `via: "vela_15m"` y la vela usada — auditable. Una
zona expirada jamás se reactiva.

## Múltiplo R — riesgo normalizado (LIGA144)

`FaroMetrics.signalR(signal, price)` · `FaroMetrics.rTrackRecord(signals, opts)`
· tests en `tests/liga144.test.mjs`.

```
R = (salida − entrada) / (entrada − stop)     · long
R = (entrada − salida) / (entrada − stop)     · short
```

Responde a «cuánto se ganó por cada unidad de riesgo asumida». Existe porque el %
depende del precio del activo y R no: es lo único que permite comparar una operación
de oro con una de una acción. Un stop tocado limpiamente es **−1R**.

**Cuatro reglas, y son las que le dan sentido:**

1. **El stop es obligatorio.** Sin riesgo declarado no hay R: la métrica devuelve
   `null`. Nunca se inventa un denominador. Ojo con la conversión de tipos —
   `Number(null)` vale 0, y con la versión ingenua una señal sin stop daba stop 0,
   riesgo = entrada y una R inventada de +0,20R. `signals.sl` es *nullable* en el
   esquema y las señales antiguas lo tienen a `null`, así que esto no es hipotético.
2. **R se calcula sobre el precio REAL de salida** (`closed_price`, el sondeo del
   proveedor), nunca sobre el nivel teórico. Un hueco que salta el stop cierra peor
   que el stop → **peor que −1R**, y así se publica.
3. **La R flotante se acota a ≥ −1**; la realizada **no se acota nunca**. Mientras la
   posición vive, el stop es la pérdida máxima asumida; una vez cerrada, la pérdida
   real es la que fue.
4. **R nunca se publica sola.** Va siempre con el **% de acierto** y la **tasa de
   entradas alcanzadas**. Motivo concreto: una R media alta con pocas entradas
   alcanzadas no describe a quien gana mucho, sino a quien propone zonas que casi no
   se tocan. Está fijado con test en el ranking y en el perfil.

`rTrackRecord` tiene la misma forma que `trackRecord`: `realizedR`, `floatingR`,
`totalR = realizedR + floatingR`, `avgR`, `bestR`, `worstR`, `profitFactor` (R ganada
/ R perdida; `null` sin perdedoras — no «infinito») y el recuento de abiertas sin
precio, que no se estiman.

**Salida única, a propósito.** El esquema solo tiene `tp1`/`tp2` y `update-prices`
cierra la señal ENTERA al primer objetivo tocado: no hay cierres parciales. Por eso R
se define sobre esa única salida real y TP2 es **informativo**. No se documenta «R por
tramo» porque describiría un mecanismo que no existe.

## Tasa de entradas alcanzadas — un solo denominador (LIGA144)

`FaroMetrics.fillRate(signals)`.

De las señales cuya activación **ya se conoce** —tocadas más expiradas sin tocarse—,
qué porcentaje llegó a activarse. **Fuera del denominador**: las pendientes (aún sin
resolver) y las anuladas en la ventana de 5 minutos.

Estaba implementada **dos veces con denominadores distintos**: el perfil público
excluía las pendientes (correcto, es la definición de Metodología §3) y el panel
privado del analista las incluía, así que al analista le salía una tasa **peor** que
la que el público veía de él mismo. Dos números para la misma métrica es exactamente
lo que prohíbe la primera línea de este documento.

## Plazos de vida por clase y versionado de metodología (LIGA174 · metodología v2)

**Vigencia: 1 de agosto de 2026.** Cada señal **sella** al publicarse la versión
de metodología (`methodology_version`) y su clase (`asset_class`, derivada del
símbolo por la whitelist — el analista jamás la elige ni la ve como campo).

**Dónde está la línea (decisión del fundador, 2-ago · LIGA182).** El cierre por
plazo es un hecho **futuro**, no un resultado ya ocurrido, así que la tabla por
clase rige **toda señal viva**: una acción abierta vence a los 180 días aunque
su fila venga sellada v1 o sin las columnas puestas (si `asset_class` falta, la
clase se deriva del símbolo con el mismo criterio en el front y en el motor).
Lo que **no se toca jamás** es el historial: una señal **cerrada** conserva el
plazo con el que cerró —escrito en `closed_by` (`rule_60d`, `rule_180d`…) el día
del cierre— y ni la etiqueta ni las métricas se recalculan. Recalcular una
cerrada sería reescribir el registro inmutable, y eso no se hace.

```
plazo máximo por clase:        divisas 60 días · cripto 90 · índices 90
  (toda señal VIVA)            · materias primas 120 · acciones y ETFs 180
plazo de una señal CERRADA:    el que tenía al cerrar (v1, hasta jul-2026: 60
                               días para todo). No se recalcula nunca.
al vencer:                     NO SE BORRA — cierre a precio de mercado de ese
                               día, status closed_time, etiqueta «cerrada por
                               plazo (N días)» y closed_by = rule_<plazo>d
% cierres por plazo (perfil) = cerradas con status closed_time / cerradas · 100
fecha de vencimiento (LIGA180, solo detalle de señal viva):
  abierta          → (activated_at || signal_date) + plazo de SU versión
  zona sin activar → expires_at (lo que compara el motor; 30 días por defecto)
  cerrada          → no se muestra vencimiento futuro
```

- **La fecha mostrada es la que el motor ejecuta, no una estimación.** En una
  zona el plazo corre **desde la activación**, porque `activated_at` se estampa
  al entrar el precio en la banda y el motor arranca la cuenta ahí. Es un dato
  derivado: no existe columna de vencimiento y el analista no lo elige. Hay un
  test que ejecuta la fórmula del front y la del motor y exige que el día del
  vencimiento cierre y el día anterior no.

- El cierre por plazo **nunca** cuenta como TP alcanzado ni como SL saltado: es
  un estado propio (`closed_time`), visible en la píldora del historial y en el
  detalle; en el % de acierto cuenta como ganadora o perdedora **según su
  retorno real** (regla LIGA111, sin cambios).
- Por qué estos plazos: los majors de divisas se mueven en rangos estrechos y
  sus tesis son de días o semanas; cripto e índices respiran en ciclos más
  largos; oro y petróleo van por ciclos macro y estacionales lentos; una tesis
  fundamental de acciones necesita un par de trimestres y resultados publicados.
- **% de cierres por plazo** (perfil, junto al fill rate): muchas caducidades =
  tesis que no se materializan en su horizonte. Indicador de calidad por sí
  mismo, con muestra visible.
- Las señales de **zona** siguen aparte: 30 días para activarse o expiran (la
  expirada no cuenta en métricas; el plazo de vida corre desde la activación).

### R: convención con TPs múltiples y huecos (gaps)

```
R = (salida − entrada) / (entrada − stop)      (long; short con signos invertidos)
```
- La R se calcula sobre el **precio REAL de salida**: un hueco de apertura que
  salta el stop da **peor que −1R** y se muestra tal cual — no se recorta a −1R.
- Con **niveles escalonados** (entrada 1-4 niveles), la entrada es la **media**
  de los niveles declarados (`entry` ya la guarda así); con TP1 y TP2, la señal
  cierra en el nivel que toque primero según las reglas del cierre — la R usa
  ese precio real de cierre. No hay R «parcial» por tramos: una señal, una R.

### Spot vs. futuros (canonicalización)

En metales con contado fiable se usa el **spot** (XAUUSD, XAGUSD…), nunca el
futuro (que vence y hay que rolarlo — GC=F/SI=F/PL=F están sin aprobar a
propósito). Donde solo existe futuro líquido (WTI, BRENT, NATGAS, COPPER,
granos) se usa el **contrato continuo de referencia** y la ficha lo dice.

### La métrica principal es el total a mercado

El titular de toda superficie pública (perfil, tarjeta, ranking sin filtro de
clase, informe mensual) es **total a mercado = realizado + flotante**: la única
cifra que no miente por omisión. El realizado solo, la media por operación y
cualquier ventana acompañan SIEMPRE con su etiqueta y su muestra.

## Rentabilidad por mes e informe mensual (LIGA165 · LIGA166)

Tabla año×mes del perfil (`_mesesRows` + `_paMesesHtml`) y página
`/a/{alias}/informe/{aaaa-mm}` (`_infDatos`). Tests: `tests/liga165.test.mjs`
y `tests/liga166.test.mjs`.

```
celda (mes)   = Σ retorno_i de las señales CERRADAS ese mes natural
                (atribución: closed_date, con signal_date de respaldo; el mes se
                 lee del STRING yyyy-mm-dd → los meses cortan en UTC)
total (año)   = Σ celdas del año
              + flotante de HOY, SOLO en el año en curso y rotulado con asterisco
fill del mes  = fillRate(señales PUBLICADAS ese mes, por published_at||signal_date)
acumulado año = Σ retornos de las cerradas del año HASTA el mes del informe
```

- Misma convención **aditiva** de `trackRecord` (sin componer, guard ±500%,
  `signalReturnPct` para todo): por construcción, **la suma de los totales de año
  (con el flotante contado una sola vez) es EXACTAMENTE el «total a mercado» del
  titular** — el test lo exige numéricamente.
- **El flotante no pertenece a ningún mes.** Una abierta no tiene «flotante de
  julio»: su valor es de HOY. Se ancla al año en curso, rotulado.
- **Mes sin cierres → guion.** Nunca un 0% que parezca un resultado; el total del
  año solo se escribe con cierres valorados o flotante valorado detrás.
- **Ningún mes se puede ocultar** (criterio de aceptación del encargo, como test):
  `_mesesRows(sigs)` no admite más parámetros y las 12 celdas se emiten siempre
  desde un único template — un mes perdedor produce el mismo markup que uno
  ganador salvo el color.
- El **fill del mes** se mide sobre las publicadas del mes y puede refinarse hasta
  ~30 días después (mientras sus zonas pendientes se resuelven): la página lo
  rotula. Los datos salen SIEMPRE del histórico completo del analista
  (`_paFullLoad`), nunca del recorte global de 200 señales.
- El informe se calcula **en vivo** al abrir la página; el cron mensual
  (`monthly-report`) solo avisa por el Telegram PRIVADO del analista y deja acta
  (`analyst_report_notices`). **Sin publicación automática en redes** (gate P1.5
  del abogado): compartir la imagen es decisión del analista.

## Tarjeta de cierre (LIGA219)

`js/tarjeta.js` · `/admin/tarjetas` · tests: `tests/liga219.test.mjs` (bloque C).

```
resultado = signalReturnPct(entry, closed_price, bias)    ← el MISMO de todo el resto
formato   = signo explícito + un decimal + coma española + espacio + %
            +27,0 %   ·   −12,3 %      (nunca «+27 %», nunca sobre el objetivo)
```

- **Sobre el precio de cierre, jamás sobre el nivel de objetivo.** El objetivo mide el
  recorrido previsto; el cierre, lo que pasó. Confundirlos fue el error humano del 10 de
  agosto (ONTO: +35,0 % impreso, +35,4 % real). El test lo fija con los dos casos reales
  y deja escrito el número que NO se imprime.
- **La tarjeta no calcula nada.** `signalReturnPct` se le inyecta: una cuarta copia de la
  fórmula sería una cuarta cosa que puede divergir del perfil, del ranking y de la ficha.
- **Simetría ganadora/perdedora, verificable.** Un único componente y **una sola**
  comparación con el signo del resultado en todo el archivo, la del color del número. El
  test compara los SVG de `+12,3 %` y `−12,3 %` línea a línea con el mismo motivo de
  cierre: solo pueden diferir la línea del número y la posición del punto de cierre.
- **Precisión de los precios**: el resolver de la app (`_priceDecimals`, por clase de
  activo) como máximo, sin ceros de relleno — los mismos números que la ficha.
- **Escala de la barra**: el precio de cierre entra en el mínimo y el máximo, así que un
  cierre fuera del rango stop–objetivo ensancha la escala en vez de salirse. Es la misma
  escala que la barra de la ficha (`_renderSenalChart`), con margen del 12 % y recorte 2–98 %.
- **Sin ratio R/R en la tarjeta**: es dato del planteamiento, no del resultado, y se deduce
  de los tres niveles.
- **La tarjeta no publica.** Genera el PNG y lo guarda en un bucket privado; publicar es un
  acto manual (gate del Bloque B). Sin modelo generativo de imagen: SVG → canvas → PNG.

## Detalle de señal · la cuarta caja (LIGA219)

En **cerradas**: `CIERRE` = precio real de cierre, con «resultado ±X%». En **abiertas**:
sigue siendo `Ratio R/R`, porque todavía no hay cierre. Los tres niveles declarados
—entrada, objetivo, stop— **no se tocan**: son los que se sellaron al publicar. Sus
porcentajes se rotulan **«recorrido previsto»** y **«riesgo previsto»**, y la palabra
«resultado» aparece **una sola vez** en la ficha (test B4, sobre los cinco estados de
cierre). La ficha usa `_pct1` (`+35.4%`), la convención de toda la app; la tarjeta usa el
formato español de arriba porque viaja fuera del producto.

## Audiencia del analista (LIGA145)

`faro_mi_audiencia(p_days)` (RPC, solo el propio analista) · pestaña «Audiencia» del panel
· tests en `tests/liga145.test.mjs`.

- **Visitas al perfil**: contador acumulado (`traders.profile_views`), +1 por sesión de
  navegador y perfil (dedupe en sessionStorage; antes era memoria y cada recarga
  re-contaba). **Visitas por día** = diferencia día a día del acumulado fotografiado por
  el snapshot — nunca la suma del acumulado, que solo puede subir.
- **Seguidores**: recuento REAL de `users.following` (`id = any(following)`). La columna
  `traders.follower_count` es una caché que el snapshot diario sincroniza.
- **Conversión visita→seguidor** = seguidores_actuales / visitas_acumuladas × 100. Ambos
  son acumulados de vida entera: es una aproximación direccional y así se rotula.
- **Entradas más vistas**: aperturas del detalle de señal (`senal_open`, con `sid`/`tid`
  desde LIGA145) — vistas totales y sesiones únicas. Solo existen datos desde el
  despliegue; la superficie muestra «se registran desde el DD-MM» con la fecha real.
- **Aperturas de historial**: evento `perfil_open` por día, misma regla de fecha.

## Fuente y frecuencia de los precios
- `signals.current_price` lo escribe la Edge Function `update-prices`
  (Yahoo Finance con respaldo Stooq), cada 5 min, todos los días (LIGA158;
  antes: cuartohorario y solo 8–23 UTC L–V — cripto en finde y forex nocturno
  quedaban sin sondear, contra lo que promete la metodología).
- La misma función cierra señales al tocar TP/SL y sella `price_updated_at`.

## Detalle de señal · gráfico de niveles (Fase 9 · A1)
El gráfico de la pantalla de señal **no muestra cotización intradía**: trazamos
únicamente datos reales que almacenamos.

- **Recorrido**: serie con la entrada (en la fecha de publicación) y el precio
  actual/`closed_price` (en su fecha real). Para señales de zona aún pendientes,
  el punto de partida es el centro de la zona hasta que se activa.
- **Líneas horizontales**: Entrada, Objetivo (`tp`) y Stop (`sl`) en su precio
  exacto; banda punteada `zone_low`/`zone_high` en señales de zona.
- **Escala**: cubre todos los niveles reales (entrada, TP, SL, zona, precio
  actual) con un margen del 8 %. No se interpola ni se inventa ningún punto.
- **% y riesgo en €** reutilizan las fórmulas ya definidas (`signalReturnPct`,
  R/R, €/1.000) — el gráfico no introduce ninguna métrica nueva.

## Línea de vida de la señal (Fase 9 · A1)
Lista los eventos de `signal_events` (tabla **append-only e inmutable**) en
orden cronológico: publicada → corregida (ventana 5 min) → activada → cerrada
(TP/stop)/expirada/anulada. Es un registro de auditoría MAR, no una métrica.

## Curva de equity del analista (Fase 9 · A3)
```
equity[i] = Σ (retorno_j)   para j = 0..i   (señales cerradas, orden cronológico)
retorno_j = signalReturnPct(entry, closed_price, bias)   (guard ±500%)
```
Es una **suma aditiva** (no compone ni reinvierte) — la misma convención que el
drawdown del perfil. Se rotula explícitamente: «No es la rentabilidad de una
cartera ni descuenta comisiones». Requiere ≥ 2 señales cerradas para dibujarse.
Implementado en `FaroMetrics.equityCurve()` (con test) y `_renderEquityCurve()`.

## Novedades desde la última visita (Fase 9 · A2)
No es una métrica, son **hechos observables** comparando `_dbSignals` contra la
marca `faro_last_visit` (localStorage, fijada una vez por sesión):
- **nuevas** = señales con `published_at`/`signal_date` posterior a la última visita;
- **cerradas** = señales en estado cerrado con `closed_date` ≥ el día de la última
  visita, desglosadas en objetivo/stop con `_sigWon()`.
Sin predicciones ni proyecciones (coherente con MAR).

## Simulación (Fase 6) — pública y con datos reales
```
serie[0] = capital
serie[i] = capital × (1 + Σ retorno_j / 100)   j = señales cerradas del periodo,
                                                orden cronológico por closed_date
retorno_j = signalReturnPct(entry, closed_price, bias)   (guard ±500%)
```
- **Solo resultado realizado**: cuentan únicamente señales **cerradas**
  (`hit_tp1/hit_tp2/hit_sl/closed_time`). Las abiertas aparecen en la tabla con
  su % en vivo pero **no** suman a la curva.
- Suma **aditiva** sobre el capital inicial (no compone ni reinvierte) — misma
  convención que `equityCurve` y el drawdown.
- Periodos 7d/1m/3m/todo filtran por `closed_date`.
- **Sin comparativa S&P/NASDAQ**: se retiró porque no disponemos de datos
  reales de índices en el cliente y no se fabrican.
- Rotulada siempre: «Simulación hipotética con capital imaginario… calculada
  sobre señales reales ya cerradas».
