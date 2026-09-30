/* FARO · Generador de la cadena de integridad
 * ───────────────────────────────────────────────────────────────────────────
 * Construye el archivo diario de integridad: el payload canónico y la huella de cada
 * señal sellada, y el digest del día encadenado con el del día anterior.
 *
 * ── LO MÁS IMPORTANTE DE ESTE ARCHIVO ──────────────────────────────────────
 * LA PASADA DIARIA NO USA NI UNA CREDENCIAL. Lee la API pública de Supabase con la clave
 * anon, que viaja en el código fuente de la web y es pública por diseño; y no escribe en la
 * base de datos, porque la huella no se guarda en ningún sitio: se calcula. (Desde LIGA689 esa
 * lectura pública es la vista `signals_publico`, con la misma clave: ver `LO QUE SE LEE`.)
 *
 * Esa propiedad es la que convierte la promesa en algo comprobable. Cualquiera puede
 * clonar el repositorio, ejecutar este mismo script y obtener BYTE A BYTE el mismo
 * archivo que publicamos nosotros. Si no coincidiera, sería porque hemos tocado algo. No
 * hay que fiarse de que nuestro servidor haga bien las cuentas: se rehacen.
 *
 * LIGA692 · Y LA ÚNICA EXCEPCIÓN, que no es la pasada diaria: `--compromiso <id>`. Una señal en
 * publicación DIFERIDA no se puede recalcular desde fuera mientras vive —la lectura pública le
 * retiene el instrumento, los niveles y el nonce—, así que su huella la COMPROMETE, en cuanto se
 * cierra su ventana de corrección, el workflow de compromisos del registro público, con una
 * credencial de SOLO LECTURA: un JWT del rol `faro_lector_sello`, en `FARO_LECTOR_SELLO_JWT`, que
 * no tiene permiso de escritura sobre ninguna tabla (y no puede ejecutar ninguna función que no
 * pueda ejecutar ya la clave anon). Ese workflow ejecuta una copia de ESTE fichero y de
 * `js/sello.js` solo si su sha256 es uno de los que tiene fijados (LIGA692 · revisión): cambiarlos
 * obliga a volver a instalarlo. Lo que escribe es un archivo del registro,
 * `integridad/compromisos/AAAA-MM/<id>.txt`, con el id, la fecha de publicación y la huella: ni
 * el payload, ni un nivel, ni el instrumento. La pasada diaria no lee esa credencial ni la
 * necesita: la huella de una diferida viva la toma de ese archivo, que viene en el clon, así que
 * un tercero sin ninguna credencial sigue obteniendo byte a byte los mismos archivos del día.
 *
 * ── EL BLOQUE INICIAL, Y POR QUÉ NO SE FINGE HISTORIA ──────────────────────
 * Las señales anteriores al primer digest se incorporan TODAS en un único bloque, con la
 * fecha real del día en que se incorporaron y marcado `bloque_inicial=si`.
 *
 * La alternativa —generar un archivo por cada día pasado— habría producido un historial
 * que PARECE que llevamos anclando desde mayo, y es mentira: esos archivos se habrían
 * creado todos el mismo día. Para las señales del bloque inicial, el anclaje demuestra
 * que no han cambiado desde el día del bloque, NO desde que se publicaron. Está escrito
 * en el propio archivo para que nadie tenga que deducirlo.
 *
 *   node tools/sellar.mjs            genera lo que falte hasta ayer
 *   node tools/sellar.mjs --check    no escribe; sale 1 si algo no cuadra
 *   node tools/sellar.mjs --compromiso <id>            escribe el compromiso de una diferida
 *   node tools/sellar.mjs --compromiso <id> --check    lo calcula y lo compara, sin escribir
 *     (las dos con el JWT del lector en FARO_LECTOR_SELLO_JWT; sin él no piden nada)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
// (readdirSync lo usa leeAncladas: el registro se lee de sus propios archivos)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Sello = require('../js/sello.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'integridad');
const INDICE = join(DIR, 'cadena.txt');

// Los dos son públicos: están en index.html y los sirve el navegador de cualquiera.
const SUPA = 'https://zttwhjkfmhiaztpvhbbn.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0dHdoamtmbWhpYXp0cHZoYmJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjI2MDMsImV4cCI6MjA5Mjc5ODYwM30.GTn26NtXlQUq3S7TM3aspdV9bFU-4z9diR9J2l7HVNI';

/* ── LIGA689 · LO QUE SE LEE, Y DE DÓNDE ─────────────────────────────────────────────────
 * Hasta LIGA689 esto pedía `signals?select=*`: todas las columnas de toda señal pública. Con
 * la publicación diferida eso no puede seguir, y la lectura pública de las señales pasa a ser
 * la VISTA `signals_publico` (su migración, `faro-signals-lectura-publica.sql`): de una
 * diferida que sigue viva sirve su existencia, su emisor, sus fechas y su estado, y nada
 * más; de todas las demás, la fila tal cual. La tabla se cierra a la clave
 * anónima en un paso aparte, así que este fichero lee la vista —con la misma clave anónima de
 * siempre y los mismos filtros— o dejaría de poder leer nada.
 *
 * El archivo del día NO cambia por leer la vista, y es lo que importa aquí: la vista sirve el
 * MISMO dato con el MISMO literal —conserva el tipo y la escala de cada columna, y la migración
 * lo comprueba al pegarse, columna a columna, contra la tabla—, y el payload se construye del
 * literal (`js/sello.js`, «EL LITERAL, sin tocar»). Los tests de LIGA689 lo EJECUTAN: las
 * mismas filas, servidas como las servía la tabla al código de antes y como las sirve la vista
 * a este, dan byte a byte los mismos archivos.
 *
 * LAS COLUMNAS, NOMBRADAS, y ya no `select=*`. Se piden las que se USAN, y se DERIVAN de quien
 * las usa: las del payload salen de `Sello.CAMPOS` (el formato: si mañana tuviera una más, se
 * pediría sola), más la tesis y las tres que decide este fichero (abajo). Pedir de más no
 * rompería ninguna huella, pero una lista que se escribe a mano al lado de otra se desvía, y un
 * `select=*` pediría también lo que la vista añada mañana. El test comprueba las dos mitades:
 * que con estas columnas cada huella sale idéntica a la de la fila entera, y que quitar
 * CUALQUIERA de ellas cambia algo que se ve (una huella, un archivo o la guarda de abajo). */

/** La lectura pública de las señales, y la relación de antes, que solo se lee por el puente. */
export const VISTA = 'signals_publico';
export const TABLA = 'signals';

/**
 * Las columnas que se piden, DERIVADAS de lo que las usa:
 *   · las del payload canónico, de `Sello.CAMPOS` (el símbolo pide dos: el canónico y el ticker);
 *   · `thesis`: su huella es la última línea del payload (`tesis_sha256=`), y `huellaDeJson` la
 *     lee de esa columna, que no está en `CAMPOS` porque no entra en el texto sino su hash;
 *   · LIGA692 · el nonce (`Sello.COLUMNA_NONCE`): la línea que `faro-sello-v2` añade al final. De
 *     una diferida ya revelada la vista lo sirve en claro, y sin él su huella no se puede rehacer;
 *   · `status` y `entry_final`: si una señal es ya DEFINITIVA para anclarse (LIGA-109, LIGA-110),
 *     y el estado de las ancladas antes de tiempo (LIGA-114);
 *   · `modo_publicacion`: si es una diferida, y si sigue viva (LIGA692: entonces su huella sale de
 *     su compromiso, no de lo que sirve la lectura pública).
 * `published_at` (el día al que pertenece) e `id` ya vienen con el payload.
 */
export function columnasDeLectura(sello = Sello) {
  const delPayload = sello.CAMPOS.flatMap((c) => c.slice(1));
  return [...new Set([...delPayload, 'thesis', sello.COLUMNA_NONCE, 'status', 'entry_final', 'modo_publicacion'])]
    .filter(Boolean);
}
export const COLUMNAS = columnasDeLectura();
/**
 * LIGA698 · B1 · lo que pide SOLO la pasada diaria, además de `COLUMNAS`, y para qué:
 *   · `approval_channel`: de una señal que la cadena no ancla y no anclaría nunca (la NOTA «NO ANCLA»
 *     del archivo del día), si es una alerta aprobada por Telegram —la causa conocida— o no.
 * No entra en ninguna huella, y el compromiso no lo pide: su lector no lo tiene concedido ni lo
 * necesita. Por eso va aparte de `COLUMNAS`, que es lo que las dos lecturas comparten.
 */
export const SOLO_PASADA = ['approval_channel'];
export const COLUMNAS_PASADA = [...COLUMNAS, ...SOLO_PASADA];

/**
 * Los MISMOS filtros que ve el público. Si una señal no es pública, no se ancla. LIGA692 · y la
 * misma consulta es la del compromiso, con un `id` delante: la lee el lector del sello, con su
 * JWT, de la tabla (`compromete`). `columnas` solo cambia en el puente de la columna del nonce.
 */
export const consulta = (rel, { columnas = COLUMNAS, id = null } = {}) => `/rest/v1/${rel}?select=${columnas.join(',')}`
  + (id ? `&id=eq.${id}` : '')
  + '&validated=eq.true&is_draft=not.is.true&is_demo=eq.false&order=published_at.asc';

/**
 * LIGA689 · EL PUENTE, y por qué solo en un caso. Entre que este fichero sale y que la vista se
 * pega en la base, la vista puede NO EXISTIR; ahí, y solo ahí, se lee la tabla, que en ese tramo
 * sigue contestando lo mismo (el orden de LIGA543: primero el código, luego la vista, y el
 * cierre de la tabla el último). «No existe» son los dos códigos con los que PostgREST lo dice:
 * `PGRST205` (PostgREST 12, con HTTP 404) y `42P01` (el de Postgres, el de antes). Un 404 a
 * secas NO: puede venir de cualquier sitio y no dice qué falta. Y NUNCA ante otro error: con un
 * permiso perdido sobre la vista, caer a la tabla mientras aún contesta serviría entera justo la
 * fila que la vista existe para tapar.
 *
 * Es el criterio de `_faltaRelacion` en el navegador, con la misma firma. Este fichero viaja
 * solo al registro público, sin la web, así que no puede importarlo: los tests de LIGA689
 * EJECUTAN los dos sobre las mismas respuestas y exigen la misma respuesta.
 */
export function faltaRelacion(err) {
  const c = String((err && err.code) || '');
  return c === 'PGRST205' || c === '42P01';
}

/**
 * LIGA692 · EL OTRO PUENTE, el de la columna del nonce, y con la misma cautela. Entre que este
 * fichero sale y que la migración del nonce se pega en la base, `signals` no tiene la columna, y
 * pedirla es un 400 `42703` («column … does not exist») de toda la lectura: la cadena dejaría de
 * generarse cada día hasta el pegado. En ese tramo NO puede existir ninguna diferida (el candado de
 * la base las rechaza), así que se vuelve a pedir lo mismo SIN esa columna y se dice. Solo ante
 * ESE código y nombrando ESA columna: cualquier otra columna que falte sigue siendo un error, y
 * una diferida leída sin su nonce no se ancla (la para `huellaDeJson`).
 */
export function faltaColumnaNonce(err) {
  return String((err && err.code) || '') === '42703'
    && new RegExp(`\\b${Sello.COLUMNA_NONCE}\\b`).test(String((err && err.message) || ''));
}

/** El día UTC al que pertenece una señal. Se agrupa por PUBLICACIÓN, no por sellado:
 *  el sellado es publicación + 5 min y solo cambiaría de día en los últimos 5 minutos
 *  de un día UTC. Agrupar por una fecha derivada añadiría una conversión más —y las
 *  conversiones de fecha son de donde salen los errores— a cambio de nada. */
