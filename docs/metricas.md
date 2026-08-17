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

### Drawdown máximo vs. peor señal — dos «%» de bases distintas
```
curva:     equity = 100, y por cada cierre  equity += retorno %
drawdown = máx( (pico − equity) / pico · 100 )     ← sobre la CURVA acumulada
peor señal = mín( retorno % de una señal cerrada ) ← sobre UNA operación
```
**El drawdown puede salir MENOR que la peor señal y ser los dos correctos**, y esto
se lee como un error de cálculo si no se dice (detectado el 15-ago sobre un perfil
con «−2,6% drawdown» y «−5,0% peor señal»). El motivo es la base: una señal
de −5% sobre una curva que va por 290 la deja en 285, y eso es un −1,7% desde su
máximo. Cuanto más alto llega el acumulado, menos pesa cada pérdida individual en
el drawdown.

Por eso ambas casillas **declaran su base en la propia etiqueta** —«drawdown máx ·
de la curva» y «peor señal · una operación»— y sus tooltips se remiten mutuamente:
esconder la explicación en el glosario dejaba a la vista dos cifras que parecen
contradecirse. La fórmula del drawdown no se toca: ni puntos aditivos sueltos (−60
puntos sobre una cartera en +300% no es perder el 60%) ni compuesto a todo-o-nada
(daba un 49,6% que no casaba con el gráfico) — decidido el 8-jul-2026.

### Racha (puntos verdes/rojos)
Secuencia de las últimas señales cerradas (más reciente primero):
verde = ganada (TP), rojo = perdida (SL). Sin datos de cierre cargados se
muestra «sin cierres aún» — el patrón ilustrativo se eliminó (jul-2026):
nunca se pintan rachas inventadas.

### Niveles de analista — `_trLevel(nPublicadas, gates)` (metodología v3 · 15-ago-2026)
| Nivel | Requisitos |
|---|---|
| Élite | ≥ 80 **publicadas** · ≥ 18 **meses de historial** · **R a mercado 12m > 0**, también **sin su mejor señal** · y **R a mercado 24m > 0** |
| Destacado | ≥ 40 **publicadas** · ≥ 6 **meses de historial** · **R a mercado 12m > 0**, también **sin su mejor señal** |
| Verificado | ≥ 20 **publicadas** · ≥ 3 **meses de historial** |
| Nuevo | el resto |

Las puertas salen de **una sola llamada** a `FaroMetrics.nivelGates(señales)` →
`{meses, r12, r12SinMejor, r24}`:

- **`meses`** — antigüedad desde la señal publicada más antigua no anulada
  (`signal_date`), en meses de 30,44 días, redondeando hacia abajo. Solo se cumple
  publicando y esperando: no se puede comprar ni fabricar.
- **`r12` / `r24`** — R acumulada a mercado (cerradas sin acotar + abiertas al último
  precio acotadas a −1R) con los cierres en ventana de 12 / 24 meses.
- **`r12SinMejor`** — la misma R a 12 meses **excluyendo la mejor contribución
  individual**. Es la puerta anti-chiripa: un único acierto grande no puede sostener un
  nivel promocionado. Con menos de 2 contribuciones con stop vale `null`
  (quitar «la mejor» de una muestra de una no mide nada).
- **`null` en cualquier puerta = inevaluable = NO se aprueba.** Quien no tiene ningún
  stop registrado no asciende: la condición no se puede evaluar y no se le asigna un
  stop a posteriori. Permanece en el nivel que sus otras puertas le den.

**El % de acierto dejó de ser criterio de nivel en la v3.** Sigue publicándose como
dato descriptivo (con su «provisional» hasta las 20 cerradas), pero no abre ni cierra
niveles: era el único criterio fabricable eligiendo qué cerrar y qué dejar abierto, y
premiaba cerrar pronto las ganadoras. La escalera v2 (20/40/80 + 55%/60% de acierto +
R 12m > 0), vigente del 1 al 15 de agosto de 2026, queda publicada en la metodología
§5 («Qué cambió en la v3, y por qué»).

**La puerta de rentabilidad se mide en R desde LIGA239**, y no es la misma condición en
otra unidad: cambia quién asciende. Un cierre de +50% con el stop lejos (+0,5R) más diez
pérdidas de −1% con stops muy cerca (−1R cada una) da **suma de rendimientos +40%** y
**R acumulada −9,5R**: con la vara anterior ese analista ascendía; con esta, no. Se
evalúa **a mercado** (cerradas + abiertas al último precio) porque hacerlo solo sobre lo
realizado permitiría ascender manteniendo indefinidamente abiertas las perdedoras — el
mismo sesgo que el «total a mercado» existe para cerrar.

