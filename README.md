# FARO · Registro de integridad

Este repositorio existe para que **no tengas que fiarte de FARO**.

Cada día publicamos aquí la huella criptográfica (SHA-256) de cada señal sellada, y un
*digest* que las encadena con el del día anterior. Si alguien —nosotros incluidos—
cambiara el precio de entrada, el stop o el objetivo de una señal publicada hace tres
meses, su huella dejaría de cuadrar, y con ella todos los digests posteriores.

Puedes comprobarlo tú, con `sha256sum` y sin pedirnos nada. (De una señal en publicación
diferida, en cuanto se revela: mientras vive, sus datos no son públicos. Ver «Señales en
publicación diferida».)

- **La web**: <https://getfaro.org>
- **Cómo verificar, con la explicación larga**: <https://getfaro.org/verificar>
- **Las reglas con las que se calcula todo**: <https://getfaro.org/metodologia>

---

## Qué hay aquí

```
integridad/
  cadena.txt          el índice de la cadena: una línea por día, con su digest
  AAAA-MM-DD.txt      el archivo de cada día: el contenido sellado de cada señal y su huella
  AAAA-MM-DD.txt.ots  la prueba de tiempo de ese archivo (OpenTimestamps → Bitcoin)
  indice.txt          el buscador: id de señal → huella → en qué archivo está
  compromisos/AAAA-MM/<id>.txt      el compromiso de una señal en publicación diferida: su huella, sin sus datos
  compromisos/AAAA-MM/<id>.txt.ots  la prueba de tiempo de ese compromiso
tools/sellar.mjs      el generador, para que lo ejecutes tú (ver «La auditoría completa»)
js/sello.js           la canonicalización: las reglas del formato, en código y comentadas
docs/metricas.md      las fórmulas de las métricas que publica la web
.github/workflows/compromiso.yml  el workflow que escribe los compromisos (sus ejecuciones, en Actions)
```

**Sobre `indice.txt`, para que nadie lo malinterprete:** es un *puntero*, no una prueba.
Existe para que encuentres en qué archivo cayó una señal sin tener que abrirlos todos, y
se regenera entero en cada ejecución a partir de los archivos diarios. La prueba es
siempre el archivo del día: si este índice mintiera, la comprobación contra el archivo
fallaría — y eso es exactamente lo que queremos que pase.

Cada archivo diario contiene, por cada señal, su **payload canónico** —el texto exacto
que se hashea— seguido de su huella; de una señal en publicación diferida que aún vivía al
anclarse, solo su huella (ver «Señales en publicación diferida»). Al final, el digest del día
y el del día anterior.

Lo que te vas a encontrar, y conviene saber leer:

- **El primer archivo es el bloque inicial.** Su fecha es el último día que cubre, no el
  día en que se creó; la fecha real de incorporación está escrita dentro. Ver la
  limitación 5.
- **Señales «tardías».** Una señal puede hacerse pública días después de publicarse (se
  valida más tarde). Entra en el archivo del día en que entró al registro, y la cabecera
  lo dice. Su fecha real de publicación está en el campo `publicada` de su payload, sin
  retocar: si el anclaje fuera muy posterior a la publicación, lo ves ahí. No es la única
  causa: una señal cuya entrada fija el mercado entra el día que queda fijada, y una que esta
  cadena se saltaba sin deber, el día que se corrige; de esas últimas, una NOTA en ese mismo
  archivo dice cuáles son (ver las dos NOTAS de abajo).
- **Bloques `⚠ INCIDENCIA DE INTEGRIDAD`.** Cada día se recalcula la huella de **todo** lo
  ya anclado (de una diferida que sigue viva no se puede: se comprueba que su compromiso sigue
  diciendo lo anclado). Si una señal sellada dejara de coincidir con la huella que se publicó, se
  escribe aquí, con las dos huellas y el archivo donde estaba la original — que no se
  toca. Un sistema que detecta esto y se lo calla no vale nada. Si ves uno, escríbenos y
  pregunta qué pasó.