const diaDe = (publicada) => String(publicada || '').slice(0, 10);
const hoyUTC = () => new Date().toISOString().slice(0, 10);
/** LIGA692 · El mes de la carpeta de un compromiso: el de `diaDe`, el mismo criterio que el día. */
const mesDe = (publicada) => diaDe(publicada).slice(0, 7);

/** Trocea la respuesta cruda en las filas, SIN parsear: los literales se preservan. */
export function troceaFilas(jsonTexto) {
  const s = String(jsonTexto);
  const filas = [];
  let i = s.indexOf('['), prof = 0, ini = -1;
  if (i < 0) return filas;
  for (i++; i < s.length; i++) {
    if (s[i] === '"') {                       // saltar la cadena entera, comillas incluidas
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (s[i] === '{') { if (prof === 0) ini = i; prof++; }
    else if (s[i] === '}') { prof--; if (prof === 0 && ini > -1) { filas.push(s.slice(ini, i + 1)); ini = -1; } }
    else if (s[i] === ']' && prof === 0) break;
  }
  return filas;
}

/* ── LIGA662 · LA LECTURA REINTENTA, Y LO DICE ─────────────────────────────────────────
 * El 25-sep-2026 la cadena no se generó («Cadena de integridad» #50): la API pública no
 * respondió en 30 s a la ÚNICA petición de este fichero, y el trabajo se paró sin anclar el
 * día. La víspera esa misma petición tardó un segundo, y los cinco días anteriores salieron
 * bien con el mismo código: fue un parpadeo, y una petición sin reintento lo convertía en un
 * día entero sin anclar.
 *
 * Qué se reintenta y qué no, y por qué la línea va ahí:
 *   · SÍ lo que puede pasarse solo: que no conteste a tiempo, que la red falle, un 5xx o un
 *     429. Esperar y volver a pedir es lo que haría una persona.
 *   · NO un 4xx: una clave mal puesta o una consulta que el servidor rechaza no se arreglan
 *     esperando, y reintentarlas solo retrasaría el aviso.
 * Tres intentos como mucho, con 10 s y 30 s de espera entre ellos: en el peor caso, algo más
 * de dos minutos antes de rendirse, que el trabajo diario se puede permitir.
 *
 * CADA REINTENTO SE DICE (Regla M): una línea `::warning::` que Actions convierte en aviso
 * del run —el mismo sitio donde se vio este fallo— y, fuera de Actions, un «⚠». Un reintento
 * callado escondería justo la señal de que la API empieza a ir mal.
 *
 * Y el resultado NO cambia: lo que se hashea es el texto de la respuesta que llega, igual que
 * antes. Un tercero que ejecute esto obtiene el mismo archivo, haya hecho falta reintentar o no.
 *
 * `fetchFn`, `espera` y `avisa` se inyectan para poder EJECUTAR los caminos de fallo en los
 * tests (LIGA406: leer que el reintento está escrito no prueba que reintente). Por defecto son
 * los de siempre, y `fetch` se busca en el momento de llamar: los tests que ya sustituyen
 * `globalThis.fetch` siguen funcionando igual.
 *
 * LIGA689 · Y el puente de la vista (arriba, `faltaRelacion`) va DENTRO de este mismo bucle, y
 * no en una lectura aparte: la tabla se pide con el mismo plazo y los mismos reintentos, y el
 * paso a la tabla NO gasta un intento, porque no es un fallo —es la otra relación—. Se dice
 * igual que un reintento (Regla M): si la vista falta, quien mira el run tiene que verlo.
 *
 * LIGA692 · Y la lectura del COMPROMISO es esta misma, no otra al lado (Regla J: dos lectores que
 * reintentan se desvían). Con `lector` ({jwt, id}) pide la TABLA —la vista le taparía justo lo que
 * hay que comprometer—, con el JWT del lector en `Authorization` en lugar de la clave anónima, UNA
 * señal, y sin ningún puente: si la tabla no contesta, no hay nada a lo que caer. Sin `lector`,
 * la pública de siempre, y no hay ningún camino por el que esa credencial llegue a ella. */
export const LECTURA = { intentos: 3, esperasMs: [10000, 30000], timeoutMs: 30000 };

/** ¿Merece la pena volver a pedir? Solo lo que se puede pasar solo. */
export function esPasajero(e) {
  if (e && Number.isInteger(e.status)) return e.status >= 500 || e.status === 429;
  // Sin estado HTTP es que no llegó respuesta: el plazo (`TimeoutError`), un aborto, o la red
  // (`fetch failed`, que en Node es un `TypeError`).
  return !!e && ['TimeoutError', 'AbortError', 'TypeError'].includes(e.name);
}

export async function traeSenales({
  fetchFn = (...a) => globalThis.fetch(...a),
  espera = (ms) => new Promise((r) => setTimeout(r, ms)),
  avisa = (m) => console.log(m),
  plan = LECTURA,
  lector = null,
} = {}) {
  const aviso = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : '⚠ ';
  const quien = lector ? 'la lectura del lector del sello' : 'la API pública';
  let rel = lector ? TABLA : VISTA;
  let columnas = lector ? COLUMNAS : COLUMNAS_PASADA;     // LIGA698 · B1 · ver `SOLO_PASADA`
  for (let i = 1; ; i++) {
    try {
      const r = await fetchFn(SUPA + consulta(rel, { columnas, id: lector ? lector.id : null }), {
        headers: { apikey: ANON, authorization: 'Bearer ' + (lector ? lector.jwt : ANON), accept: 'application/json' },
        signal: AbortSignal.timeout(plan.timeoutMs),
      });
      if (!r.ok) {
        if (!lector) {
          let err = null;
          try { err = JSON.parse(await r.text()); } catch { /* sin cuerpo JSON: no es PostgREST diciendo que falta */ }
          if (rel === VISTA && faltaRelacion(err)) {
            avisa(`${aviso}la vista ${VISTA} todavía no existe en la base: se lee la tabla ${TABLA}, `
              + 'que hasta su cierre sirve lo mismo (el puente del despliegue de LIGA689)');
            rel = TABLA;
            i--;                                 // no es un intento fallido: es la otra relación
            continue;
          }
          if (columnas === COLUMNAS_PASADA && faltaColumnaNonce(err)) {
            avisa(`${aviso}la columna ${Sello.COLUMNA_NONCE} todavía no existe en la base: se lee sin ella `
              + '(el puente del despliegue de LIGA692); una diferida no se puede anclar sin ella');
            columnas = COLUMNAS_PASADA.filter((c) => c !== Sello.COLUMNA_NONCE);
            i--;                                 // tampoco es un intento fallido: es la misma lectura, sin esa columna
            continue;
          }
        }
        throw Object.assign(new Error(`${quien} respondió ${r.status}`), { status: r.status });
      }
      const texto = await r.text();          // TEXTO, nunca r.json()
      if (i > 1) avisa(`${aviso}${quien} respondió al intento ${i} de ${plan.intentos}`);
      return troceaFilas(texto);
    } catch (e) {
      if (i >= plan.intentos || !esPasajero(e)) {
        throw Object.assign(new Error(`${e.message} (tras ${i} intento${i === 1 ? '' : 's'})`),
          { status: e.status, cause: e });
      }
      const ms = plan.esperasMs[Math.min(i - 1, plan.esperasMs.length - 1)];
      avisa(`${aviso}${quien} no respondió al intento ${i} de ${plan.intentos} (${e.message}); `
        + `se vuelve a pedir en ${ms / 1000} s`);
      await espera(ms);
    }
  }
}

/* ── LIGA692 · UNA DIFERIDA ENTRA EN LA CADENA CON SU COMPROMISO, O NO ENTRA NADA ─────────────
 * Hasta LIGA692 una diferida viva paraba toda la cadena: este generador no sabía anclarla (por la
 * vista, con la clave anónima, llega con el instrumento y los niveles a NULL, y anclar esa huella
 * RECORTADA la habría hecho discrepar para siempre al revelarse; y leída entera, el archivo del
 * día publicaría su detalle en un registro que no se retira). Ahora sabe, y sin leer nada más:
 *   · VIVA: su huella es la de su COMPROMISO (`integridad/compromisos/AAAA-MM/<id>.txt`), que el
 *     workflow de compromisos escribe en cuanto se cierra su ventana de corrección, con la lectura
 *     privilegiada. El archivo del día la escribe SIN payload —un bloque que empieza por la marca
 *     «comprometida · se revela en estado terminal»— y su huella entra en el digest del día como
 *     cualquier otra. De la fila no se calcula NADA: ni aunque llegue entera por el puente.
 *   · REVELADA (en estado terminal): la vista la sirve entera, nonce incluido, y se recalcula con
 *     `faro-sello-v2`. Tiene que dar su compromiso; si no lo da, es una INCIDENCIA, escrita donde
 *     las demás, y lo que se ancla es lo comprometido.
 *   · Y SIN su compromiso (o con uno que no se puede leer, o que no describe esta fila), o revelada
 *     y sin su nonce: se para todo, y no se escribe NADA —ni el día, ni `cadena.txt`, ni el
 *     buscador—, como hacía la guarda de LIGA689. Un día sin anclar se recupera: la ejecución
 *     siguiente escribe todos los que falten. Anclar una huella que este generador no puede
 *     justificar, no.
 *
 * «Viva» es el criterio de `faro_senal_retenida` (`faro-eventos-lista-blanca.sql`, LIGA680), el
 * mismo con el que la vista la tapa: el modo con el que se selló y uno de sus estados vivos. Sin
 * la mitad de «quién lee»: aquí lee siempre un tercero. Está escrito aquí porque este fichero
 * viaja solo al registro público y no puede preguntarle a la base; los tests de LIGA689 los SACAN
 * de la función y exigen que sean estos. El modo sale de `js/sello.js` (`MODO_DIFERIDO`), que es
 * quien decide con él qué payload tiene una fila. Mira el MODO y el ESTADO, que la vista sirve en
 * claro, y no `detalle_retenido`: así también funciona leyendo la tabla (el puente). */
export const DIFERIDA = { modo: Sello.MODO_DIFERIDO, vivos: ['pending', 'open'] };

/** Los ids de las filas que son una publicación diferida todavía viva. */
export function diferidasVivas(filas) {
  const out = [];
  for (const fila of filas) {
    const c = Sello.crudo(fila);
    if ((c.modo_publicacion?.valor || '') !== DIFERIDA.modo) continue;
    if (!DIFERIDA.vivos.includes(c.status?.valor || '')) continue;
    out.push(c.id?.valor || '(sin id)');
  }
  return out;
}

export const SIN_ARCHIVO = 'no está en integridad/compromisos/';   // el motivo de una diferida sin archivo de compromiso
/** El error que para la pasada: dice cuáles, por qué no se anclan y qué hacer. Solo ids: es público. */
function errorDiferidas({ sinCompromiso, sinNonce }) {
  const partes = [];
  if (sinCompromiso.length) {
    partes.push(`${sinCompromiso.length} señal(es) en publicación DIFERIDA sin un compromiso que la justifique en `
      + `este registro (${sinCompromiso.map((x) => `${x.id}: ${x.motivo}`).join('; ')})`);
  }
  if (sinNonce.length) {
    partes.push(`${sinNonce.length} diferida(s) ya revelada(s) que llegan SIN su nonce (${sinNonce.join(', ')}), así que `
      + `su huella ${Sello.VERSION_V2} no se puede rehacer`);
  }
  /* LIGA692 · revisión · Y QUÉ HACER cuando el compromiso NO ESTÁ, dicho aquí, que es lo que se lee
   * cuando la cadena se para. La base da un aviso por «aceptado» en cuanto GitHub lo RECIBE (su 204)
   * y no vuelve a pedirlo: si el workflow no llegó a escribirlo —no instalado, un JWT caducado, un
   * generador sin aprobar, un push que no entró— nadie más lo pide. El cron lo vuelve a pedir en su
   * minuto siguiente si se borra la fila de esa señal en `public.faro_compromisos`
   * (`faro-compromisos.sql`). Solo para las que NO TIENEN archivo: a un compromiso que está y no se
   * deja leer, o que no describe la fila, volver a pedirlo no lo arregla (el workflow no reescribe
   * uno publicado: sale en INCIDENCIA). Y solo ids con forma de id: esto acaba dentro de un SQL. */
  const faltan = sinCompromiso.filter((x) => x.motivo === SIN_ARCHIVO && UUID.test(x.id)).map((x) => x.id);
  return Object.assign(new Error(`la API pública devuelve ${partes.join('; y ')}. Una diferida entra en la cadena con `
    + 'la huella de su compromiso —integridad/compromisos/AAAA-MM/<id>.txt, que el workflow de compromisos escribe '
    + 'en cuanto se cierra su ventana de corrección—, y sin él este generador no tiene ninguna huella que pueda '
    + 'justificar. No se ha escrito NADA: ni el archivo del día, ni cadena.txt, ni el buscador. Si la señal se '
    + 'publicó hace solo unos minutos, su compromiso puede no haber llegado todavía: vuelve a ejecutarlo más '
    + 'tarde. Si lo ejecutas desde tu copia del registro, puede que no esté al día (git pull). Si no es nada de '
    + 'eso, el compromiso no se ha escrito, y eso hay que mirarlo antes que nada.'
    + (faltan.length ? ' La base lo dio por pedido en cuanto GitHub recibió el aviso, y no lo vuelve a pedir sola: '
      + 'en FARO, arreglado lo que lo impidió (lo dice el run del workflow de compromisos en faro-integridad), se '
      + `vuelve a pedir borrando su fila, «delete from public.faro_compromisos where signal_id in (${faltan.map((x) => `'${x}'`).join(', ')});», `
      + 'el cron lo pide en el minuto siguiente, y con el compromiso ya en el registro se vuelve a ejecutar esta pasada.' : '')),
  { diferidas: [...sinCompromiso.map((x) => x.id), ...sinNonce] });
}

/** El día UTC anterior a uno dado. */
const diaAntes = (f) => new Date(new Date(f + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

/**
 * Lo que YA está en el registro: `id → {huella, archivo}`, leído de los propios archivos
 * publicados. Es la única fuente fiable de «esto ya está anclado».
 *
 * La alternativa —mirar si existe un archivo con la fecha de la señal— parece equivalente
 * y no lo es, por dos sitios: el bloque inicial se traga señales de muchos días distintos
 * y ninguna tiene un archivo con SU fecha (se volverían a anclar cada día, para siempre),
 * y una señal que se hace pública después de que su día ya esté cerrado no entraría jamás
 * en el registro. Preguntando por el id no hay casos raros: o está o no está.
 *
 * LIGA692 · Un bloque empieza por la versión de su payload —`faro-sello-v1` o `faro-sello-v2`— o
 * por la marca de una diferida anclada viva, que no lleva payload (`payload: null`).
 */
function leeAncladas(dir) {
  const m = new Map();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.txt$/.test(f)) continue;
    // LIGA-114 · se guarda también el PAYLOAD anclado, no solo su huella. Con la huella
    // sola, una discrepancia solo se puede reportar («esto ya no coincide»); con el payload
    // se puede EXPLICAR qué línea cambió, que es lo que separa una acusación de un hecho.
    let id = null, bloque = null, comprometida = false;
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (Sello.VERSIONES.includes(l) || l === Sello.MARCA_COMPROMETIDA) {
        bloque = [l]; id = null; comprometida = l === Sello.MARCA_COMPROMETIDA; continue;
      }
      if (bloque === null) continue;
      if (l.startsWith('huella=') && id) {
        m.set(id, { huella: l.slice(7), archivo: f, payload: comprometida ? null : bloque.join('\n') + '\n' });
        id = null; bloque = null; continue;
      }
      bloque.push(l);
      if (l.startsWith('id=')) id = l.slice(3);
    }
  }
  return m;
}