**Panel de progreso privado (LIGA-5).** El analista ve en su propio perfil su camino al
nivel siguiente: volumen y antigüedad con número y barra; las puertas de rentabilidad
(r12, sin-mejor, r24) **solo como ✓/✗, jamás con el valor ni la distancia** — publicar
cuánto falta diría qué operación abrir para cruzar el umbral. La misma regla rige el
checklist público del perfil: la fila «sin su mejor señal» es binaria. Ese panel no
existe en el HTML prerenderizado ni en ninguna ruta pública.

Los mismos umbrales y puertas están replicados en `supabase/functions/badge/index.ts`
(Deno: `contribR`/`nivelGates`/`tierOf`) y `tests/badge.test.mjs` comprueba que no
divergen del front. Esa réplica incluye desde LIGA239 su propia copia de `signalR`/R
total a mercado, con las mismas reglas.

### Orden del ranking (LIGA170 · métrica sustituida en LIGA239)
```
orden (dentro de cada división) = R acumulada a mercado del periodo
                                = Σ R de cerradas de la ventana + Σ R flotante de abiertas
```
- El número grande de la fila ES la clave de orden (regla LIGA170, permanente:
  rankear por una cifra y enseñar otra confunde). Lo que cambió en LIGA239 es la
  cifra, por dos motivos:
  1. **Comparabilidad.** Σ de rendimientos suma un +2% de divisas con un +60% de
     cripto como si fueran lo mismo, y premia a quien arriesga más por operación
     aunque opere peor. R normaliza por el riesgo que el propio analista declaró al
     poner el stop, y es lo único que permite comparar oro con una acción.
  2. **El flotante PUNTÚA** (esto revierte LIGA154). Dejarlo fuera del orden abre un
     agujero peor que el ruido que evitaba: se sube en el ranking no cerrando las
     perdedoras. El nerviosismo queda acotado por construcción — la R flotante se
     limita a −1 y el plazo por clase obliga a cerrar en 60–180 días.
- **Sin señales con stop → `null`, jamás `0R`**: esa fila cae al final de su división
  rotulada «R no disponible». Un 0 se lee «ni ganó ni perdió»; lo cierto es «no se
  puede saber».
- Las abiertas entran **enteras** aunque haya ventana: una posición viva es riesgo de
  HOY, no del periodo en que se abrió (misma convención que `trackRecord` para el %).
- **Empate técnico aparte: quien tiene 0 cerradas va al final de su división**
  (LIGA-6), por alta que sea su R flotante. La R se enseña entera y el flotante sigue
  puntuando —es lo que impide subir no cerrando las perdedoras—, pero un resultado
  flotante no es un resultado hasta que se cierra, y adelantar con él a quien sí tiene
  historial contradice la pregunta que encabeza la página.
- La **suma de rendimientos** (el titular anterior) no desaparece: baja a la línea
  secundaria junto a la media por operación, el acierto (con muestra), la R media y
  las entradas alcanzadas. Sin «media anual»: anualizar ventanas parciales es una
  proyección disfrazada.

**La línea secundaria (LIGA-6): un set fijo de campos, en `RK_CAMPOS`.**
`acierto · media/op · suma de rendimientos · R media · entradas · stop medio ·
abiertas`. **Todas** las filas los recorren enteros y escriben «—» donde no hay dato:
antes cada campo se añadía solo si existía y dos filas nunca eran comparables (una
decía «suma de rendimientos» y la de al lado «flotante», y el lector no sabía si el
dato faltaba o el analista no lo tenía). Reglas del set:

- **El flotante va en R, no en %** (LIGA-6). Un «flotante +16,5%» junto a un titular
  «+7,05R» —las dos cifras a mercado— se leía como una contradicción de la misma
  magnitud consigo misma. Sin abiertas se escribe «sin abiertas», no se omite.
- **La distancia media al stop entra en la fila** (LIGA-6): una R alta con stops muy
  estrechos no es la misma R que con stops holgados, y desde el ranking no había cómo
  distinguirlas. Se calcula sobre las señales de **la misma ventana y clase** que el
  resto (regla LIGA152), igual que las entradas alcanzadas.
