# FARO · Notas de integridad

> **Este fichero no se reescribe.** Si una nota necesita corrección, se publica una **nota
> nueva** que la corrige, con su número y su fecha; la anterior se queda como está. Es la
> misma regla que la cadena, y por el mismo motivo: sería absurdo que el único fichero
> mutable de este repositorio fuese justo el que cuenta los fallos.

Aquí publicamos los fallos que hemos cometido y que afectan a lo que hay en este registro.
Cada nota lleva número, fecha y versión. La más reciente, arriba.

Estas notas no modifican nada de la cadena. **Ninguna señal se corrige, se retira ni se
recalcula**: si algo salió mal, se cuenta, y el dato se queda donde está.

---

## Nota de integridad n.º 1

**v1.0 · 1 de septiembre de 2026**

Dos cosas que salieron mal por nuestra parte entre el 26 de agosto y el 1 de septiembre de
2026. Ninguna se corrige en el registro, y abajo está el porqué.

### 1 · Un fallo en el código que publicaba desde MetaTrader

El fragmento de código que FARO entrega a los sistemas automáticos para publicar sus
señales enviaba **el stop y el objetivo que el programa pedía al abrir la operación**, no
los que finalmente quedaron en ella. Cuando el bróker ejecuta con deslizamiento, o mueve el
stop por su distancia mínima, no son el mismo número. En una cuenta de demostración
coinciden casi siempre, y por eso pasó las pruebas.

**Ventana:** del 26 de agosto de 2026 (cuando se publicó ese fragmento) al 1 de septiembre
de 2026 (cuando lo corregimos). El código corregido lee los niveles de la posición ya
abierta, así que el fallo dejó de ser posible en vez de quedar advertido en un manual.

**Señales afectadas: una**, `d37231fb-2015-4d02-a9da-6da8c5b9cfcc`.

Y hay que decirlo con precisión: es una señal **candidata**, no una señal demostradamente
incorrecta. FARO no guarda los niveles que el programa pidió —solo los que recibió—, así
que **la divergencia no se puede comprobar ni descartar**. Si el bróker ejecutó sin
deslizamiento, los niveles sellados son exactos. No lo sabemos, y no vamos a decir que sí
ni que no.

No se corrige. El registro de integridad no se reescribe nunca, y menos para tapar un fallo
propio: un registro que se puede editar cuando hay una buena razón deja de ser un registro.

### 2 · Una señal de una cuenta de pruebas en el registro público

Esa misma señal es la que hay que explicar por segunda vez.

**La publiqué yo** —Joaquín Cortés, fundador de FARO— el 27 de agosto de 2026, desde mi
terminal MetaTrader, con las credenciales del **agente de siembra**, probando la
integración. No se coló sola: la disparé yo.

La causa técnica es que la marca que distingue los datos de prueba de los reales estaba
**escrita a fijo** en el código de publicación, de modo que toda señal nacía marcada como
real independientemente de quién la enviara. Ese defecto se corrigió el 29 de agosto de
2026, y hoy la marca se hereda del emisor y no puede sobrescribirse desde fuera.

La señal **sigue sellada** en la cadena de integridad del 27 de agosto, con su huella
`809afa2a3d421681c630b4a5448eae80e52346f6065c330ebc43802b9a1670b7`, y **no aparece en
ninguna métrica pública**. Las dos cosas a la vez, porque los dos sistemas filtran por
criterios distintos: **el sello filtra por la señal** y **el producto filtra por el
emisor**. El registro y el producto discrepan sobre si esa señal existe.

Es incómodo de contar y es lo que hay. Lo dejamos así en vez de retirarla porque retirar
del registro una operación real que salió mal —aunque sea de una cuenta de pruebas y aunque
el fallo sea nuestro— es exactamente la maniobra contra la que existe FARO.

### Cómo comprobar lo que dice esta nota

Sin salir de este repositorio, que es de lo que se trata:

```
grep -n d37231fb integridad/indice.txt      # en qué archivo cayó, y con qué huella
grep -n -A16 d37231fb integridad/2026-08-27.txt   # el payload sellado, entero
```

El bloque sellado dice `entrada=1.1655`, `stop=1.16302`, `objetivo1=1.16702`. Que la huella
sale de ese texto lo compruebas tú con `sha256sum`, siguiendo el procedimiento del
[README](README.md). Y que el archivo del día existía en esa fecha te lo dice su prueba
`.ots` y la cadena de bloques de Bitcoin, sin intervención nuestra ni de GitHub.

*Referencia adicional, no necesaria para lo anterior:* la misma nota está publicada en
`getfaro.org/verificar`. Está ahí para quien llegue por la web; lo que vale como prueba es
lo que hay en este repositorio.