- **Archivos que empiezan por `faro-archivo-v2`.** Son los días que llevan alguna señal en
  publicación diferida, y su cabecera dice cómo leer sus bloques. Todos los demás siguen
  exactamente igual que siempre, y el digest se calcula igual en los dos (`faro-cadena-v1`).
- **Bloques `NOTA · compromiso(s) SIN SU SEÑAL A LA VISTA`.** Un compromiso publicado aquí cuya
  señal no sale en la lectura pública y que no está anclado en ningún día. Un compromiso no se
  borra, porque de una señal diferida es la única prueba de que existió: si su señal deja de
  verse, el archivo de cada día lo dice, con el compromiso y su huella, mientras siga así. Es una
  nota y no una incidencia: no dice que algo sellado haya cambiado.
- **Bloques `NOTA · N señal(es) públicas que esta cadena NO ANCLA`.** Señales públicas cuya
  entrada ya no puede cambiar —son a mercado, o ya terminaron— pero que no están marcadas como
  definitivas, así que aquí no se anclan y no se anclarían nunca. Mientras sigan así, nada de
  este registro prueba que no cambien, y por eso se dicen en el archivo de cada día: una línea
  por señal, con su publicación, su tipo y estado y su causa si se conoce; el rango de fechas; y
  la huella de la lista (el sha256 de sus ids, ordenados, uno por línea y con salto final:
  `sort ids.txt | sha256sum` con `LC_ALL=C`). La corrección que las marca exige esa huella: no
  corre sin que la lista esté publicada aquí antes. Corregidas, se anclan como tardías.
- **Bloques `NOTA · N de esas tardías son de las que esta cadena NO ANCLABA`.** El archivo del día
  en que por fin se anclan dice cuáles son y el primer archivo que dijo que no se anclaban. No se
  hicieron públicas tarde, como dice de las tardías su párrafo de siempre: lo tardío es su anclaje.
  Y de ellas, esto prueba que no han cambiado desde ese día, no desde que se publicaron.

---

## Verificar una señal · ejemplo completo

Coge cualquier señal de getfaro.org. Su ficha muestra su huella. Vamos con una real:

**1 · Busca la huella en el archivo del día.**

```bash
git clone https://github.com/teaminvestx-oss/faro-integridad.git
cd faro-integridad
grep -rn "b4e45b814cd48de0ee336bc3ff699fa2d5e98a5eef59849770bb34e0d3816bd8" integridad/
```

**2 · Mira el bloque que hay justo encima.** Es lo que FARO selló:

```
faro-sello-v1
id=62ae03d1-456c-40f8-b81e-87e8fa8ad317
analista=bandito03
simbolo=EURUSD=X
direccion=long
tipo=zone
entrada=1.1544678211212158
zona_min=1.154
zona_max=1.1545
stop=1.1533
objetivo1=1.16
objetivo2=
publicada=2026-08-12T13:25:14.238+00:00
metodologia=v2
tesis_sha256=57f0a5aec7c293eff0001fe220aba6a0269b9b0c2c1587700e3c527bbbd92930
```

**Compara esos valores con lo que ves en la página de la señal.** Este paso es mirar: el
activo, la dirección, la zona de entrada, el stop y el objetivo tienen que ser los mismos.
Si no lo son, la web te está enseñando algo distinto de lo que selló.

(Si encima de la huella lo que hay no es un payload sino la línea
`comprometida · se revela en estado terminal`, la señal está en publicación diferida y
seguía viva al anclarse: sus datos todavía no son públicos, y este paso y el siguiente se
hacen cuando se revele. Ver «Señales en publicación diferida».)

**3 · Comprueba que la huella sale de ese texto.** Guárdalo en un archivo —desde
`faro-sello-v1` hasta la línea `tesis_sha256=`, ambas incluidas, **con salto de línea
final**— y:

```bash
sha256sum sello.txt
# b4e45b814cd48de0ee336bc3ff699fa2d5e98a5eef59849770bb34e0d3816bd8  sello.txt
```

Este paso es aritmética. No hay forma de que ese texto dé otra cosa.

