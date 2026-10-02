/* FARO · Sello de integridad · canonicalización y huella
 * ───────────────────────────────────────────────────────────────────────────
 * Un analista candidato lo formuló así: «me preocupa cómo te auditas a ti mismo… para
 * dar seguridad a los que te leen de que estás auditado y no un error en un db va a
 * cambiar los resultados». Sin esto, la respuesta de FARO a esa pregunta es «fíate de
 * nosotros», y eso no es una respuesta.
 *
 * Este módulo convierte una señal en un TEXTO CANÓNICO cuyo SHA-256 cualquiera puede
 * recalcular por su cuenta, sin acceso a nuestra infraestructura y sin pedirnos nada.
 *
 * ── LA DECISIÓN QUE HACE QUE ESTO FUNCIONE ─────────────────────────────────
 * Se serializa a partir del TEXTO JSON CRUDO que devuelve la API pública, NUNCA a partir
 * de números ya parseados a coma flotante.
 *
 * No es una manía. Una entrada real de hoy vale 1.1544678211212158. En cuanto alguien la
 * parsea a double y la vuelve a imprimir, el resultado depende del lenguaje, de su
 * versión y hasta de la biblioteca JSON — `jq` 1.6 pierde dígitos ahí y `jq` 1.7 no. Un
 * sistema de integridad que da huellas distintas según con qué lo verifiques no sirve
 * para nada, y el fallo aparecería meses después, en la señal de alguien concreto.
 *
 * Copiando los caracteres tal como vienen no hay algoritmo que reproducir: solo copiar.
 * Por eso `crudo()` es un escáner que preserva el literal, y no un `JSON.parse`.
 *
 * ── LO QUE ESTE MÓDULO NO HACE, Y ES DELIBERADO ────────────────────────────
 * No guarda nada. La huella no se escribe en la base de datos: se CALCULA a partir de
 * datos que ya son públicos, cada vez, en el navegador de quien mira. Una huella
 * guardada es una afirmación nuestra; una huella calculada es una comprobación. Y como
 * consecuencia el trabajo diario que construye la cadena no necesita ni una credencial
 * de escritura: lee la API pública igual que la leería un tercero, lo que significa que
 * un tercero puede ejecutar exactamente el mismo proceso y obtener exactamente el mismo
 * archivo. Eso es lo que convierte la promesa en algo comprobable.
 *
 * ── Y EL CASO DONDE ESO NO SE PUEDE CUMPLIR, DICHO AQUÍ Y NO EN UNA NOTA ───
 * Con la PUBLICACIÓN DIFERIDA hay señales cuyos parámetros no son públicos mientras la
 * operación vive. Para ellas lo de arriba es imposible por construcción: nadie de fuera
 * puede calcular su huella todavía, porque le faltan los datos. FARO la COMPROMETE al
 * publicar —en cuanto se cierra su ventana de corrección, con una lectura de solo lectura
 * que lee lo que su huella necesita— y la publica en el registro como COMPROMISO, aparte y
 * con su propia prueba de tiempo; y se RECALCULA al revelarse.
 *
 * Por eso esas señales llevan su propio payload, `faro-sello-v2`: el de siempre con una
 * línea más al final, `nonce=`, 32 bytes aleatorios que nacen en la base con la señal y
 * se revelan con sus niveles. Sin ellos la huella comprometida se podría adivinar
 * probando: lo que se oculta —un instrumento, una dirección, unos niveles cerca del precio
 * de un instante público— tiene pocas posibilidades. La versión va en la primera línea,
 * así que todo lo sellado con `faro-sello-v1` se sigue verificando igual, byte a byte, y
 * una señal en abierto se sigue sellando con `faro-sello-v1`.
 *
 * LIGA718 · Y UNA DIFERENCIA MÁS, la única: en `faro-sello-v2`, la línea `entrada=` de una
 * orden PENDIENTE (a zona o escalonada) va SIEMPRE vacía. Su entrada no la decide quien la
 * emite: la fija el mercado al tocarla, después de sellarse, y un compromiso que se publica a
 * los cinco minutos no puede cubrir algo que todavía no existe (lo de LIGA-110: en una orden
 * pendiente la entrada no es un compromiso, es un RESULTADO). Con ella vacía, la huella de
 * una diferida pendiente no cambia al activarse, y su compromiso vale hasta que se revela. Lo
 * que sí sella es todo lo que decide quien la emite —instrumento, dirección, zona, stop,
 * objetivos y tesis—; la entrada se comprueba contra el mercado, como el precio de cierre. Y
 * así una diferida pendiente puede existir: hasta LIGA718 se rechazaba («de momento, solo a
 * mercado», decisión 3.2), a la espera de un compromiso en dos fases que esto hace innecesario.
 *
 * Y una fila diferida SIN su nonce —la que la lectura pública sirve mientras la operación
 * vive, con él retenido— no tiene huella: este módulo se niega a calcularla y lo dice.
 * Calcularla sin él daría una huella `faro-sello-v1` con toda la pinta de buena, que es la
 * de una señal que no existe.
 *
 * OJO CON EL «CUÁNDO», que es donde esta cabecera ya se pasó una vez: decía «la ancla ese
 * mismo día», y la cadena NO hace eso. Ancla días UTC COMPLETOS a la mañana siguiente, así
 * que en el peor caso pasan unas 33 horas, y más el día que el trabajo falla (medido con el
 * historial de ejecuciones del trabajo de integridad). Lo que llega antes es el COMPROMISO,
 * y de él solo hay objetivos DECLARADOS, fijados antes de medir: en el registro como mucho
 * 15 minutos después de cerrarse la ventana de corrección, y en un bloque de Bitcoin antes
 * de 24 horas desde la publicación. Los mide el ensayo del programa, y hasta entonces no se
 * dan por cumplidos: prometer una prueba externa que nadie ha visto llegar es prometerla
 * justo en la franja en que aún no la hay, la única donde importa.
 *
 * O sea que la frase «la huella no se guarda nunca» deja de ser cierta en absoluto: hay
 * exactamente una huella persistida por señal diferida —la de su compromiso, en el
 * registro público, que no se retira—. Es el único punto donde este diseño cede, y cede a
 * cambio de algo: al revelarse, esa huella dice MÁS que la de una señal en abierto: desde
 * cuándo existía el compromiso, la fecha que da su prueba de tiempo; con la operación viva,
 * solo si esa fecha es anterior a su cierre (una corta puede cerrarse antes que Bitcoin).
 *
 * Esto se escribe aquí porque este comentario es el argumento original que había que leer
 * antes de ceder. Dejarlo prometiendo el absoluto mientras el sistema ya no lo cumple
 * sería la peor versión del fallo: la frase se vuelve falsa, suena a fundamento, y nada
 * avisa.
 */