/* LIGA698 · B1 · LAS QUE ESTA CADENA DIJO QUE NO ANCLABA, leídas del propio registro.
 * La NOTA «NO ANCLA» del archivo del día (ver `archivoDia`) escribe una línea por señal que empieza
 * por `PREFIJO_NO_ANCLA`, con el id detrás. Cuando una de ellas se marca como definitiva y se ancla,
 * el archivo de ese día tiene que decir que es una de esas, y dónde se dijo: si no, entra como una
 * tardía más, y el párrafo de las tardías dice de ella lo que no es («se hicieron públicas después
 * de que su día quedara cerrado»). Se lee del REGISTRO, no de una lista aparte: lo que cuenta es lo
 * publicado, y en qué archivo. Devuelve id → el PRIMER archivo que la nombró. */
export const PREFIJO_NO_ANCLA = '#   no se ancla  ';
function leeDeclaradas(dir) {
  const m = new Map();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(x)).sort()) {
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!l.startsWith(PREFIJO_NO_ANCLA)) continue;
      const id = l.slice(PREFIJO_NO_ANCLA.length).split(' ')[0];
      if (UUID.test(id) && !m.has(id)) m.set(id, f);
    }
  }
  return m;
}

/** LIGA698 · B1 · la huella de una lista de ids: el sha256 de los ids ORDENADOS, uno por línea y con
 * salto final (lo mismo que `sort ids.txt | sha256sum` con LC_ALL=C). La repite en SQL la migración que
 * las marca, en el repositorio del producto —ordenadas por su uuid, que es el orden de sus bytes y, en
 * minúsculas, el de `sort()` sobre su texto—, y los tests de LIGA698 ejecutan las dos sobre las mismas
 * filas y exigen la misma. */
export function huellaDeLista(ids) {
  return Sello.sha256([...ids].sort().map((i) => i + '\n').join(''));
}

/* ── LIGA692 · EL COMPROMISO DE UNA DIFERIDA, `faro-compromiso-v1` ─────────────────────────────
 * Un archivo por señal, en `integridad/compromisos/AAAA-MM/<id>.txt` (el mes de su publicación, en
 * UTC: una carpeta por mes, decidido ANTES de escribir el primero, porque moverlos después rompe
 * los enlaces que alguien haya guardado). Lleva el id, la fecha de publicación, la versión del
 * sello y la huella, y una frase: se revela en estado terminal. NO lleva el payload, ni un nivel,
 * ni el instrumento, ni el nonce: es lo único de una diferida viva que se publica, y por eso no
 * puede llevar nada más.
 *
 * El texto de arriba (los comentarios) es para quien lo lea; las líneas de datos son el formato,
 * y se leen ESTRICTAS: en este orden, con estas claves y nada más detrás. Un compromiso que no
 * se deja leer no justifica ninguna huella, y la pasada diaria se para ante él en vez de adivinar. */
export const VERSION_COMPROMISO = 'faro-compromiso-v1';
/** La versión del ARCHIVO del día cuando lleva alguna diferida (el §2 del diseño: el archivo, no la cadena). */
export const VERSION_ARCHIVO_V2 = 'faro-archivo-v2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** LIGA702 · LA FORMA de un estado (y de un tipo) que se escribe en el registro público: minúsculas,
 *  dígitos y `_`, empezando por letra, 40 como mucho. Una sola, y la usan los tres sitios que escriben un
 *  estado —la marca del compromiso tardío (B3), el estado con que se pide el compromiso y la NOTA «NO
 *  ANCLA» (B1)—: hasta LIGA702 cada uno la escribía por su cuenta, `[a-z_]{1,40}`, SIN DÍGITOS, y el CHECK
 *  de `signals.status` tiene dos estados con dígito, `hit_tp1` y `hit_tp2`. De una que cerró en objetivo,
 *  la marca decía «(sin estado)» y la NOTA «(no válido)». Lo encontró el test de E5 de LIGA701, y la
 *  suite de LIGA702 pasa por aquí los 14 estados del CHECK, leídos de las migraciones. Lo que
 *  protege sigue igual: un salto de línea, una mayúscula o un texto vacío no son un estado. */
export const FORMA_ESTADO = /^[a-z][a-z0-9_]{0,39}$/;

/** El texto exacto de un compromiso: de sus datos sale siempre el mismo archivo, byte a byte.
 *
 * LIGA698 · B3 (decidido el 28-sep: «marcarlo en su propio archivo»). `revelada`: el estado en que
 * estaba la señal cuando se calculó, si ya se había revelado. Un compromiso así NO demuestra lo que
 * un compromiso existe para demostrar —que la huella existía antes de que el detalle fuera
 * público—, y hasta LIGA698 solo lo decía el log del run, que caduca. Ahora lo dice su cabecera.
 * Va en COMENTARIOS, antes de la versión: las líneas de datos son las de siempre y `leeCompromiso`
 * (el de aquí y el que ya está publicado en el registro) lo lee igual. */
export function textoCompromiso({ id, publicada, huella, revelada = null }) {
  if (revelada != null && !(FORMA_ESTADO.test(String(revelada)) || String(revelada) === '(sin estado)')) {
    throw new Error('el estado de una revelada no es un estado: no se escribe en el compromiso');
  }
  return [
    '# FARO · integridad · compromiso de una señal en publicación diferida',
    ...(revelada != null ? ['#',
      '# ⚠ ESTE COMPROMISO LLEGÓ TARDE. Cuando se calculó, la señal ya estaba en un estado',
      '# terminal (' + revelada + '): ya se había revelado entera. Su prueba de tiempo es de',
      '# después de esa revelación, así que NO demuestra que la huella existiera antes de que',
      '# se hicieran públicos su instrumento y sus niveles. Su huella es la de la señal ya',
      '# revelada, y la cadena diaria la ancla igual.'] : []),
    '#',
    '# La señal se publicó en modo diferido: mientras la operación vive, su instrumento, su',
    '# dirección y sus niveles no son públicos. Lo que se publica aquí es su HUELLA: el SHA-256',
    `# de su payload canónico ${Sello.VERSION_V2}, que lleva, además de los campos de siempre, un`,
    '# nonce aleatorio de 32 bytes para que nadie pueda adivinarla probando. Este archivo no',
    '# lleva el payload, ni un nivel, ni el instrumento.',
    '#',
    '# Cuando la señal llegue a un estado terminal se revela entera, nonce incluido: entonces',
    `# cualquiera puede pedir su fila a la API pública, construir su payload ${Sello.VERSION_V2}`,
    '# (getfaro.org/verificar) y comprobar que su sha256 es esta huella. La prueba de tiempo de',
    '# este archivo (su .ots) dice desde cuándo existía; este texto no afirma ninguna hora.',
    '# La cadena diaria ancla después esta misma huella, en el archivo del día.',
    VERSION_COMPROMISO,
    'id=' + id,
    'publicada=' + publicada,
    'sello=' + Sello.VERSION_V2,
    'huella=' + huella,
    Sello.MARCA_COMPROMETIDA,
    '',
  ].join('\n');
}

/** Los datos de un compromiso, leídos ESTRICTOS. Lanza, con el motivo, si no tiene su forma. */
export function leeCompromiso(texto) {
  const lineas = String(texto).split('\n');
  const i = lineas.indexOf(VERSION_COMPROMISO);
  if (i < 0) throw new Error(`no es un ${VERSION_COMPROMISO}`);
  if (lineas.slice(0, i).some((l) => l !== '' && !l.startsWith('#'))) throw new Error('lleva datos antes de su versión');
  const [lid, lpub, lsello, lhuella, marca, ...resto] = lineas.slice(i + 1);
  const id = /^id=(.+)$/.exec(lid || ''), pub = /^publicada=(\S+)$/.exec(lpub || '');
  const sello = /^sello=(\S+)$/.exec(lsello || ''), h = /^huella=([0-9a-f]{64})$/.exec(lhuella || '');
  if (!id || !UUID.test(id[1]) || !pub || !sello || !h || marca !== Sello.MARCA_COMPROMETIDA || resto.some((l) => l !== '')) {
    throw new Error(`no tiene la forma de ${VERSION_COMPROMISO}`);
  }
  if (sello[1] !== Sello.VERSION_V2) throw new Error(`es de un sello que este generador no conoce, no de ${Sello.VERSION_V2}`);
  return { id: id[1], publicada: pub[1], sello: sello[1], huella: h[1] };
}