- **La traducción «≈ X% arriesgando 1%» no se imprime**: vive en el `title` de la
  cifra R y, para móvil, en el desplegable «ⓘ Qué es una R». Impresa, era un
  porcentaje entre porcentajes de otras cosas — el problema que LIGA-6 vino a cerrar.
- El «total a mercado» de por vida **no vuelve** a esta línea (LIGA-3): ver la sección
  del ranking arriba y el glosario `mtm` del perfil.

### Suma de rendimientos — el nombre honesto de la métrica anterior
```
suma de rendimientos = Σ retorno % de las señales cerradas del periodo
```
Se llamaba «rentabilidad acumulada» y esa etiqueta afirmaba algo falso: **no es la
rentabilidad de ninguna cartera**. Para serlo harían falta tres supuestos que no se
cumplen — el 100% del capital en cada señal, sin composición y sin solapamiento
temporal. El número no era incorrecto; la palabra que lo describía, sí. Sigue visible
en la fila del ranking, en la ficha de perfil y como **cifra principal de la tarjeta
compartible** (ahí es deliberado: es la cifra que un lector entiende sin explicación).

### Distancia media del stop — `avgStopDistancePct(señales)`
```
distancia media = media de |entrada − stop| / entrada · 100   (solo señales con stop)
```
El contexto obligatorio de R. R normaliza por el riesgo DECLARADO, y quien lo declara es
el analista al poner el stop: dos analistas con la misma R media pueden ser un intradía
con stops al 0,3% y un swing con stops al 8%. Sin este dato, el lector concluye «opera
mejor» donde lo que hay es «opera distinto». FARO no prohíbe ningún estilo: lo enseña —
la misma doctrina que publicar el flotante y acompañar el acierto de su muestra.

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

### A qué precio cierra una señal (LIGA-33)
Antes se grababa `regularMarketPrice`, un número suelto: con el mercado abierto es
el precio vivo, con el mercado **cerrado** se queda congelado en el cierre de la
sesión. El DAX cierra a las 17:30 y `update-prices` sigue pasando por la tarde-noche,
así que casi todas las pasadas sobre una señal del DAX caían con el mercado cerrado y
el cierre se grababa decenas de puntos más allá del nivel. Su fallo gemelo: una señal
que tocaba el objetivo y volvía **antes** del siguiente sondeo no se cerraba nunca.

Mirar más a menudo no arregla ninguno de los dos — fuera de horario el número es el
mismo. El motor **lee la sesión**:

- Se **detecta** con el recorrido de cada vela (máximo y mínimo), no con el último
  precio. Velas de **1 minuto**, con respaldo a 5 m y 15 m.
- Se **rellena en el NIVEL**. Única excepción: si la vela **abrió ya pasada** el nivel,
  ahí no había forma de ejecutar y el relleno es su **apertura**. Es un hueco, y vale en
  los dos sentidos: en contra pierde más de −1R, a favor da más que el objetivo.
- Si **una misma vela** tocó stop y objetivo, manda el **stop**: dentro de una vela no se
  sabe cuál llegó primero, y esa duda no se resuelve a favor del analista. Entre velas
  distintas sí se sabe, y manda la primera.
- Solo cuentan las velas **posteriores** a que la señal existiera.
- La **fecha** del cierre es la de la vela, no la del día en que se detecta.
- **Sin velas** (proveedor caído) se cierra igual, pero rellenando **en el nivel** — nunca
  en el precio del sondeo, que es el fallo que todo esto corrige.

**Qué objetivo cierra.** El **primero** que el precio puede alcanzar, y solo ese: el más
cercano a la entrada de los declarados, elegido por **nivel** y no por el nombre del campo
(`hit_tp1`/`hit_tp2` dice de cuál salió). El motor comprobaba el TP2 **antes** que el TP1,
así que una señal que pasaba de largo por los dos se apuntaba el segundo — un nivel al que
llegó después de que el primero hubiera cerrado la posición. Además dejaba un agujero:
con «cuenta el mejor de los dos», declarar un TP2 lejísimos sale gratis, nunca perjudica y
a veces regala. Es la «salida única» que este documento ya declaraba más abajo.