(function (raiz) {
  'use strict';

  var VERSION = 'faro-sello-v1';
  var VERSION_CADENA = 'faro-cadena-v1';

  /* LIGA692 · `faro-sello-v2`, la de una señal en publicación diferida. NO cambia la lista de
   * campos ni su orden: es el payload de la v1, línea a línea, con la versión nueva en la primera
   * y UNA línea más al final, `nonce=`. Por eso una señal sin nonce —toda señal en abierto— sale
   * exactamente como antes, y la v1 no hay que volver a verificarla con nada nuevo.
   *
   * QUÉ DECIDE LA VERSIÓN: que la fila traiga su nonce. Y lo que NO puede pasar: que una fila
   * DIFERIDA llegue sin él y salga una v1, porque sería una huella con toda la pinta de buena y
   * la de un texto que no se ha sellado nunca. «Diferida» es lo que dice la propia fila: su modo
   * (`modo_publicacion`, que la lectura pública sirve siempre en claro) o la marca con la que la
   * vista dice que la ha servido retenida (`detalle_retenido`). Con cualquiera de las dos y sin
   * nonce, este módulo se NIEGA (`SIN_NONCE`), y quien lo llama decide qué hace con una señal
   * cuya huella no se puede calcular desde fuera todavía.
   *
   * `MARCA_COMPROMETIDA` es la línea con la que empieza, en el archivo del día, el bloque de una
   * diferida que seguía viva al anclarse (sin payload: solo su id, su compromiso y su huella). Vive
   * aquí y no en el generador porque la leen los dos: el generador, que la escribe, y el
   * navegador, que busca en el registro el bloque de una huella y solo carga este fichero. */
  var VERSION_V2 = 'faro-sello-v2';
  var VERSIONES = [VERSION, VERSION_V2];
  var COLUMNA_NONCE = 'sello_nonce';
  var MODO_DIFERIDO = 'diferido';
  var SIN_NONCE = 'FARO_SELLO_SIN_NONCE';
  var MARCA_COMPROMETIDA = 'comprometida · se revela en estado terminal';

  /* Los campos que definen el COMPROMISO del analista, en orden fijo. Este orden es
   * parte del formato: cambiarlo cambia todas las huellas. Si alguna vez hay que tocar
   * la lista, se sube la versión y las huellas viejas siguen verificándose con las
   * reglas de la suya — por eso la versión va en la primera línea del payload. (La v2 no
   * la toca: añade el nonce al final, detrás de la tesis.) */
  var CAMPOS = [
    ['id', 'id'],
    ['analista', 'trader_id'],
    ['simbolo', 'canonical_symbol', 'ticker'],   // el canónico si existe; si no, el ticker
    ['direccion', 'bias'],
    ['tipo', 'signal_type'],
    ['entrada', 'entry'],
    ['zona_min', 'zone_low'],
    ['zona_max', 'zone_high'],
    ['stop', 'sl'],
    ['objetivo1', 'tp1'],
    ['objetivo2', 'tp2'],
    ['publicada', 'published_at'],
    ['metodologia', 'methodology_version'],
  ];

  // ── El escáner de JSON que preserva literales ────────────────────────────
  // Devuelve, para el objeto de primer nivel, {clave: {tipo, valor}} donde:
  //   · number  → `valor` son los CARACTERES tal cual venían ("1.1544678211212158")
  //   · string  → `valor` es el texto ya decodificado (é → é), que es lo que se
  //               hashea; el escape es transporte, no contenido
  //   · null    → tipo 'null'
  //   · array/objeto → tipo 'compuesto' y se salta (ningún campo del sello lo es)
  function crudo(texto) {
    var s = String(texto), i = 0, out = {};
    function blanco() { while (i < s.length && ' \t\r\n'.indexOf(s[i]) > -1) i++; }
    function cadena() {                       // s[i] === '"'
      i++; var r = '';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') {
          i++;
          var c = s[i++];
          if (c === 'u') { r += String.fromCharCode(parseInt(s.substr(i, 4), 16)); i += 4; }
          else if (c === 'n') r += '\n';
          else if (c === 't') r += '\t';
          else if (c === 'r') r += '\r';
          else if (c === 'b') r += '\b';
          else if (c === 'f') r += '\f';
          else r += c;                        // " \ / y cualquier otro: literal
        } else r += s[i++];
      }
      i++; return r;
    }
    function salta() {                        // salta un valor compuesto, contando anidación
      var prof = 0;
      do {
        if (s[i] === '"') { cadena(); continue; }
        if (s[i] === '[' || s[i] === '{') prof++;
        else if (s[i] === ']' || s[i] === '}') prof--;
        i++;
      } while (i < s.length && prof > 0);
    }
    blanco();
    if (s[i] === '[') { i++; blanco(); }      // PostgREST devuelve un array de filas
    blanco();
    if (s[i] !== '{') return out;
    i++;
    for (;;) {
      blanco();
      if (s[i] === '}' || i >= s.length) break;
      if (s[i] === ',') { i++; continue; }
      if (s[i] !== '"') break;
      var clave = cadena();
      blanco();
      if (s[i] !== ':') break;
      i++; blanco();
      if (s[i] === '"') { out[clave] = { tipo: 'string', valor: cadena() }; }
      else if (s[i] === '[' || s[i] === '{') { var d = i; salta(); out[clave] = { tipo: 'compuesto', valor: s.slice(d, i) }; }
      else {
        var j = i;
        while (i < s.length && ',}] \t\r\n'.indexOf(s[i]) === -1) i++;
        var lit = s.slice(j, i);
        out[clave] = lit === 'null' ? { tipo: 'null', valor: '' }
          : (lit === 'true' || lit === 'false') ? { tipo: 'bool', valor: lit }
            : { tipo: 'number', valor: lit };   // ← EL LITERAL, sin tocar
      }
    }
    return out;
  }

  /** El valor canónico de un campo. Nulo o ausente → cadena vacía (la línea sigue estando). */
  function valor(fila, claves) {
    for (var k = 0; k < claves.length; k++) {
      var c = fila[claves[k]];
      if (c && c.tipo !== 'null' && c.valor !== '') return c.valor;
    }
    return '';
  }

  /** LIGA692 · ¿Dice la fila que es de una señal en publicación diferida? (su modo, o la marca de la vista) */
  function esDiferida(fila) {
    var m = fila.modo_publicacion, r = fila.detalle_retenido;
    return !!((m && m.tipo === 'string' && m.valor === MODO_DIFERIDO)
      || (r && r.tipo === 'bool' && r.valor === 'true'));
  }

  /** LIGA692 · La negativa: una diferida sin su nonce no tiene huella calculable. */
  function errorSinNonce() {
    var e = new Error('esta fila es de una señal en publicación diferida y no trae su nonce (la lectura '
      + 'pública lo retiene, con sus niveles, mientras la operación vive): su huella ' + VERSION_V2
      + ' no se puede calcular con ella. Una huella ' + VERSION + ' de esta fila sería la de un texto '
      + 'que no se ha sellado nunca, así que no se da ninguna.');
    e.code = SIN_NONCE;
    return e;
  }

  /**
   * El texto canónico de una señal. UTF-8, líneas separadas por LF, CON salto final.
   * `hashTesis` es la huella de la tesis (hex) o '' si no hay tesis — se pasa ya
   * calculada porque hashear es asíncrono en el navegador y este trozo tiene que ser
   * síncrono y comprobable a ojo. LIGA692 · con nonce, `faro-sello-v2`; una diferida sin
   * él lanza (`SIN_NONCE`) en vez de dar un texto que no es el suyo.
   */
  function payload(fila, hashTesis) {
    var nonce = valor(fila, [COLUMNA_NONCE]);
    if (!nonce && esDiferida(fila)) throw errorSinNonce();
    // LIGA718 · en `faro-sello-v2` (solo una diferida lleva nonce), la entrada de lo que no es a
    // mercado no se sella: la fija el mercado después (la cabecera). Vacía, siempre.
    var sinEntrada = !!nonce && valor(fila, ['signal_type']) !== 'market';
    var lineas = [nonce ? VERSION_V2 : VERSION];
    for (var i = 0; i < CAMPOS.length; i++) {
      var def = CAMPOS[i];
      lineas.push(def[0] + '=' + (sinEntrada && def[0] === 'entrada' ? '' : valor(fila, def.slice(1))));
    }
    lineas.push('tesis_sha256=' + (hashTesis || ''));
    if (nonce) lineas.push('nonce=' + nonce);
    return lineas.join('\n') + '\n';
  }

  // ── SHA-256, en Node y en el navegador ───────────────────────────────────
  // Devuelve SIEMPRE una promesa: `crypto.subtle` es asíncrono y no se puede fingir
  // síncrono sin traer una implementación propia de SHA-256, que sería una cuarta cosa
  // que auditar. Una promesa en Node no molesta a nadie.
  function sha256(texto) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      // eslint-disable-next-line global-require
      var crypto = require('node:crypto');
      return Promise.resolve(crypto.createHash('sha256').update(texto, 'utf8').digest('hex'));
    }
    var bytes = new TextEncoder().encode(texto);
    return raiz.crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      var v = new Uint8Array(buf), h = '';
      for (var i = 0; i < v.length; i++) h += v[i].toString(16).padStart(2, '0');
      return h;
    });
  }

  /** Huella de una señal a partir del TEXTO JSON crudo de su fila. */
  function huellaDeJson(jsonTexto) {
    var fila = crudo(jsonTexto);
    // LIGA692 · la negativa, ANTES de hashear nada y por el mismo camino que la huella: quien la
    // espera recibe el rechazo, con su `code`, y no una huella que no es la de nadie.
    if (!valor(fila, [COLUMNA_NONCE]) && esDiferida(fila)) return Promise.reject(errorSinNonce());
    var tesis = fila.thesis;
    var p = (tesis && tesis.tipo === 'string' && tesis.valor !== '')
      ? sha256(tesis.valor) : Promise.resolve('');
    return p.then(function (ht) {
      var texto = payload(fila, ht);
      return sha256(texto).then(function (h) { return { payload: texto, huella: h }; });
    });
  }

  /**
   * El digest de un día. Encadena el del día anterior, así que alterar una señal vieja
   * rompe TODOS los digests posteriores y no solo el suyo.
   *
   * Orden por HUELLA ascendente, no por fecha ni por id: no hay empates posibles y no
   * depende de ninguna fecha, que es donde se cuelan los errores de huso.
   *
   * Un día sin señales se publica IGUAL, con cero líneas de huella: un hueco en la
   * cadena es indistinguible de un día borrado.
   */
  function textoCadena(fecha, anterior, huellas) {
    return [VERSION_CADENA, 'fecha=' + fecha, 'anterior=' + (anterior || '')]
      .concat(huellas.slice().sort()).join('\n') + '\n';
  }
  function digestDia(fecha, anterior, huellas) {
    var t = textoCadena(fecha, anterior, huellas);
    return sha256(t).then(function (h) { return { texto: t, digest: h }; });
  }

  var api = {
    VERSION: VERSION, VERSION_CADENA: VERSION_CADENA, CAMPOS: CAMPOS,
    VERSION_V2: VERSION_V2, VERSIONES: VERSIONES, COLUMNA_NONCE: COLUMNA_NONCE,
    MODO_DIFERIDO: MODO_DIFERIDO, SIN_NONCE: SIN_NONCE, MARCA_COMPROMETIDA: MARCA_COMPROMETIDA,
    crudo: crudo, payload: payload, sha256: sha256, esDiferida: esDiferida,
    huellaDeJson: huellaDeJson, textoCadena: textoCadena, digestDia: digestDia,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.FaroSello = api;
}(typeof self !== 'undefined' ? self : this));