/**
 * Los compromisos del registro: `id → {huella, publicada, ruta}` o `id → {error, ruta}`. Un error
 * no para nada aquí: para la pasada si una señal NECESITA ese compromiso (ver `genera`). Lo que no
 * se llama `<uuid>.txt` —las pruebas `.ots`— no es un compromiso y no se mira.
 */
export function leeCompromisos(dir) {
  const m = new Map();
  const raiz = join(dir, 'compromisos');
  if (!existsSync(raiz)) return m;
  for (const mes of readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const f of readdirSync(join(raiz, mes)).sort()) {
      const k = /^(.+)\.txt$/.exec(f);
      if (!k || !UUID.test(k[1])) continue;
      const ruta = `compromisos/${mes}/${f}`;
      let c;
      try {
        c = leeCompromiso(readFileSync(join(raiz, mes, f), 'utf8'));
        if (c.id !== k[1]) c = { error: `${ruta} dice que es de ${c.id}` };
        else if (mesDe(c.publicada) !== mes) c = { error: `${ruta} es de una señal publicada en ${mesDe(c.publicada)}, no en ${mes}` };
      } catch (e) { c = { error: `${ruta} ${e.message}` }; }
      if (m.has(k[1])) c = { error: `hay dos compromisos de la misma señal: ${m.get(k[1]).ruta} y ${ruta}` };
      m.set(k[1], { ...c, ruta });
    }
  }
  return m;
}

/* LIGA-114 · ¿ES ESTO UNA MANIPULACIÓN O EL DEFECTO QUE YA CONOCEMOS?
 * ---------------------------------------------------------------------------
 * Entre el 12 y el 25 de agosto de 2026, el generador ancló 14 señales PENDIENTES —con
 * `entrada=` vacía, porque su entrada la pone el mercado días después—. LIGA-109 y LIGA-110
 * arreglaron el generador para que no vuelva a pasar, pero esas 14 ya están publicadas y
 * selladas en Bitcoin: eso no se puede deshacer, y no se debe.
 *
 * Cuando una de ellas se active, su huella dejará de coincidir. Hay tres formas de
 * responder a eso y dos son inaceptables:
 *   · callarlo (saltarse la recomprobación de las pendientes) deja el registro diciendo
 *     algo que ya no es cierto, en silencio. Es el peor de los tres.
 *   · gritar «INCIDENCIA DE INTEGRIDAD» es acusar de manipular a un analista por un
 *     defecto nuestro.
 *   · decir exactamente qué cambió y por qué, de forma que cualquiera pueda comprobarlo.
 *
 * Esta función distingue el tercer caso, y lo hace COMPARANDO, no confiando: solo es el
 * defecto conocido si el payload anclado y el de ahora son idénticos línea por línea SALVO
 * que `entrada=` estaba vacía y ahora tiene un precio. Cualquier otra diferencia —el stop,
 * el objetivo, el símbolo, la tesis, o una entrada que cambia de un precio a OTRO— sigue
 * siendo una incidencia y se reporta como tal.
 *
 * El conjunto solo puede menguar: desde LIGA-110 no se ancla nada cuya entrada pueda
 * cambiar, así que esto es una nota a pie de página de un defecto cerrado, no una puerta.
 */
function defectoAnclajePrematuro(anclado, ahora) {
  if (!anclado || !ahora) return null;
  const a = anclado.trimEnd().split('\n'), b = ahora.trimEnd().split('\n');
  if (a.length !== b.length) return null;
  let cambio = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (cambio) return null;                       // más de una línea distinta: no es esto
    if (a[i] !== 'entrada=') return null;          // la anclada tenía que estar VACÍA
    if (!/^entrada=.+$/.test(b[i])) return null;   // y la de ahora, rellena
    cambio = b[i].slice('entrada='.length);
  }
  return cambio;                                   // null si no cambió nada
}

/**
 * LIGA394 · Qué líneas del payload han cambiado, para que la incidencia sea un HECHO y no
 * una acusación. Devuelve [{campo, antes, ahora}], solo de las líneas que difieren.
 *
 * NO relaja nada: `defectoAnclajePrematuro` sigue admitiendo EXACTAMENTE la forma
 * «entrada vacía → entrada rellena» y ninguna otra. Ampliarlo a «valor → valor» sería
 * excusar justo el cambio que este sistema existe para detectar: si alguien reescribe la
 * entrada de una señal cerrada, el retorno cambia entero. Esto no decide nada — solo
 * cuenta lo que pasó, para que quien decida lo haga mirando el dato.
 */
function diffPayload(anclado, ahora) {
  if (!anclado || !ahora) return [];
  const a = anclado.trimEnd().split('\n'), b = ahora.trimEnd().split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const campo = String(a[i] ?? b[i] ?? '').split('=')[0];
    out.push({ campo, antes: (a[i] ?? '(no estaba)'), ahora: (b[i] ?? '(ya no está)') });
  }
  return out;
}

/** El índice de la cadena: una línea por digest, `fecha digest n [inicial]`. */
function leeIndice(indice = INDICE) {
  if (!existsSync(indice)) return [];
  return readFileSync(indice, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [fecha, digest, n, marca] = l.trim().split(/\s+/); return { fecha, digest, n: Number(n), inicial: marca === 'inicial' }; });
}

/* LIGA698 · B1 · LA NOTA «NO ANCLA» (decidido el 28-sep: «el hueco se declara en el repositorio público:
 * rango de fechas, señales afectadas y qué se ha corregido; no se arregla sin declararlo»). Una línea por
 * señal, que empieza por `PREFIJO_NO_ANCLA` —es la que `leeDeclaradas` vuelve a leer—, y la huella de la
 * lista, que es lo que la corrección exige que se le copie de aquí: sin esta NOTA publicada no corre. */