El evento del cierre lleva el precio grabado, el del sondeo y `via` (`vela`,
`nivel_sin_velas` o `plazo`): un cierre tiene que poder explicarse solo.

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
2. **R se calcula sobre el precio REAL de salida** (`closed_price`). Desde LIGA-33 ese
   precio es **el nivel tocado**, leído en las velas de la sesión — antes era el sondeo
   del proveedor, y con el mercado cerrado el sondeo se queda congelado en el cierre de
   sesión: una señal que tocaba su objetivo se grababa decenas de puntos más allá, y
   siempre en la dirección que favorecía al analista. La única salida que no es el nivel
   es el **hueco**: si la vela abrió ya pasada, se graba su apertura, que cierra peor que
   el stop → **peor que −1R**, y así se publica. Vale en los dos sentidos: a favor da más
   que el objetivo, y también se publica tal cual.
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
- La R se calcula sobre el **precio REAL de salida**: el **nivel** tocado, salvo hueco
  de apertura, que da **peor que −1R** y se muestra tal cual — no se recorta a −1R.
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

## La dirección no se supone nunca (LIGA-13 · auditoría externa 15-ago-2026)

```
dirDeclarada(bias) = 'long' | 'short' | null      ← null si no consta
signalReturnPct(entry, exit, bias) = null  si dirDeclarada(bias) == null
signalR(señal, precio)             = null  si dirDeclarada(señal.bias) == null
```

Un auditor externo sacó por `/verificar` el payload sellado de una señal y encontró
`direccion=` vacío. El sello era **honesto** —escribe lo que la API devuelve, y esa
señal se publicó sin dirección— y el generador no tenía bug. Lo que sí lo tenía era
todo lo demás: la app rellenaba el hueco con `'long'` en 19 puntos, así que enseñaba
«↑ Long» y publicaba un rendimiento calculado como largo. En una señal con entrada 270
y precio 300, eso son **+11,1% publicados donde lo cierto es «no se puede saber»**; si
hubiera sido corta, −11,1%.

- **Sin dirección declarada no hay resultado.** Ni %, ni R, ni entrada en los
  agregados: la señal se cuenta como publicada (y como abierta, si lo está) pero no
  aporta rendimiento, igual que una señal sin stop no aporta R.
- **La interfaz lo dice**, no deja el hueco mudo: «Sin dirección declarada» donde iría
  LONG/SHORT, en gris —ni el verde de larga ni el rojo de corta— y con el porqué en el
  tooltip. Tampoco viaja fuera: la tarjeta compartible exporta `null`, no una
  suposición.
- **`isLong` sobrevive solo para geometría** (qué lado de la barra es riesgo y cuál
  recompensa). Lo que no puede volver a hacer es entrar en el cálculo: pasarle
  `isLong ? 'long' : 'short'` a `signalReturnPct` devolvía la suposición ya convertida,
  y esa era la puerta de atrás por la que el % inventado seguía saliendo.
- **Ninguna señal nueva puede nacer así**: `validateSignalPayload` exige `long`/`short`
  desde antes del hallazgo, y el webhook publica siempre a través de `create-signal`.
  Las históricas afectadas se quedan como están —tocar el dato cambiaría su huella y
  rompería la verificación contra lo ya anclado— pero dejan de mentir en pantalla.

**Por qué no lo cazamos antes:** no faltaba un test, **sobraba** uno. En
`tests/metrics.test.mjs` estaba escrito «bias ausente se trata como long» como
comportamiento correcto, así que la suposición pasaba todas las revisiones. Ese test
está ahora invertido, y `tests/liga230.test.mjs` comprueba además que ningún campo
obligatorio del payload quede vacío — la verificación de **completitud** que no
existía, distinta de la de **formato**, que sí existía y nunca falló.

## Y el arreglo se dio por terminado a medias (LIGA-15 · 15-ago-2026)

LIGA-13 arregló la ficha de señal y `js/metrics.js`, y ahí se dio por cerrado el
asunto. No lo estaba: la misma suposición seguía viva en **siete superficies más**,
y tres de ellas ni siquiera son la app, así que aquel arreglo no podía alcanzarlas.

| Superficie | Qué publicaba con la dirección supuesta |
|---|---|
| Badge embebible | % de acierto, R **y el nivel** — servido dentro de webs de terceros |
| Imagen al compartir | el % del perfil, visible en cualquier previo de enlace |
| Perfiles `/a/<alias>` | columna «larga» en la tabla de cerradas, en páginas que indexa Google |
| Telegram | «↑ alcista» al publicar y el retorno al cerrar — difusión que no se corrige |
| `recalc-levels` | **persistía** acierto y nivel en la base de datos |
| Portada | «↑ Long» en el widget de señales activas |
| Búsqueda por activo | «↑ Subida» en la ficha resumida |

