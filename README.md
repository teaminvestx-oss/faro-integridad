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
cadena.txt          el índice: una línea por día, con su digest
AAAA-MM-DD.txt      el archivo de cada día: el contenido sellado de cada señal y su huella
```

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

### Rehaz nuestro trabajo entero

El generador no usa ninguna credencial: lee la misma API pública que acabas de usar tú y
no escribe en ninguna base de datos. Puedes ejecutarlo y comparar:

```bash
node tools/sellar.mjs      # en el repositorio del producto
diff -r integridad/ <este repositorio>/integridad/
```

Si saliera cualquier diferencia, sería porque hemos tocado algo.

---

## Qué demuestra esto, y qué no

Decirlo entero es parte del trato:

1. **Demuestra que un registro no ha cambiado desde que se selló. No demuestra que el dato
   fuera correcto al sellarlo.** Una entrada mal capturada queda anclada igual de mal.
2. **La integridad del precio depende de la fuente de precios** (Yahoo/Stooq), no de la
   huella. Esto fija lo que dijimos, no lo que hizo el mercado.
3. **Una señal borrada antes de sellarse no deja rastro aquí.** Esto protege lo publicado;
   no prueba que no hubiera nada más.
4. **Entre publicar una señal y verla anclada pueden pasar hasta 27 horas.** El digest se
   genera una vez al día, a las 03:10 UTC, y cubre los días UTC **ya cerrados**: lo
   publicado a las 00:05 de un día no entra hasta las 03:10 del siguiente. En esa franja
   la integridad de una señal recién publicada sigue dependiendo de nuestra palabra, no de
   estas huellas — y su ficha en getfaro.org lo dice mientras esté así. (El número redondo
   sería «un día»; el real es 27 horas, y en un documento como este el real es el que va.)
5. **El anclaje empieza el día del primer digest.** Las señales anteriores se incorporaron
   todas en bloque ese día, en la primera línea de `cadena.txt`, marcada `inicial`. Para
   ellas, esto demuestra que no han cambiado **desde ese día**, no desde que se publicaron.
   (Ese archivo lleva por nombre el último día que cubre; la fecha en que se incorporó está
   escrita en su cabecera.)
6. **Esto todavía no es una prueba criptográfica de tiempo.** Las fechas de un commit de
   git las pone quien firma y son falsificables, y este repositorio es nuestro: podríamos
   reescribir la historia. Lo que no podríamos es hacerlo sin que lo notara quien ya
   tuviera una copia — por eso clonarlo tiene sentido. La prueba de tiempo llegará con
   **OpenTimestamps** sobre Bitcoin, que está en el plan y todavía no está hecho.

Si algo de esto te parece insuficiente, tienes razón en decirlo: escríbenos. Preferimos la
pregunta incómoda a un sistema que parezca más sólido de lo que es.

---

*Generado automáticamente por [`.github/workflows/integridad.yml`](https://getfaro.org/metodologia).
Licencia MIT.*