export function notaNoAncla(lista, huella) {
  const dias = lista.map((s) => diaDe(s.publicada)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const deTelegram = lista.filter((s) => s.telegram).length;
  return ['#',
    '# ──────────────────────────────────────────────────────────────────────────',
    '# NOTA · ' + lista.length + ' señal(es) públicas que esta cadena NO ANCLA, y no anclaría nunca.',
    '# Su entrada ya no puede cambiar —son a mercado, o ya terminaron—, pero no están marcadas',
    '# como definitivas («entry_final»), y aquí solo se ancla lo que lo está. Mientras sigan así,',
    '# nada de este registro prueba que no cambien. No se dejan fuera en silencio: se dicen aquí,',
    '# cada día, hasta que se marquen; entonces se anclan, y el archivo de ese día dice que son estas.',
    '#',
    ...lista.map((s) => PREFIJO_NO_ANCLA + s.id + '  publicada ' + (s.publicada || '(sin fecha)')
      + '  (' + (s.tipo || 'sin tipo') + ', ' + (s.estado || 'sin estado') + ')  '
      + (s.telegram ? 'aprobada por Telegram' : 'causa sin identificar')),
    '#',
    ...(dias.length ? ['# Publicadas entre el ' + dias[0] + ' y el ' + dias[dias.length - 1] + ' (día UTC).'] : []),
    ...(deTelegram ? [
      '# Las aprobadas por Telegram tienen una causa conocida: create-signal las publicaba sin',
      '# marcarlas, y así esta cadena se las saltaba. Lo corrige su versión LIGA698, que las marca',
      '# al crearlas y al aprobarlas.'] : []),
    ...(deTelegram < lista.length ? ['# Las demás no tienen todavía una causa identificada.'] : []),
    '#',
    '# Su corrección está atada a esta lista: la migración que las marca se niega a correr si',
    '# lo que ve no da esta huella (sha256 de los ids, ordenados, uno por línea y con salto final):',
    '#     ' + huella,
    '# ──────────────────────────────────────────────────────────────────────────'];
}

/** El archivo de un día: cabecera legible, un bloque por señal, y el digest al final. */
function archivoDia({ fecha, anterior, bloques, textoCadena, digest, inicial, incorporado, tardias = 0, alteradas = [], prematuras = [], desaparecidas = [], huerfanos = [], noAnclables = [], huellaNoAnclables = null, declaradasHoy = [] }) {
  /* LIGA692 · `faro-archivo-v2` SOLO si el día ancla alguna diferida: un bloque suyo. Un día solo
   * con señales en abierto sale exactamente como antes, byte a byte: es lo que tiene que seguir
   * verificando quien ya automatizó esto. Y la versión va en la PRIMERA línea, como en el payload y
   * en el texto del digest: quien lee un archivo sabe desde ahí con qué reglas leer SUS BLOQUES. El
   * digest no cambia de formato (`faro-cadena-v1`): lleva las huellas del día, también las
   * comprometidas.
   * LIGA692 · revisión · Antes era v2 también el día que solo llevaba la INCIDENCIA de una diferida
   * (anclada otro día), y eso no es lo que el README del registro publica —«los días que llevan
   * alguna señal en publicación diferida»— ni lo que se decidió: la marca dice cómo leer los bloques,
   * y los de ese día son todos v1. La incidencia va en comentarios y dice dónde está el compromiso. */
  const diferidas = bloques.filter((b) => b.diferida).length;
  const v2 = diferidas > 0;
  const cab = [
    ...(v2 ? [VERSION_ARCHIVO_V2] : []),
    '# FARO · integridad · ' + fecha,
    '#',
    '# Cada bloque es el payload canónico de una señal y su huella SHA-256. Puedes',
    '# recalcular cualquiera: guarda las líneas del payload (de «faro-sello-v1» hasta',
    '# «tesis_sha256=», ambas incluidas, con salto de línea final) en un archivo y ejecuta',
    '#     sha256sum archivo.txt',
    '# El resultado tiene que ser la huella de debajo. El procedimiento completo, con un',
    '# ejemplo paso a paso, está en getfaro.org/verificar',
    ...(v2 ? ['#',
      '# ── ' + VERSION_ARCHIVO_V2 + ' · este día lleva ' + diferidas + ' señal(es) en PUBLICACIÓN DIFERIDA ──',
      '# Sus bloques tienen una de estas dos formas, y el digest del final se calcula igual',
      '# que siempre, con TODAS las huellas del día, también estas:',
      '#   · de «' + Sello.VERSION_V2 + '» hasta «nonce=»: una diferida ya revelada. Es el payload de',
      '#     siempre con una línea más al final, un nonce aleatorio de 32 bytes que impedía',
      '#     adivinar su huella mientras la operación vivía. Se recalcula igual, con sha256sum,',
      '#     desde «' + Sello.VERSION_V2 + '» hasta «nonce=», ambas incluidas y con salto final.',
      '#   · «' + Sello.MARCA_COMPROMETIDA + '»: una diferida que seguía viva al',
      '#     anclarse. No lleva payload: su instrumento, su dirección y sus niveles no son',
      '#     públicos todavía. Su huella es la de su COMPROMISO, publicado antes en este mismo',
      '#     registro (la línea «compromiso=»), con su propia prueba de tiempo (.ots), que es',
      '#     la que dice desde cuándo existía. Cuando llegue a un estado terminal se revela',
      '#     entera, nonce incluido, y cualquiera puede recalcularla.'] : []),
    '#',
    inicial
      ? '# ⚠ BLOQUE INICIAL. Cubre TODO lo publicado hasta el ' + fecha + ' incluido, y por\n'
        + '# eso lleva esa fecha: es el último día que ancla. Pero estas señales se\n'
        + '# publicaron ANTES de que existiera el anclaje y se incorporaron todas de una vez\n'
        + '# el ' + (incorporado || fecha) + '. Para ellas, esta cadena demuestra que no han\n'
        + '# cambiado desde el ' + (incorporado || fecha) + ' — NO desde que se publicaron.\n'
        + '# Fingir lo contrario sería justo lo que este sistema existe para impedir.'
      : '# Cubre las señales publicadas el ' + fecha + ' (día UTC).',
    ...(tardias ? ['#',
      '# Incluye ' + tardias + ' señal(es) publicadas ANTES de esta fecha que se hicieron',
      '# públicas después de que su día quedara cerrado. Se anclan aquí porque la',
      '# alternativa es que no se anclen nunca; su fecha real de publicación está en el',
      '# campo «publicada» de su payload, sin retocar.'] : []),
    /* LIGA698 · B1 · de esas tardías, las que la cadena DIJO que no anclaba (su NOTA «NO ANCLA», abajo, en
     * un archivo anterior). El párrafo de arriba no se toca —un día solo en abierto sale byte a byte como
     * antes, y es lo que verifica quien ya lo automatizó—; lo que dice de ellas se corrige aquí, junto. */
    ...(declaradasHoy.length ? ['#',
      '# ──────────────────────────────────────────────────────────────────────────',
      '# NOTA · ' + declaradasHoy.length + ' de esas tardías son de las que esta cadena NO ANCLABA, y lo dijo',
      '# antes de que se corrigieran: están en la NOTA «NO ANCLA» del archivo que se cita. Ya',
      '# están marcadas como definitivas, y por eso se anclan aquí. Ellas no se hicieron públicas',
      '# tarde, como dice de las tardías el párrafo de arriba: lo tardío es su anclaje. Y por eso',
      '# también, de ellas, esta cadena demuestra que no han cambiado desde el ' + (incorporado || fecha) + ',',
      '# NO desde que se publicaron.',
      ...declaradasHoy.map((d) => '#   señal    ' + d.id + '  (en la NOTA desde ' + d.archivo + ')'),
      '# ──────────────────────────────────────────────────────────────────────────'] : []),
    ...(alteradas.length ? ['#',
      '# ══════════════════════════════════════════════════════════════════════════',
      '# ⚠ INCIDENCIA DE INTEGRIDAD · ' + alteradas.length + ' señal(es) ya selladas ya no',
      '# coinciden con la huella que se publicó en su día. Va escrito aquí, en el propio',
      '# registro público, porque un sistema que detecta esto y se lo calla no vale nada.',
      ...alteradas.flatMap((a) => ['#',
        '#   señal    ' + a.id,
        '#   anclada  ' + a.anclada + '  (en ' + a.archivo + ')',
        '#   ahora    ' + a.ahora,
        // LIGA692 · de una diferida, POR QUÉ no cuadra: su compromiso ya no es el anclado, o lo
        // revelado no da lo comprometido. Sin payload anclado no hay líneas que comparar.
        ...(a.diferida || []).map((m) => '#     diferida: ' + m),
        // LIGA394 · QUÉ cambió, línea a línea. Sin esto la incidencia solo dice que algo
        // no cuadra, y quien la lea —dentro o fuera— tiene que reconstruirlo a mano.
        ...(a.lineas || []).flatMap((l) => [
          '#     ' + l.campo + ':',
          '#       antes  ' + l.antes,
          '#       ahora  ' + l.ahora])]),
      '#',
      '# La huella anclada NO se toca: sigue siendo la prueba de lo que se publicó.',
      '# ══════════════════════════════════════════════════════════════════════════'] : []),
    // LIGA394 · Bajo el MISMO rótulo de incidencia, y a propósito: una señal sellada que
    // deja de ser pública es tan grave como una que cambia. Es la salida cómoda a una
    // incidencia —retirarla en vez de explicarla— y hasta hoy la cadena no decía nada.
    ...(desaparecidas.length ? ['#',
      '# ══════════════════════════════════════════════════════════════════════════',
      '# ⚠ INCIDENCIA DE INTEGRIDAD · ' + desaparecidas.length + ' señal(es) ya selladas han',
      '# DEJADO DE SER PÚBLICAS. Su huella sigue anclada y es válida, pero la fuente ya no',
      '# las devuelve, así que nadie puede recalcularla: han salido de la vigilancia.',
      '# Causas posibles: is_demo, validated o is_draft. Ninguna es rutina en una señal',
      '# que ya estaba sellada, y por eso se dice aquí en vez de callarlo.',
      ...desaparecidas.flatMap((d) => ['#',
        '#   señal    ' + d.id,
        '#   anclada  ' + d.huella + '  (en ' + d.archivo + ')']),
      '#',
      '# ══════════════════════════════════════════════════════════════════════════'] : []),
    // LIGA-114 · el defecto conocido, dicho entero y por separado. Va en su propia sección
    // y NO bajo el rótulo de incidencia porque no es lo mismo, y mezclarlos haría dos daños
    // a la vez: acusar a un analista de algo que no hizo, y gastar la palabra «incidencia»
    // en un caso benigno, de forma que la próxima de verdad se lea como más de lo mismo.
    ...(prematuras.length ? ['#',
      '# ──────────────────────────────────────────────────────────────────────────',
      '# NOTA · ' + prematuras.length + ' señal(es) ancladas ANTES DE TIEMPO por un defecto',
      '# de este generador, ya corregido. Entre el 12 y el 25 de agosto de 2026 se anclaron',
      '# señales PENDIENTES: señales cuya entrada no la fija el analista al publicar sino el',
      '# mercado al llegar a su precio, días después. Se anclaron con «entrada=» vacía, que',
      '# era la verdad de ese momento, y al activarse esa línea se ha rellenado.',
      '#',
      '# Su huella ya no coincide, y eso NO es una manipulación: es el único cambio que la',
      '# activación produce. Se puede comprobar sin creernos nada — el payload anclado está',
      '# en el archivo que se cita, y la única línea distinta es «entrada=». Si cambiara',
      '# cualquier otra cosa, o si «entrada» pasara de un precio a otro precio, esto',
      '# aparecería arriba como INCIDENCIA y no aquí; la comprobación la hace el código que',
      '# publicamos, no una decisión de quien genera el archivo.',
      ...prematuras.flatMap((a) => ['#',
        '#   señal    ' + a.id + '  (' + a.estado + ')',
        '#   anclada  ' + a.anclada + '  (en ' + a.archivo + ', con entrada vacía)',
        '#   ahora    ' + a.ahora + '  (entrada=' + a.entrada + ')']),
      '#',
      '# No se re-ancla ni se corrige lo publicado: la cadena es inmutable a propósito, y',
      '# tapar un error propio reescribiendo el registro sería peor que el error.',
      '# Desde la corrección, una señal solo entra en la cadena cuando su contenido sellado',
      '# ya no puede cambiar, así que esta lista solo puede menguar.',
      '# ──────────────────────────────────────────────────────────────────────────'] : []),
    // LIGA698 · B4 · los compromisos huérfanos: su propia sección y NOTA, no incidencia (ver `genera`).
    ...(huerfanos.length ? ['#',
      '# ──────────────────────────────────────────────────────────────────────────',
      '# NOTA · ' + huerfanos.length + ' compromiso(s) SIN SU SEÑAL A LA VISTA. Se publicaron en',
      '# este registro (compromisos/), pero su señal no sale hoy en la lectura pública y no está',
      '# anclada en ningún día. Un compromiso no se borra: de una señal en publicación diferida',
      '# es la única prueba de que existió. Por eso se dice aquí, cada día que siga así, en vez',
      '# de dejar que se pierda de vista.',
      ...huerfanos.flatMap((h) => ['#',
        '#   señal       ' + h.id,
        '#   compromiso  ' + h.ruta + (h.error
          ? '  (no se puede leer: ' + String(h.error).replace(/\s+/g, ' ') + ')'
          : '  (huella ' + h.huella + ')')]),
      '#',
      '# ──────────────────────────────────────────────────────────────────────────'] : []),
    // LIGA698 · B1 · las que la cadena no ancla y no anclaría nunca: su NOTA, cada día (ver `genera`).
    ...(noAnclables.length ? notaNoAncla(noAnclables, huellaNoAnclables) : []),
    '#',
    '# El digest del final encadena el del día anterior, así que alterar una señal vieja',
    '# rompe todos los digests posteriores y no solo el suyo.',
    '',
  ].join('\n');
  // LIGA692 · una diferida anclada viva no lleva payload: su marca, su id, dónde está su
  // compromiso y su huella. Todos los demás bloques, como siempre.
  const cuerpo = bloques.map((b) => (b.payload
    ? b.payload + 'huella=' + b.huella + '\n'
    : [Sello.MARCA_COMPROMETIDA, 'id=' + b.id, 'compromiso=' + b.compromiso, 'huella=' + b.huella].join('\n') + '\n')).join('\n');
  const pie = ['', '# ── digest del día ──────────────────────────────────────────',
    '# Es el sha256 de este bloque:', ...textoCadena.trimEnd().split('\n').map((l) => '#   ' + l),
    'digest=' + digest, 'anterior=' + (anterior || '(ninguno: primer digest de la cadena)'),
    'senales=' + bloques.length, ''].join('\n');
  return cab + cuerpo + pie;
}

export async function genera({ escribir = true, hasta = null, dir = DIR } = {}) {
  const indiceRuta = join(dir, 'cadena.txt');
  const filas = await traeSenales();
  const limite = hasta || hoyUTC();            // se ancla hasta AYER: hoy aún no ha cerrado
  const indice = leeIndice(indiceRuta);
  const primeraVez = indice.length === 0;
  const ancladas = leeAncladas(dir);
  // LIGA692 · los compromisos de las diferidas, del propio registro (el clon), como lo anclado.
  const compromisos = leeCompromisos(dir);
  // LIGA698 · B1 · las que esta cadena ya dijo que no anclaba (su NOTA «NO ANCLA»), del registro.
  const declaradas = leeDeclaradas(dir);
  const cubierto = indice.length ? indice[indice.length - 1].fecha : null;
  /** El día que cierra esta ejecución: ayer. Hoy no ha terminado y no se ancla. */
  const cierre = diaAntes(limite);

  /* Una pasada por TODA señal pública, que hace tres cosas a la vez:
   *   · las que ya están ancladas se RECOMPRUEBAN — si su huella de hoy no es la que se
   *     publicó, alguien ha tocado una señal sellada y eso no puede pasar en silencio;
   *   · las que no están ancladas se preparan para entrar;
   *   · las del día en curso se dejan para mañana, porque el día no ha cerrado. */
  const conHuella = [];
  const alteradas = [];
  /* LIGA394 · LAS QUE SE FUERON DE LA VIGILANCIA SIN QUE NADIE LO DIJERA.
   * Esta pasada recorre lo que devuelve la API PÚBLICA. Una señal ya anclada que deje de
   * ser pública —`is_demo` a true, `validated` a false, `is_draft` a true— desaparece de
   * `filas`, así que no se recomprueba nunca más: la cadena se pone verde y no dice nada.
   * Es el agujero de LIGA-110c y LIGA-114 un nivel más afuera, y su propia frase lo
   * describe: «lo que sale de la vigilancia sin que nadie lo anuncie es exactamente lo que
   * este sistema promete que no existe».
   * Importa porque abre la salida más cómoda que hay a una incidencia: en vez de explicar
   * por qué una señal sellada cambió, se la retira de lo público y el registro deja de
   * preguntarlo. Se anota qué ids se han visto y al final se dice cuáles faltan. */
  const vistas = new Set();
  /* LIGA698 · B4 · y TODO lo que la lectura pública sirve, también lo del día en curso: `vistas` no
   * lo lleva (se salta antes). Es con lo que se mira si un compromiso tiene su señal a la vista: uno
   * de una señal publicada hoy no es huérfano, solo es de un día que aún no se cierra. */
  const enLaVista = new Set();
  const prematuras = [];   // LIGA-114 · el defecto conocido, separado de una manipulación
  const noAnclables = [];  // LIGA698 · B1 · definitivas de hecho y sin marcar: fuera para siempre, si nadie lo dice
  // LIGA692 · las diferidas que esta pasada no puede justificar: si hay alguna, no se escribe nada.
  const sinCompromiso = [], sinNonce = [];
  let anclables = 0;
  for (const fila of filas) {
    const campos = Sello.crudo(fila);
    if (campos.id?.valor) enLaVista.add(campos.id.valor);        // LIGA698 · B4
    const dia = diaDe(campos.published_at?.valor || '');
    if (!dia || dia >= limite) continue;       // el día en curso no se cierra
    /* LIGA-109 · UNA PENDIENTE NO SE ANCLA TODAVÍA, y esto no es un matiz.
     * `entrada` es uno de los 15 campos del sello, y una señal de zona se publica con la
     * entrada VACÍA: se rellena al activarse, que puede ser días después. Anclarla el día
     * de publicación y que cambie al activarse produce exactamente la señal de alarma que
     * esta herramienta existe para dar —«esta señal ya no coincide con su huella
     * publicada»— sobre una señal que nadie ha tocado. Comprobado: la huella pasa de
     * 7e13c1d7… a 2097901c… solo por rellenar `entrada=` con `entrada=4102.5`.
     * Con 13 zonas pendientes vivas, la PRIMERA ejecución de la cadena habría abierto con
     * un puñado de incidencias falsas. La cadena no se ha generado nunca todavía, así que
     * esto se arregla antes de que llegue a mentir, no después.
     * La regla: una señal entra en la cadena cuando su contenido sellado es DEFINITIVO.
     * Mientras está pendiente no lo es. Cuando deje de estarlo —activada o expirada—
     * entra por el camino de las «tardías», que ya existe y ya lleva su fecha real de
     * publicación dentro del payload. */
    /* LIGA-110 · Y LA REGLA GENERAL, porque saltar solo las `pending` cubría hasta el
     * PRIMER llenado. Una escalonada rellena la entrada al llenarse el primer punto —ya
     * `open`, ya anclable— y la CAMBIA al llenarse el segundo, días después: la misma
     * incidencia falsa, un estado más tarde. Y no se puede deducir del estado: `open` es
     * definitiva para una de mercado y no lo es para una escalonada a medio llenar.
     * Así que lo decide quien lo sabe —create-signal al publicar, update-prices al
     * observar el precio— y lo escribe en `entry_final`. Aquí solo se lee.
     * Compatible hacia atrás: una fila sin la columna (migración sin aplicar) da
     * `undefined`, y entonces se cae a la regla de LIGA-109, que era correcta aunque
     * incompleta. Nunca se ancla de más por no tener el dato. */
    const fin = campos.entry_final?.valor;
    const definitiva = fin === undefined
      ? (campos.status?.valor || '') !== 'pending'   // sin columna: la regla de LIGA-109
      : fin === 'true';
    const id = (campos.id && campos.id.valor) || '';
    if (id) vistas.add(id);                                      // LIGA394
    /* LIGA692 · UNA DIFERIDA: su huella, con su compromiso o con nada (arriba, `DIFERIDA`). Viva,
     * la de su compromiso, sin calcular NADA de la fila; revelada, la que se recalcula con su nonce,
     * y que tiene que ser la comprometida. Una en abierto, como siempre. */
    const diferida = (campos.modo_publicacion?.valor || '') === DIFERIDA.modo;
    const viva = diferida && DIFERIDA.vivos.includes(campos.status?.valor || '');
    let comp = null;
    if (diferida) {
      comp = compromisos.get(id) || { error: SIN_ARCHIVO };
      if (!comp.error && comp.publicada !== (campos.published_at?.valor || '')) {
        comp = { error: `su compromiso (${comp.ruta}) es de otra fecha de publicación` };
      }
      if (comp.error) { sinCompromiso.push({ id: id || '(sin id)', motivo: comp.error }); continue; }
    }
    let payload = null, huella = null;
    if (viva) huella = comp.huella;
    else {
      try { ({ payload, huella } = await Sello.huellaDeJson(fila)); } catch (e) {
        if (!(e && e.code === Sello.SIN_NONCE)) throw e;
        sinNonce.push(id || '(sin id)');
        continue;
      }
    }
    const ya = ancladas.get(id);
    /* LIGA-114 · LA RECOMPROBACIÓN VA ANTES QUE LA REGLA DE ANCLAJE, y el orden es el
     * arreglo. Con `if (!definitiva) continue;` delante, las 14 pendientes que el generador
     * viejo ya ancló salían de la pasada entera: no se anclaban otra vez —correcto— pero
     * TAMPOCO se volvían a comprobar nunca. El día que una se activara, su huella publicada
     * dejaría de coincidir con la señal y el registro no diría nada. Es el mismo agujero
     * silencioso de LIGA-110c, un nivel más adentro: lo que sale de la vigilancia sin que
     * nadie lo anuncie es exactamente lo que este sistema promete que no existe.
     * La regla correcta son dos reglas distintas:
     *   · lo que YA está en la cadena se comprueba SIEMPRE, pase lo que pase;
     *   · lo que aún no está solo entra cuando su contenido sellado es definitivo. */
    if (ya) {
      if (diferida) {
        /* LIGA692 · Una diferida ya anclada se comprueba contra lo anclado Y contra su compromiso:
         * si el compromiso publicado ya no dice lo que se ancló, alguien ha tocado el registro; si
         * lo revelado no da lo comprometido, alguien ha tocado la señal. Las dos son incidencias, y
         * se dice cuál. (El defecto de LIGA-114 no aplica: una diferida solo puede ser a mercado.) */
        const motivos = [];
        if (comp.huella !== ya.huella) motivos.push(`su compromiso (${comp.ruta}) ya no dice la huella que se ancló`);
        if (!viva && huella !== comp.huella) motivos.push(`lo revelado no da la huella comprometida en ${comp.ruta}`);
        if (huella !== ya.huella || motivos.length) {
          alteradas.push({ id, archivo: ya.archivo, anclada: ya.huella, ahora: huella,
            lineas: diffPayload(ya.payload, payload), diferida: motivos });
        }
      } else if (ya.huella !== huella) {
        const entradaNueva = defectoAnclajePrematuro(ya.payload, payload);
        if (entradaNueva) {
          prematuras.push({ id: campos.id.valor, archivo: ya.archivo, anclada: ya.huella,
            ahora: huella, entrada: entradaNueva, estado: campos.status?.valor || '' });
        } else {
          /* LIGA394 · SE GUARDA QUÉ LÍNEAS CAMBIARON, no solo que la huella no cuadra.
           * El payload anclado ya estaba aquí desde LIGA-114 —y su comentario dice para
           * qué: «con el payload se puede EXPLICAR qué línea cambió, que es lo que separa
           * una acusación de un hecho»—, pero en esta rama se tiraba. Resultado: el 27-ago
           * la cadena publicó «una señal sellada ya no coincide, investígalo AHORA» con dos
           * huellas y nada más, y averiguar que era una activación normal de una señal de
           * zona costó reconstruir el ciclo de vida a mano desde `signal_events`.
           * Una incidencia que no dice QUÉ cambió obliga a esa investigación cada vez. */
          alteradas.push({ id: campos.id.valor, archivo: ya.archivo, anclada: ya.huella, ahora: huella,
            lineas: diffPayload(ya.payload, payload) });
        }
      }
      continue;                                // ya está en la cadena: no se ancla dos veces
    }
    /* LIGA698 · B1 · LA QUE NO ENTRARÍA NUNCA. Saltar lo que no es definitivo (la línea de debajo) es la
     * regla de LIGA-110, y es correcto mientras la entrada pueda cambiar: una pendiente, una escalonada a
     * medio llenar. Pero si ya NO puede —a mercado, que se estampa al publicar, o ya terminada—, saltarla
     * es dejarla fuera para siempre y en silencio. Es lo que les pasó a las alertas aprobadas por
     * Telegram, que create-signal publicaba sin marcar. No se ancla aquí: si es definitiva lo dice la
     * base, no esta pasada (LIGA-110: «no se adivina desde fuera»). Se DICE, cada día, hasta que se
     * marque. Solo con `false` escrito y con su estado: sin el dato (la columna vacía, que llega como
     * '') no se afirma nada de ella. */
    const tipo = campos.signal_type?.valor || '', estado = campos.status?.valor || '';
    if (!definitiva && fin === 'false'
        && (tipo === 'market' || (estado !== '' && !DIFERIDA.vivos.includes(estado)))) {
      /* Lo que va al registro público va con su FORMA, o no va (como el estado de B3): `crudo` decodifica
       * los escapes, y un salto de línea en un estado metería en el archivo del día una línea que
       * `leeAncladas` leería como un bloque. Hoy lo impiden los CHECK de la tabla; esto no depende de ellos. */
      const publicada = campos.published_at?.valor || '';
      noAnclables.push({ id: UUID.test(id) ? id : '(id no válido)',
        publicada: /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(publicada) ? publicada : '(no válida)',
        tipo: tipo === '' || FORMA_ESTADO.test(tipo) ? tipo : '(no válido)',
        estado: FORMA_ESTADO.test(estado) ? estado : '(no válido)',
        telegram: (campos.approval_channel?.valor || '') === 'telegram' });
    }
    if (!definitiva) continue;
    anclables++;
    // `tardia`: pública ahora, pero de un día que la cadena ya cerró (p. ej. se validó
    // después). Entra HOY —su fecha real de publicación va dentro del payload, así que no
    // engaña a nadie— porque la alternativa es que no entre nunca.
    let bloque = { payload, huella };
    if (diferida) {
      /* LIGA692 · Lo que se ancla de una diferida es SIEMPRE lo comprometido. Viva, sin payload.
       * Revelada y cuadrando, con su payload `faro-sello-v2`, que ya es público. Revelada y SIN
       * cuadrar: lo comprometido, sin payload, y la incidencia escrita (el compromiso se publicó
       * antes: es él lo anclado, y lo revelado es lo que ya no coincide con él). */
      if (!viva && huella !== comp.huella) {
        alteradas.push({ id, archivo: comp.ruta, anclada: comp.huella, ahora: huella, lineas: [],
          diferida: [`lo revelado no da la huella comprometida en ${comp.ruta}`] });
      }
      bloque = viva || huella !== comp.huella
        ? { payload: null, huella: comp.huella, id, compromiso: comp.ruta, diferida: true }
        : { payload, huella, diferida: true };
    }
    conHuella.push({ dia, ...bloque, tardia: !!cubierto && dia <= cubierto,
      // LIGA698 · B1 · si la cadena ya dijo que no la anclaba, en qué archivo (ver `leeDeclaradas`).
      declarada: declaradas.has(id) ? { id, archivo: declaradas.get(id) } : null });
  }
  // LIGA692 · la guarda de LIGA689, con su misma intención: lo que no se puede justificar no se ancla.
  if (sinCompromiso.length || sinNonce.length) throw errorDiferidas({ sinCompromiso, sinNonce });

  // Reparto por día. La PRIMERA vez, todo lo anterior va a un único bloque inicial: no se
  // fabrican archivos con fecha pasada, que simularían un anclaje que no existió.
  const porDia = new Map();
  if (primeraVez) {
    porDia.set(cierre, conHuella.slice());
  } else {
    for (const s of conHuella) {
      const f = s.tardia ? cierre : s.dia;
      /* NUNCA se escribe un día que ya está en la cadena. Sin esta guarda, una señal
       * tardía que aparezca cuando el registro ya está al día (cierre == cubierto — p.
       * ej. una segunda ejecución el mismo día) iría a parar a un archivo YA PUBLICADO
       * y lo reescribiría: la violación exacta que este sistema promete impedir. La
       * señal no se pierde: no está en `ancladas`, así que la próxima ejecución la
       * recoge y la ancla en el digest siguiente. Esperar un día es honesto; reescribir
       * la historia no. */
      if (cubierto && f <= cubierto) continue;
      if (!porDia.has(f)) porDia.set(f, []);
      porDia.get(f).push(s);
    }
    // Días sin señales entre el último digest y ayer: se publican IGUAL, vacíos.
    for (let d = new Date(cubierto + 'T00:00:00Z'); ; ) {
      d = new Date(d.getTime() + 86400000);
      const f = d.toISOString().slice(0, 10);
      if (f >= limite) break;
      if (!porDia.has(f)) porDia.set(f, []);
    }
  }

  /* LIGA394 · las ancladas que ya no devuelve la consulta pública. Ver el comentario de
   * `vistas`. Se reporta con su archivo, que es lo que permite ir a mirar su payload
   * sellado sin buscarlo. */
  const desaparecidas = [...ancladas.entries()]
    .filter(([id]) => !vistas.has(id))
    .map(([id, a]) => ({ id, archivo: a.archivo, huella: a.huella }));

  /* LIGA698 · B4 (decidido el 28-sep: «una NOTA en el archivo del día») · LOS COMPROMISOS HUÉRFANOS.
   * Un compromiso publicado cuya señal no sale en la lectura pública y que no está anclado en
   * ningún día. De una diferida, el compromiso es la única prueba de que la señal existió, y hasta
   * LIGA698 un compromiso así no lo reportaba nadie. Es una NOTA y no una INCIDENCIA (lo decidido):
   * no dice que algo sellado haya cambiado, dice que hay un compromiso sin su señal a la vista. Si
   * estaba anclado y su señal se fue, ya es una desaparecida (arriba), y no se repite aquí. */
  const huerfanos = [...compromisos.entries()]
    .filter(([id]) => !enLaVista.has(id) && !ancladas.has(id))
    .map(([id, c]) => ({ id, ruta: c.ruta, huella: c.error ? null : c.huella, error: c.error || null }));

  // LIGA698 · B1 · la huella de la lista de la NOTA «NO ANCLA»: la que la corrección exige que se le copie.
  const huellaNoAnclables = noAnclables.length ? await huellaDeLista(noAnclables.map((s) => s.id)) : null;

  const dias = [...porDia.keys()].sort();
  let anterior = indice.length ? indice[indice.length - 1].digest : '';
  const nuevos = [];
  for (const fecha of dias) {
    const bloques = porDia.get(fecha).slice().sort((a, b) => (a.huella < b.huella ? -1 : 1));
    const { texto, digest } = await Sello.digestDia(fecha, anterior, bloques.map((b) => b.huella));
    nuevos.push({
      fecha, digest, anterior, bloques, textoCadena: texto,
      inicial: primeraVez, incorporado: limite,
      tardias: bloques.filter((b) => b.tardia).length,
      // La incidencia se escribe en el archivo del día que se cierra, no en todos.
      alteradas: fecha === cierre ? alteradas : [],
      prematuras: fecha === cierre ? prematuras : [],
      desaparecidas: fecha === cierre ? desaparecidas : [],
      huerfanos: fecha === cierre ? huerfanos : [],
      // LIGA698 · B1 · las dos NOTAS: la de las que no se anclan, en el día que se cierra; y, en el día que
      // las ancla, cuáles de sus tardías son de las que se dijo antes que no se anclaban.
      noAnclables: fecha === cierre ? noAnclables : [],
      huellaNoAnclables: fecha === cierre ? huellaNoAnclables : null,
      declaradasHoy: bloques.filter((b) => b.tardia && b.declarada).map((b) => b.declarada),
    });
    anterior = digest;
  }

  if (escribir && nuevos.length) {
    mkdirSync(dir, { recursive: true });
    for (const d of nuevos) writeFileSync(join(dir, d.fecha + '.txt'), archivoDia(d));
    const lineas = ['# FARO · índice de la cadena de integridad',
      '# fecha  digest  nº de señales  [inicial]',
      '# La fecha es el último día que cubre ese archivo, y el digest de cada día encadena',
      '# el del anterior. Ver getfaro.org/verificar', ''];
    for (const x of indice) lineas.push(`${x.fecha} ${x.digest} ${x.n}${x.inicial ? ' inicial' : ''}`);
    for (const d of nuevos) lineas.push(`${d.fecha} ${d.digest} ${d.bloques.length}${d.inicial ? ' inicial' : ''}`);
    writeFileSync(indiceRuta, lineas.join('\n') + '\n');

  }
  /* El buscador: `id huella fecha`, una línea por señal anclada.
   *
   * NO es una fuente de verdad, y por eso se regenera entero en cada ejecución a partir
   * de los archivos diarios: es un PUNTERO para que /verificar sepa en qué archivo mirar
   * sin descargarlos todos. Quien verifica sigue teniendo que abrir el archivo del día y
   * encontrar allí la huella; si este índice mintiera, la comprobación fallaría.
   *
   * Sin él, «pego una huella y quiero saber si está» obliga a bajarse el registro entero,
   * que es exactamente el punto en el que se quedó parado el primero que lo probó.
   *
   * Y se escribe TAMBIÉN cuando no hay días nuevos, si falta o no cuadra con los
   * archivos: la primera vez vivió dentro del `if (nuevos.length)` y la ejecución
   * siguiente —«nada nuevo que anclar»— publicó el registro sin buscador, con el botón
   * «Comprobar» de producción dando error hasta el digest siguiente. */
  if (escribir) {
    const filasIdx = [...leeAncladas(dir).entries()]
      .map(([id, v]) => ({ id, huella: v.huella, fecha: v.archivo.replace('.txt', '') }))
      .sort((a, b) => (a.fecha === b.fecha ? (a.id < b.id ? -1 : 1) : (a.fecha < b.fecha ? -1 : 1)));
    const buscador = ['# FARO · buscador del registro de integridad',
      '# id de la señal · huella SHA-256 · archivo del día en que quedó anclada',
      '#',
      '# Es un ÍNDICE, no una prueba: la prueba es el archivo del día. Se regenera entero',
      '# en cada ejecución a partir de esos archivos. Ver getfaro.org/verificar', '',
      ...filasIdx.map((f) => `${f.id} ${f.huella} ${f.fecha}`), ''].join('\n');
    const ruta = join(dir, 'indice.txt');
    if (!existsSync(ruta) || readFileSync(ruta, 'utf8') !== buscador) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(ruta, buscador);
    }
  }
  return { nuevos, total: anclables, primeraVez, alteradas, prematuras, desaparecidas, huerfanos, noAnclables, huellaNoAnclables };
}