La lección no es que faltara un arreglo: es que **nada impedía dar por terminado un
arreglo a medias**. Por eso lo que más vale de LIGA-15 no es ninguna de esas siete
correcciones, sino el guardián de `tests/liga-15.test.mjs`, que lee las columnas
selladas del propio `js/sello.js` y recorre las trece superficies buscando cualquier
`campo || 'valor'`. Los casos legítimos se declaran uno a uno con su motivo, y la
deuda conocida va inventariada para que solo pueda encoger.

### El efecto secundario que trajo el propio arreglo

Al dejar de suponer la dirección, `_sigWon` empezó a devolver `false` para las señales
cuyo retorno ya no se puede calcular. Esas señales pasaron de **ganadas por suposición**
a **perdidas por defecto**: el mismo invento con el signo cambiado, y encima
penalizando a quien no tiene culpa del dato que falta.

```
sigGanadora(señal) = true | false | null       ← null = no se puede saber
aciertoDe(señales) = {wins, n, inevaluables}   ← n EXCLUYE las inevaluables
```

Tres de los cinco cierres se deciden por el estado y no necesitan dirección (tocar
objetivo es ganar, tocar stop es perder). Los otros dos —cierre por plazo y cierre
anticipado del analista— se deciden por el **signo del retorno real**, y ese signo no
existe sin dirección: subir es ganar en una larga y perder en una corta.

- Una señal inevaluable **sale de la muestra entera**: ni numerador ni denominador.
  Con 3 cerradas de las que una no se puede juzgar, el acierto es «1 de 2», no «1 de 3».
- **Tampoco pinta veredicto**: ni punto rojo en el historial, ni color de perdedora en
  la tarjeta, ni emoji 🔴 en Telegram, ni celda roja en el perfil estático. Un color es
  una afirmación como cualquier otra.
- El resumen mensual cuenta **tres cubos** (ganadas, perdidas, sin determinar) en vez
  de deducir las perdidas restando, que era como acababan ahí sin que nadie lo decidiera.
- «N cerradas» sigue contándolas todas: son cierres reales. Lo que cambia es la muestra
  del **acierto**, y por eso las dos cifras pueden no coincidir.

## Un campo ausente no se rellena nunca (LIGA-16 · 15-ago-2026)

LIGA-13 y LIGA-15 cerraron la dirección. La auditoría de la interfaz enseñó que la
dirección era un caso de un patrón: **seis campos más se rellenaban con un valor por
defecto cuando el dato no existía**. Todos corregidos, por orden de daño:

| Campo | Qué enseñaba inventado | Ahora |
|---|---|---|
| `status` | «Señal activa», banda en vivo y **fecha de vencimiento** calculada | «Señal sin estado declarado»; ni resultado ni vencimiento |
| euros de «Ganaste» | euros del **nivel de objetivo**, o un «+0 €», bajo el rótulo del resultado real | el objetivo alcanzado se afirma; la cifra solo si se puede calcular |
| marcador del analista | los contadores de `traders`, que escribe un cron **semanal** | se calcula en vivo, con la misma muestra que el % de acierto |
| `currency` | los niveles sellados con un **«$» supuesto** | precio desnudo: mejor sin unidad que con una unidad falsa |
| `methodology_version` | «metodología v1» sobre un campo **sellado y vacío** | «metodología no declarada» |
| `trader_id` | atribuía la señal a **«InvestX»**, que es una cuenta real | «Analista no identificado» |

Y uno que apareció al escribir su propia prueba: **`fmtPrice(null)` imprimía «0 €»**.
`Number(null)` es 0 y 0 es finito, así que una señal sin stop declarado enseñaba
«Stop 0 $» — un nivel de precio inventado sobre un campo sellado. Ningún activo que
publica FARO cotiza a cero: un 0 ahí solo puede ser un hueco.

**La regla, sin excepciones:** si el dato no existe, la interfaz no enseña un valor.
Ni uno plausible, ni un cero, ni un color, ni un emoji, ni una fecha. Se dice el hueco.

Lo que sostiene la regla no son estas seis correcciones sino el guardián de
`tests/liga-15.test.mjs`: lee las columnas selladas del propio `js/sello.js` y recorre
trece superficies —las de la app y las de Deno— buscando cualquier `campo || 'valor'`.
Los casos legítimos se declaran uno a uno con su motivo; la deuda pendiente va
inventariada para que solo pueda encoger. Tras LIGA-16 ese inventario está **vacío**.
