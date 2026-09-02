# FARO · Registro de integridad

Este repositorio existe para que **no tengas que fiarte de FARO**.

Cada día publicamos aquí la huella criptográfica (SHA-256) de cada señal sellada, y un
*digest* que las encadena con el del día anterior. Si alguien —nosotros incluidos—
cambiara el precio de entrada, el stop o el objetivo de una señal publicada hace tres
meses, su huella dejaría de cuadrar, y con ella todos los digests posteriores.

Puedes comprobarlo tú, con `sha256sum` y sin pedirnos nada.

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
tools/sellar.mjs      el generador, para que lo ejecutes tú (ver «La auditoría completa»)
js/sello.js           la canonicalización: las reglas del formato, en código y comentadas
docs/metricas.md      las fórmulas de las métricas que publica la web
```

**Sobre `indice.txt`, para que nadie lo malinterprete:** es un *puntero*, no una prueba.
Existe para que encuentres en qué archivo cayó una señal sin tener que abrirlos todos, y
se regenera entero en cada ejecución a partir de los archivos diarios. La prueba es
siempre el archivo del día: si este índice mintiera, la comprobación contra el archivo
fallaría — y eso es exactamente lo que queremos que pase.

Cada archivo diario contiene, por cada señal, su **payload canónico** —el texto exacto
que se hashea— seguido de su huella. Al final, el digest del día y el del día anterior.

Tres cosas que te vas a encontrar y conviene saber leer:

- **El primer archivo es el bloque inicial.** Su fecha es el último día que cubre, no el
  día en que se creó; la fecha real de incorporación está escrita dentro. Ver la
  limitación 5.
- **Señales «tardías».** Una señal puede hacerse pública días después de publicarse (se
  valida más tarde). Entra en el archivo del día en que entró al registro, y la cabecera
  lo dice. Su fecha real de publicación está en el campo `publicada` de su payload, sin
  retocar: si el anclaje fuera muy posterior a la publicación, lo ves ahí.
- **Bloques `⚠ INCIDENCIA DE INTEGRIDAD`.** Cada día se recalcula la huella de **todo** lo
  ya anclado. Si una señal sellada dejara de coincidir con la huella que se publicó, se
  escribe aquí, con las dos huellas y el archivo donde estaba la original — que no se
  toca. Un sistema que detecta esto y se lo calla no vale nada. Si ves uno, escríbenos y
  pregunta qué pasó.

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

## Las reglas del formato, por si quieres reconstruirlo desde cero

Los datos de cada señal son públicos y los puedes pedir tú:

```bash
curl -s "https://zttwhjkfmhiaztpvhbbn.supabase.co/rest/v1/signals?id=eq.<ID>&select=*" \
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
| **Versión** | La primera línea. Si algún día cambia el formato, será `faro-sello-v2` y esto seguirá valiendo para lo viejo |

**Sobre los números, que es donde esto se rompe:** una entrada real vale
`1.1544678211212158`. Si la parseas a coma flotante y la vuelves a imprimir, el resultado
depende de tu lenguaje y de tu biblioteca JSON — `jq` 1.6 pierde dígitos ahí y `jq` 1.7
no. Por eso la regla es **copiar los caracteres**, no reimprimir el número. Nuestro
generador lleva un escáner que preserva el literal en vez de un `JSON.parse`.

### La auditoría completa, en un comando

El generador **está en este mismo repositorio** (`tools/sellar.mjs` + `js/sello.js`) y no
usa ninguna credencial: lee la misma API pública que acabas de usar tú y no escribe en
ninguna base de datos. Con Node 18 o superior:

```bash
git clone https://github.com/teaminvestx-oss/faro-integridad
cd faro-integridad
node tools/sellar.mjs --check
```

Eso **recalcula la huella de todas las señales ancladas** contra la API pública y las
compara con lo que hay publicado aquí. Si una señal sellada hubiera cambiado en la base
de datos, lo imprime con su id y las dos huellas (`INCIDENCIA`). Si en cambio dice
`faltaría integridad/<ayer>.txt` y sale con código 1, es que lo estás ejecutando **antes
de las 03:10 UTC**, cuando el archivo de ayer aún no se ha generado — vuelve más tarde o
genera tú ese archivo con `node tools/sellar.mjs` y compáralo cuando se publique.

Una honestidad más: el **bloque inicial no se puede regenerar desde cero**, porque su
forma depende del día en que se creó (todo lo anterior entró de golpe ese día). Sus
huellas y su digest, una a una, sí: son aritmética sobre este archivo, como en el ejemplo
de arriba.

---

## La prueba de tiempo (OpenTimestamps)

Todo lo anterior demuestra **qué** se publicó; los `.ots` demuestran **cuándo**. Cada
archivo diario se sella con [OpenTimestamps](https://opentimestamps.org): su SHA-256 se
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
   por días UTC completos y el archivo de cada día se genera a la mañana siguiente, a las
   03:10 UTC. En el peor caso —una señal publicada justo pasada la medianoche UTC— son
   unas **27 horas**; si el trabajo programado se retrasa (pasa, en GitHub Actions), algo
   más. En esa franja la integridad de una señal recién publicada sigue dependiendo de
   nuestra palabra, no de estas huellas — y su ficha en getfaro.org lo dice mientras esté
   así.
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

Si algo de esto te parece insuficiente, tienes razón en decirlo: escríbenos. Preferimos la
pregunta incómoda a un sistema que parezca más sólido de lo que es.

---

*Generado automáticamente cada día a las 03:10 UTC por [`tools/sellar.mjs`](tools/sellar.mjs),
que vive en este mismo repositorio. El proceso completo y sus límites, en
[getfaro.org/metodologia](https://getfaro.org/metodologia). Licencia MIT.*