/* ── LIGA692 · `--compromiso <id>` · EL COMPROMISO DE UNA DIFERIDA ────────────────────────────
 * Lo ejecuta el workflow de compromisos del registro público cuando la base le avisa —un cron que
 * SOLO AVISA, con un `repository_dispatch` por cada diferida sellada—, y en ningún otro sitio. Por
 * qué aquí y no en la base ni en una función del servidor: la huella es la de `js/sello.js`, y
 * escribirla otra vez en SQL o en otra función sería una segunda implementación de la
 * serialización más delicada de todo esto, que se equivocaría en silencio con una huella que
 * parece buena. Aquí es la MISMA función que usa la pasada diaria y el navegador.
 *
 * Lo que hace, en orden, y cada «no» sale 1 sin escribir nada:
 *   1 · el id tiene que ser un UUID (y si no lo es no se repite: esta salida es pública);
 *   2 · la credencial tiene que ser un JWT del rol del lector, sin caducar. Si no, NO SE MANDA:
 *       ni una clave de servicio pegada por error, ni una de sesión, ni una sin `exp`;
 *   3 · lee ESA señal de la tabla con esa credencial (la misma lectura que reintenta, `lector`);
 *   4 · tiene que ser diferida, estar SELLADA —cerrada su ventana de corrección, el contrario
 *       exacto de la ventana: publicada + 5 min < ahora— y traer su nonce de 32 bytes;
 *   5 · calcula su huella `faro-sello-v2` y escribe `integridad/compromisos/AAAA-MM/<id>.txt`.
 * Si el compromiso ya existe con la MISMA huella, no escribe nada y sale 0 (el aviso puede llegar
 * dos veces). Si existe con OTRA, no lo toca: INCIDENCIA, y sale 1. Nunca se reescribe uno.
 *
 * Lo que dice por su salida es público (los registros de Actions de un repositorio público lo
 * son): el id, la fecha de publicación, el estado y la huella, que es lo que se publica. Ni el
 * payload, ni el instrumento, ni un nivel, ni el nonce, ni la credencial: ni en un error. */