**4 · Comprueba la tesis** (opcional). El texto del análisis está en la página; su hash es
el del campo `tesis_sha256`:

```bash
printf '%s' 'Zona de demanda en 4h con divergencia.' | sha256sum
# 57f0a5aec7c293eff0001fe220aba6a0269b9b0c2c1587700e3c527bbbd92930
```

**5 · Comprueba la cadena** (opcional, pero es lo que hace fuerte al sistema). El digest
de un día es el SHA-256 de este texto:

```
faro-cadena-v1
fecha=AAAA-MM-DD
anterior=<digest del día anterior>
<todas las huellas del día, ordenadas alfabéticamente, una por línea>
```

Con salto de línea final. El propio archivo del día lo trae escrito al final, comentado.
Como cada digest incluye el anterior, **alterar una señal vieja rompe todos los digests
posteriores**, no solo el suyo.

---

## Señales en publicación diferida

Un emisor puede publicar en **diferido**: mientras la operación vive, su instrumento, su
dirección y sus niveles no son públicos, y al llegar a un estado terminal se revela todo.
Nadie de fuera puede calcular la huella de una diferida viva, porque le faltan los datos.
Para esas señales lo de arriba cambia en tres sitios, y se dice entero:

**1 · Primero, el compromiso.** Cuando la señal queda sellada (a los 5 minutos de
publicarse), FARO publica aquí su **compromiso**, `integridad/compromisos/AAAA-MM/<id>.txt`
(el mes de su publicación, en UTC), con su prueba de tiempo al lado (`.ots`). Lleva el id,
la fecha de publicación, la versión del sello y la huella; ni el payload, ni un nivel, ni el
instrumento. Debajo de unas líneas de comentario (`#`):

```
faro-compromiso-v1
id=<id de la señal>
publicada=<su fecha de publicación, tal cual la da la API>
sello=faro-sello-v2
huella=<el sha256 de su payload faro-sello-v2>
comprometida · se revela en estado terminal
```

Esa huella es **una afirmación nuestra** hasta que la señal se revela. Lo que sí puedes
comprobar desde que está aquí es que existe y desde cuándo: su `.ots` la fecha en Bitcoin.

**Si un compromiso llega tarde, lo dice.** Si cuando se calcula la señal ya está en un estado
terminal —ya revelada—, su cabecera empieza con `⚠ ESTE COMPROMISO LLEGÓ TARDE` y el estado en
que estaba. Un compromiso así no demuestra lo que un compromiso existe para demostrar: su prueba
de tiempo es de después de la revelación. Su huella es la de la señal revelada, y la cadena
diaria la ancla igual. Las líneas de datos no cambian.
Para el compromiso hay dos plazos, **fijados antes de medirlos**: llegar aquí **como mucho
15 minutos** después de que la señal quede sellada, y quedar en un bloque de Bitcoin **antes
de 24 horas** desde su publicación. **Son objetivos, no medidas**: se medirán con la primera
señal diferida real, antes de abrir el modo a nadie más.

Lo escribe el workflow `.github/workflows/compromiso.yml` de este repositorio, con el mismo
`tools/sellar.mjs` que ejecutas tú, en su otro modo (`--compromiso <id>`) —el workflow lleva
escrito el sha256 de los generadores que acepta, y no ejecuta otro—, y con la **única
credencial de lectura** de todo el sistema de integridad, una de **solo lectura**: lee, de
todas las señales públicas, las columnas que su huella necesita —también las que la lectura
pública retiene—; no tiene permiso de escritura sobre ninguna tabla de FARO, y no puede
escribir ni ejecutar nada que no pueda ya cualquiera con la clave anon. Sus ejecuciones son
públicas, en la pestaña Actions de este repositorio.

**2 · Después, el archivo del día, con dos formas nuevas de bloque.** A la mañana siguiente
del día en que se publicó, la señal entra en el archivo de ese día como cualquier otra, y
ese archivo empieza por `faro-archivo-v2`. Sus bloques son de una de estas tres formas:

