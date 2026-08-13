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
 */
(function (raiz) {
  'use strict';

  var VERSION = 'faro-sello-v1';
  var VERSION_CADENA = 'faro-cadena-v1';

  /* Los campos que definen el COMPROMISO del analista, en orden fijo. Este orden es
   * parte del formato: cambiarlo cambia todas las huellas. Si alguna vez hay que tocar
   * la lista, se sube a `faro-sello-v2` y las huellas viejas siguen verificándose con
   * las reglas de la v1 — por eso la versión va en la primera línea del payload. */
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

  /**
   * El texto canónico de una señal. UTF-8, líneas separadas por LF, CON salto final.
   * `hashTesis` es la huella de la tesis (hex) o '' si no hay tesis — se pasa ya
   * calculada porque hashear es asíncrono en el navegador y este trozo tiene que ser
   * síncrono y comprobable a ojo.
   */
  function payload(fila, hashTesis) {
    var lineas = [VERSION];
    for (var i = 0; i < CAMPOS.length; i++) {
      var def = CAMPOS[i];
      lineas.push(def[0] + '=' + valor(fila, def.slice(1)));
    }
    lineas.push('tesis_sha256=' + (hashTesis || ''));
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
    crudo: crudo, payload: payload, sha256: sha256,
    huellaDeJson: huellaDeJson, textoCadena: textoCadena, digestDia: digestDia,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.FaroSello = api;
}(typeof self !== 'undefined' ? self : this));