export const LECTOR = Object.freeze({ rol: 'faro_lector_sello', variable: 'FARO_LECTOR_SELLO_JWT' });
/** La ventana de corrección, en minutos: la de la base y la de create-signal (el test lo exige). */
export const VENTANA_CORRECCION_MIN = 5;

/* ── LIGA692 · «EL MISMO DÍA», con los rangos fijados ANTES de medir ─────────────────────────
 * Dos cotas, y ninguna es una medida: las mide el ensayo del programa, y hasta entonces no se dan
 * por cumplidas en ningún sitio.
 *   · `registroTrasVentanaMin` · el compromiso llega al registro como mucho 15 minutos después de
 *     cerrarse la ventana de corrección (t1 − tc);
 *   · `bitcoinTrasPublicacionH` · su prueba de tiempo queda en un bloque de Bitcoin antes de 24
 *     horas desde la publicación (t2 − t0).
 * La primera es la de LLEGAR al registro, y la mide el workflow de compromisos al subirlo (lee el
 * número de aquí): `--compromiso` solo puede decir cuánto después de cerrarse la ventana CALCULÓ la
 * huella, que es antes del sellado de tiempo y del push (LIGA692 · revisión: su salida decía
 * «llega», y no era la llegada). La segunda no se puede saber al escribir (el `.ots` nace
 * pendiente): la mira quien completa las pruebas de tiempo. */
export const MISMO_DIA = Object.freeze({ registroTrasVentanaMin: 15, bitcoinTrasPublicacionH: 24 });

const fallo = (m) => Object.assign(new Error(m), { compromiso: true });