- de `faro-sello-v1` a `tesis_sha256=`: una señal en abierto, como siempre;
- de `faro-sello-v2` a `nonce=`: una diferida ya revelada. Es el payload de siempre con la
  versión nueva en la primera línea y una línea más al final, un nonce aleatorio de 32 bytes
  que impedía adivinar su huella probando mientras la operación vivía. Se recalcula igual,
  con `sha256sum`, de `faro-sello-v2` a `nonce=`, ambas incluidas y con salto final;
- `comprometida · se revela en estado terminal`, seguida de `id=`, `compromiso=` y
  `huella=`: una diferida que seguía viva al anclarse. Sin payload. Su huella es la de su
  compromiso —la línea `compromiso=` dice cuál— y tiene que ser la misma.

El digest del día se calcula exactamente igual, con **todas** las huellas del día, también
estas: `faro-cadena-v1` no cambia.

**3 · Al revelarse, la comprobación.** La señal llega a un estado terminal y la API pública
la devuelve entera, nonce incluido. Construye su payload `faro-sello-v2` (las reglas de abajo,
con la línea `nonce=` al final): su `sha256` tiene que ser la huella de su compromiso.
`node tools/sellar.mjs --check` lo hace por ti; si lo revelado no diera lo comprometido, lo
imprime como `INCIDENCIA`. Para ejecutarlo con una diferida, tu copia del registro tiene que
estar al día (`git pull`): la huella de una diferida viva sale de su compromiso, que está en
ella.

---

## Las reglas del formato, por si quieres reconstruirlo desde cero

Los datos de cada señal en abierto son públicos y los puedes pedir tú; los de una en
publicación diferida, en cuanto se revela. Se piden a `signals_publico`, la
lectura pública de las señales —la misma que usa el generador—: de una señal publicada en
abierto devuelve la fila tal cual, con los mismos literales que se hashean; de una diferida
viva, lo que no es público sale vacío (el nonce también), y de una revelada, la fila entera.

```bash
curl -s "https://zttwhjkfmhiaztpvhbbn.supabase.co/rest/v1/signals_publico?id=eq.<ID>&select=*" \
     -H "apikey: <la clave anon, visible en el código fuente de getfaro.org>"
```

Para construir el payload:

| regla | |
|---|---|
| **Codificación** | UTF-8, líneas separadas por `\n`, **con salto de línea final** |
| **Orden** | El de arriba, fijo. Todas las líneas siempre presentes |
| **Números** | Los caracteres **exactos** del JSON. Sin reformatear, sin quitar ceros, sin notación científica |
| **Fechas** | La cadena **exacta** que devuelve la API |
| **Nulos** | Línea presente, nada después del `=` |
| **Tesis** | SHA-256 de sus bytes UTF-8, sin normalizar ni recortar. Vacío si no hay tesis |
| **Versión** | La primera línea: `faro-sello-v1` para una señal en abierto; `faro-sello-v2` para una en publicación diferida. Si algún día cambia el formato, será otra versión y esto seguirá valiendo para lo viejo |
| **Nonce** | Solo en `faro-sello-v2`: una línea más al final, `nonce=` y sus 64 caracteres hexadecimales tal cual los da la API (`sello_nonce`) |

**Sobre los números, que es donde esto se rompe:** una entrada real vale
`1.1544678211212158`. Si la parseas a coma flotante y la vuelves a imprimir, el resultado
depende de tu lenguaje y de tu biblioteca JSON — `jq` 1.6 pierde dígitos ahí y `jq` 1.7
no. Por eso la regla es **copiar los caracteres**, no reimprimir el número. Nuestro
generador lleva un escáner que preserva el literal en vez de un `JSON.parse`.

### La auditoría completa, en un comando

El generador **está en este mismo repositorio** (`tools/sellar.mjs` + `js/sello.js`), y lo
que ejecutas tú no usa ninguna credencial: lee la misma API pública que acabas de usar tú y
no escribe en ninguna base de datos. (Su otro modo, `--compromiso`, es el del workflow de
compromisos, y es el único que usa una: la de solo lectura de «Señales en publicación
diferida».) Con Node 18 o superior:

```bash
git clone https://github.com/teaminvestx-oss/faro-integridad
cd faro-integridad
node tools/sellar.mjs --check
```

Eso **recalcula la huella de todas las señales ancladas** contra la API pública —de una
diferida que sigue viva no puede: comprueba que lo anclado es su compromiso, y la recalcula
en cuanto se revela— y las compara con lo que hay publicado aquí. Si una señal sellada hubiera cambiado en la base
de datos, lo imprime con su id y las dos huellas (`INCIDENCIA`). Si en cambio dice
`faltaría integridad/<ayer>.txt` y sale con código 1, depende de la hora. **Hasta la hora a
la que sale el archivo de ayer** —por la mañana: en septiembre de 2026, entre las 07:30 y
las 09:00 UTC— es que aún no se ha generado: vuelve más tarde o genera tú ese archivo con
`node tools/sellar.mjs` y compáralo cuando se publique. Con tu copia del registro al día,
si lo dice de un archivo anterior al de ayer —a cualquier hora— o si pasada esa franja lo
sigue diciendo, **ya no es la espera normal**: el trabajo se ha retrasado o ha fallado, y
lo publicado ese día sigue sin anclar hasta que salga.

Una honestidad más: el **bloque inicial no se puede regenerar desde cero**, porque su
forma depende del día en que se creó (todo lo anterior entró de golpe ese día). Sus
huellas y su digest, una a una, sí: son aritmética sobre este archivo, como en el ejemplo
de arriba.

---

## La prueba de tiempo (OpenTimestamps)