/** Lo que dice el cuerpo de un JWT, o null si no es un JWT. No se verifica nada: eso es de PostgREST. */
function cargaDe(jwt) {
  const p = String(jwt || '').split('.');
  if (p.length !== 3) return null;
  try { return JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')); } catch { return null; }
}

export async function compromete(id, {
  dir = DIR, escribir = true, jwt = null, ahora = Date.now(),
  fetchFn, espera, avisa = (m) => console.log(m), plan = LECTURA,
} = {}) {
  if (!UUID.test(String(id || ''))) throw fallo('el id no es el de una señal (un UUID en minúsculas): no se lee nada');
  const carga = cargaDe(jwt);
  if (!jwt) throw fallo(`falta ${LECTOR.variable}, el JWT del lector del sello: sin él no se lee nada`);
  if (!carga) throw fallo(`${LECTOR.variable} no es un JWT: no se manda`);
  if (carga.role !== LECTOR.rol) {
    const rol = /^[a-z_]{1,40}$/.test(String(carga.role || '')) ? `«${carga.role}»` : 'otro';
    throw fallo(`${LECTOR.variable} lleva el rol ${rol} y no el del lector del sello (${LECTOR.rol}): no se manda`);
  }
  if (!Number.isInteger(carga.exp)) throw fallo(`${LECTOR.variable} no caduca: un JWT sin caducidad no se usa`);
  if (carga.exp * 1000 <= ahora) {
    throw fallo(`${LECTOR.variable} caducó el ${new Date(carga.exp * 1000).toISOString().slice(0, 10)} (UTC): hay que firmar otro`);
  }
  let filas;
  try {
    filas = await traeSenales({ fetchFn, espera, avisa, plan, lector: { jwt, id } });
  } catch (e) {
    const pista = e.status === 401 || e.status === 403 ? ' (¿se ha cambiado el secreto JWT del proyecto, o el rol del lector?)' : '';
    throw fallo(`${e.message}${pista}`);
  }
  if (filas.length !== 1) {
    throw fallo(filas.length ? `el lector ve ${filas.length} filas con ese id`
      : 'el lector no ve ninguna señal pública con ese id (no existe, es un borrador, no está validada o es de siembra)');
  }
  const campos = Sello.crudo(filas[0]);
  if ((campos.id?.valor || '') !== id) throw fallo('la fila que llega no es la de ese id');
  if ((campos.modo_publicacion?.valor || '') !== DIFERIDA.modo) {
    throw fallo('no es una señal en publicación diferida: su huella se ancla en la cadena diaria, sin compromiso');
  }
  const publicada = campos.published_at?.valor || '';
  const t0 = Date.parse(publicada);
  if (!publicada || Number.isNaN(t0) || !/(?:\+00:00|Z)$/.test(publicada)) {
    throw fallo('su fecha de publicación no llega en UTC: la carpeta del mes saldría de otra hora');
  }
  const tc = t0 + VENTANA_CORRECCION_MIN * 60000;
  if (!(tc < ahora)) throw fallo(`todavía está en su ventana de corrección (se sella a las ${new Date(tc).toISOString()}): su huella aún puede cambiar`);
  if (!/^[0-9a-f]{64}$/.test(campos[Sello.COLUMNA_NONCE]?.valor || '')) {
    throw fallo('no trae su nonce de 32 bytes (64 hexadecimales): sin él la huella se podría adivinar, y no se compromete');
  }
  const { payload, huella } = await Sello.huellaDeJson(filas[0]);
  if (!payload.startsWith(Sello.VERSION_V2 + '\n')) throw fallo(`su payload no sale ${Sello.VERSION_V2}`);
  const estado = FORMA_ESTADO.test(campos.status?.valor || '') ? campos.status.valor : '(sin estado)';
  const mes = mesDe(publicada);
  // La carpeta sale de un dato, y va a una ruta: tiene que ser un mes y nada más.
  if (!/^\d{4}-\d{2}$/.test(mes)) throw fallo('su fecha de publicación no da un mes AAAA-MM para la carpeta del compromiso');
  const ruta = `compromisos/${mes}/${id}.txt`;
  const retrasoMin = (ahora - tc) / 60000;
  const base = { id, ruta, huella, publicada, estado, revelada: !DIFERIDA.vivos.includes(estado), retrasoMin };
  const ya = leeCompromisos(dir).get(id);
  if (ya) {
    if (!ya.error && ya.ruta === ruta && ya.publicada === publicada && ya.huella === huella) return { ...base, resultado: 'ya' };
    return { ...base, resultado: 'incidencia', existente: ya };
  }
  if (escribir) {
    mkdirSync(join(dir, 'compromisos', mes), { recursive: true });
    // `wx`: si otro lo escribió entre tanto, esto falla en vez de pisarlo.
    // LIGA698 · B3 · el de una que ya se reveló lo dice en su cabecera (ver `textoCompromiso`).
    writeFileSync(join(dir, ruta), textoCompromiso({ id, publicada, huella, revelada: base.revelada ? estado : null }), { flag: 'wx' });
  }
  return { ...base, resultado: escribir ? 'escrito' : 'por escribir' };
}

/** Lo que `--compromiso` dice de su resultado: solo lo que es público. */
export function informeCompromiso(r) {
  const min = (x) => x.toFixed(1).replace('.', ',');
  const lineas = [];
  if (r.resultado === 'incidencia') {
    lineas.push(`INCIDENCIA · el compromiso publicado de ${r.id} no es el que da la señal: no se reescribe`);
    lineas.push(`  publicado  ${r.existente.error ? r.existente.error : `${r.existente.huella} (${r.existente.ruta})`}`);
    lineas.push(`  ahora      ${r.huella} (${r.ruta})`);
    return lineas;
  }
  lineas.push(r.resultado === 'ya'
    ? `el compromiso de ${r.id} ya estaba publicado con esta misma huella: no se escribe nada · ${r.huella}`
    : `${r.resultado === 'escrito' ? 'escrito ' : 'faltaría'} integridad/${r.ruta} · huella ${r.huella}`);
  // La LLEGADA, que es lo que el plazo declarado mide, no se sabe aquí: la mide el workflow al subirlo.
  if (r.resultado !== 'ya') {
    lineas.push(`calculado ${min(r.retrasoMin)} min después de cerrarse su ventana de corrección (su llegada al `
      + `registro, que es lo que mide el plazo declarado de ${MISMO_DIA.registroTrasVentanaMin} min, se mide al subirlo)`);
  }
  if (r.revelada) {
    lineas.push(`⚠ la señal ya está en estado terminal (${r.estado}): este compromiso llega después de revelarse `
      + 'y no demuestra que existiera antes');
    // LIGA698 · B3 · y queda dicho donde no caduca (el log sí): en el propio archivo.
    if (r.resultado === 'escrito' || r.resultado === 'por escribir') lineas.push('  y así lo dice la cabecera de su archivo');
  }
  return lineas;
}

if (process.argv[1] && process.argv[1].endsWith('sellar.mjs')) {
  const check = process.argv.includes('--check');
  const k = process.argv.indexOf('--compromiso');
  if (k > -1) {
    // LIGA692 · la ÚNICA lectura de la credencial en todo el fichero: la pasada diaria no la ve.
    compromete(process.argv[k + 1], { escribir: !check, jwt: process.env.FARO_LECTOR_SELLO_JWT }).then((r) => {
      for (const l of informeCompromiso(r)) console.log(l);
      // Como `--check` de la pasada: sale 1 si algo no cuadra, y aquí también si faltaría escribirlo.
      if (r.resultado === 'incidencia' || r.resultado === 'por escribir') process.exit(1);
    }).catch((e) => { console.error('no se pudo escribir el compromiso:', e.message); process.exit(1); });
  } else {
    genera({ escribir: !check }).then(({ nuevos, total, primeraVez, alteradas, prematuras, desaparecidas, huerfanos, noAnclables, huellaNoAnclables }) => {
      for (const d of nuevos) {
        const dif = d.bloques.filter((b) => b.diferida).length;
        console.log(`${check ? 'faltaría' : 'escrito '} integridad/${d.fecha}.txt · ${d.bloques.length} señales · digest ${d.digest.slice(0, 16)}…${d.inicial ? ' (BLOQUE INICIAL)' : ''}${d.tardias ? ` · ${d.tardias} tardía(s)` : ''}${dif ? ` · ${dif} diferida(s), ${VERSION_ARCHIVO_V2}` : ''}`);
      }
      if (!nuevos.length) console.log('nada nuevo que anclar · ' + total + ' señales ya en la cadena');
      if (primeraVez && nuevos.length) console.log('\n⚠ primera ejecución: bloque inicial con ' + total + ' señales anteriores al anclaje');
      // La incidencia se dice SIEMPRE y en último lugar, para que sea lo que quede a la
      // vista. El archivo se escribe igual —la cadena no puede tener huecos— y el fallo lo
      // provoca el paso siguiente del workflow, después de publicar: callarlo sería peor.
      if (prematuras.length) {
        // LIGA-114 · se dice SIEMPRE, aunque no rompa nada: una lista que no se imprime es
        // una lista que nadie mira, y esta tiene que ir menguando hasta vaciarse.
        console.log('\nNOTA · ' + prematuras.length + ' señal(es) ancladas antes de tiempo por el defecto ya corregido (no es manipulación):');
        for (const a of prematuras) console.log(`  ${a.id} · ${a.estado} · se rellenó entrada=${a.entrada} (${a.archivo})`);
      }
      // LIGA698 · B4 · como la de LIGA-114: una NOTA que no se imprime es una nota que nadie lee.
      if (huerfanos?.length) {
        console.log('\nNOTA · ' + huerfanos.length + ' compromiso(s) sin su señal a la vista (ni en la lectura pública ni anclada):');
        for (const h of huerfanos) console.log(`  ${h.id} · integridad/${h.ruta}${h.error ? ' · no se puede leer' : ''}`);
      }
      // LIGA698 · B1 · las dos NOTAS de B1, igual: la huella de la lista es la que pide la corrección.
      const declaradasHoy = nuevos.flatMap((d) => d.declaradasHoy || []);
      if (declaradasHoy.length) {
        console.log('\nNOTA · ' + declaradasHoy.length + ' señal(es) que la cadena no anclaba, y lo dijo, se anclan ya marcadas:');
        for (const d of declaradasHoy) console.log(`  ${d.id} · en la NOTA desde integridad/${d.archivo}`);
      }
      if (noAnclables?.length) {
        console.log('\nNOTA · ' + noAnclables.length + ' señal(es) públicas que la cadena NO ANCLA y no anclaría nunca (definitivas sin marcar):');
        for (const s of noAnclables) console.log(`  ${s.id} · ${s.publicada} · ${s.tipo || 'sin tipo'}, ${s.estado || 'sin estado'} · ${s.telegram ? 'aprobada por Telegram' : 'causa sin identificar'}`);
        console.log('  huella de la lista: ' + huellaNoAnclables);
      }
      if (alteradas.length) {
        console.log('\nINCIDENCIA · ' + alteradas.length + ' señal(es) selladas ya no coinciden con su huella publicada:');
        for (const a of alteradas) {
          console.log(`  ${a.id} · anclada ${a.anclada.slice(0, 16)}… · ahora ${a.ahora.slice(0, 16)}… (${a.archivo})`);
          // LIGA692 · de una diferida, por qué (su compromiso, o lo revelado).
          for (const m of a.diferida || []) console.log(`      diferida: ${m}`);
          // LIGA394 · el QUÉ, aquí también: `--check` es lo que ejecuta quien audita desde
          // fuera, y mandarle dos huellas sin decirle qué línea se movió es mandarlo a ciegas.
          for (const l of a.lineas || []) console.log(`      ${l.campo}: «${l.antes}» → «${l.ahora}»`);
        }
      }
      /* LIGA-20 · `--check` sale 1 si algo NO CUADRA, y una señal sellada que ya no
       * coincide con su huella publicada es lo que menos cuadra de todo lo que puede pasar
       * aquí. Hasta hoy la condición era solo `nuevos.length`: el comando cantaba la
       * INCIDENCIA por pantalla y salía CERO. Quien audita desde fuera —que es para quien
       * existe `--check`, y así está anunciado cuatro líneas más arriba: «sale 1 si algo no
       * cuadra»— lo encadena (`&& echo OK`, un `if` en un script, un cron) y se lleva un OK
       * justo en el caso para el que se montó el sistema entero.
       *
       * En el workflow NO cambia nada, y es a propósito: el paso que comprueba el
       * determinismo distingue los dos motivos por la salida, porque una incidencia no
       * puede parar el trabajo ANTES de publicar —la cadena no puede tener huecos y el
       * archivo del día tiene que salir con la incidencia escrita dentro—. Quien hace
       * fallar el trabajo por una incidencia es el paso de DESPUÉS de publicar. */
      /* LIGA394 · y la MISMA línea para las desaparecidas, por el mismo motivo que LIGA-20
       * la escribió para las alteradas: `--check` existe para quien audita desde fuera y lo
       * encadena con `&& echo OK`. Una señal sellada que ha salido de lo público es
       * exactamente el caso en el que ese OK no puede salir. */
      if (desaparecidas?.length) {
        console.log('\nINCIDENCIA · ' + desaparecidas.length + ' señal(es) selladas han DEJADO DE SER PÚBLICAS '
          + '(is_demo, validated o is_draft): su huella ya no se puede recalcular desde la fuente.');
        for (const d of desaparecidas) console.log(`  ${d.id} · anclada ${d.huella.slice(0, 16)}… (${d.archivo})`);
      }
      if (check && (nuevos.length || alteradas.length || desaparecidas?.length)) process.exit(1);
    }).catch((e) => { console.error('no se pudo generar la cadena:', e.message); process.exit(1); });
  }
}