Todo lo anterior demuestra **qué** se publicó; los `.ots` demuestran **cuándo**. Cada
archivo diario —y cada compromiso— se sella con [OpenTimestamps](https://opentimestamps.org): su SHA-256 se
agrega, junto a miles de hashes de otra gente, en una transacción de **Bitcoin**. Desde
ese momento, «este archivo existía en la fecha del bloque» lo demuestra la cadena de
bloques — no FARO, no GitHub.

**El ciclo, para que nada te sorprenda:**

- Al sellar, el `.ots` nace **pendiente**: contiene los compromisos de los calendarios,
  no todavía el bloque. Cuando la transacción confirma (horas), la ejecución del día
  siguiente lo **completa** (`ots upgrade`) y el `.ots` cambia por última vez.
- Por eso los `.ots` son **lo único de este registro que puede modificarse** después de
  publicado — exactamente una vez, de pendiente a completo, y es el protocolo OTS, no
  una reescritura. Los `.txt` no cambian jamás; eso lo vigila el propio flujo.
- Los archivos anteriores al sellado se sellaron **cuando se activó** (backfill): su
  prueba dice que existían en esa fecha, no antes. La misma honestidad que el bloque
  inicial.

**Verifícalo tú**, de más fácil a más purista:

1. **Sin instalar nada**: abre <https://opentimestamps.org>, arrastra el archivo `.txt`
   y su `.ots`. Te dice en qué bloque de Bitcoin está anclado.
2. **Cliente JavaScript**, verifica contra exploradores públicos de bloques.
3. **El de referencia** (`pip install opentimestamps-client`):
   `ots verify integridad/AAAA-MM-DD.txt.ots` — contra tu propio nodo de Bitcoin, sin
   fiarte ni de los exploradores.

---

## Qué demuestra esto, y qué no

Decirlo entero es parte del trato:

1. **Demuestra que un registro no ha cambiado desde que se selló. No demuestra que el dato
   fuera correcto al sellarlo.** Una entrada mal capturada queda anclada igual de mal.
2. **La integridad del precio depende de la fuente de precios** (Yahoo/Stooq), no de la
   huella. Esto fija lo que dijimos, no lo que hizo el mercado.
3. **Una señal borrada antes de sellarse no deja rastro aquí.** Esto protege lo publicado;
   no prueba que no hubiera nada más.
4. **Lo publicado un día queda anclado al día siguiente, no al instante.** La cadena va
   por días UTC completos y el archivo de cada día se genera a la mañana siguiente. El
   trabajo está programado a las 03:10 UTC, pero GitHub Actions lo arranca con retraso: en
   septiembre de 2026, entre las 07:30 y las 09:00 UTC. En el peor caso —una señal publicada
   justo pasada la medianoche UTC— son unas **33 horas**, y más el día que el retraso es
   mayor o el trabajo falla. En esa franja la integridad de una señal recién publicada sigue dependiendo de
   nuestra palabra, no de estas huellas — y su ficha en getfaro.org lo dice mientras esté
   así. De una señal en publicación diferida llega antes su compromiso, con los dos plazos
   de «Señales en publicación diferida», que son objetivos todavía sin medir.
5. **El anclaje empieza el día del primer digest.** Las señales anteriores se incorporaron
   todas en bloque ese día, en la primera línea de `cadena.txt`, marcada `inicial`. Para
   ellas, esto demuestra que no han cambiado **desde ese día**, no desde que se publicaron.
   (Ese archivo lleva por nombre el último día que cubre; la fecha en que se incorporó está
   escrita en su cabecera.)
6. **El cuándo lo atestigua Bitcoin, con sus matices.** Las fechas de un commit de git
   las pone quien firma y son falsificables — por eso no son la prueba. La prueba son
   los `.ots` de OpenTimestamps (sección de arriba): un bloque de Bitcoin da fe de que
   cada archivo existía en su fecha, y cualquiera puede comprobarlo arrastrando archivo
   y prueba en <https://opentimestamps.org>. Los matices: una prueba recién sellada nace
   *pendiente* y se completa cuando Bitcoin confirma (horas); y los archivos ya
   publicados cuando se activó el sellado quedaron probados **desde su sellado**, no
   desde su publicación — la fecha exacta la lleva cada prueba dentro. (Esta línea decía
   «todavía no es una prueba criptográfica de tiempo» hasta que la primera prueba quedó
   completa en el bloque **962376** y fue verificada de forma independiente; solo
   entonces se cambió.)
7. **Mientras una señal en publicación diferida vive, su huella es una afirmación nuestra,
   no una comprobación tuya.** Nadie de fuera puede calcularla, porque sus datos no son
   públicos. Lo que la sostiene es que la señal ya no se puede tocar (se sella a los 5
   minutos) y que su compromiso queda aquí, con su prueba de tiempo, mientras tanto: si al
   revelarse no diera esa huella, se vería aquí mismo. Al revelarse vuelve a ser una
   comprobación, y dice además desde cuándo existía el compromiso: la fecha de su prueba de
   tiempo, que puede ser posterior al cierre si la operación duró poco.
8. **Lo que aquí no se ancla no está protegido, y aquí se dice.** Una señal solo se ancla cuando
   está marcada como definitiva. Si ya no puede cambiar y sigue sin marcar, el archivo de cada día
   la nombra (la NOTA «NO ANCLA» de arriba), pero mientras tanto nada de esto prueba que no cambie.
   Pasó con una causa conocida: `create-signal` publicaba sin marcar las alertas aprobadas por
   Telegram, y desde que la cadena solo ancla lo marcado esas no se anclaban. Lo corrige su versión
   LIGA698; las de antes se marcan con una corrección atada a la huella de la lista publicada, y el
   archivo del día en que se anclan lo recuerda. De ellas, esto prueba que no han cambiado desde
   que se anclaron, no desde que se publicaron.

Si algo de esto te parece insuficiente, tienes razón en decirlo: escríbenos. Preferimos la
pregunta incómoda a un sistema que parezca más sólido de lo que es.

---

*Generado automáticamente cada mañana (UTC) por [`tools/sellar.mjs`](tools/sellar.mjs),
que vive en este mismo repositorio; los compromisos, por el mismo programa desde
[`.github/workflows/compromiso.yml`](.github/workflows/compromiso.yml), cuando cada señal
diferida queda sellada. El proceso completo y sus límites, en
[getfaro.org/metodologia](https://getfaro.org/metodologia). Licencia MIT.*
