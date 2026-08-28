/* FARO · Generador de la cadena de integridad
 * ───────────────────────────────────────────────────────────────────────────
 * Construye el archivo diario de integridad: el payload canónico y la huella de cada
 * señal sellada, y el digest del día encadenado con el del día anterior.
 *
 * ── LO MÁS IMPORTANTE DE ESTE ARCHIVO ──────────────────────────────────────
 * NO USA NI UNA CREDENCIAL. Lee la API pública de Supabase con la clave anon, que viaja
 * en el código fuente de la web y es pública por diseño; y no escribe en la base de
 * datos, porque la huella no se guarda en ningún sitio: se calcula.
 *
 * Esa propiedad es la que convierte la promesa en algo comprobable. Cualquiera puede
 * clonar el repositorio, ejecutar este mismo script y obtener BYTE A BYTE el mismo
 * archivo que publicamos nosotros. Si no coincidiera, sería porque hemos tocado algo. No
 * hay que fiarse de que nuestro servidor haga bien las cuentas: se rehacen.
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

/** Los MISMOS filtros que ve el público. Si una señal no es pública, no se ancla. */
const CONSULTA = '/rest/v1/signals?select=*&validated=eq.true&is_draft=not.is.true'
  + '&is_demo=eq.false&order=published_at.asc';

/** El día UTC al que pertenece una señal. Se agrupa por PUBLICACIÓN, no por sellado:
 *  el sellado es publicación + 5 min y solo cambiaría de día en los últimos 5 minutos
 *  de un día UTC. Agrupar por una fecha derivada añadiría una conversión más —y las
 *  conversiones de fecha son de donde salen los errores— a cambio de nada. */
const diaDe = (publicada) => String(publicada || '').slice(0, 10);
const hoyUTC = () => new Date().toISOString().slice(0, 10);

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

async function traeSenales() {
  const r = await fetch(SUPA + CONSULTA, {
    headers: { apikey: ANON, authorization: 'Bearer ' + ANON, accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`la API pública respondió ${r.status}`);
  return troceaFilas(await r.text());        // TEXTO, nunca r.json()
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
 */
function leeAncladas(dir) {
  const m = new Map();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.txt$/.test(f)) continue;
    // LIGA-114 · se guarda también el PAYLOAD anclado, no solo su huella. Con la huella
    // sola, una discrepancia solo se puede reportar («esto ya no coincide»); con el payload
    // se puede EXPLICAR qué línea cambió, que es lo que separa una acusación de un hecho.
    let id = null, bloque = null;
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (l === 'faro-sello-v1') { bloque = [l]; id = null; continue; }
      if (bloque === null) continue;
      if (l.startsWith('huella=') && id) {
        m.set(id, { huella: l.slice(7), archivo: f, payload: bloque.join('\n') + '\n' });
        id = null; bloque = null; continue;
      }
      bloque.push(l);
      if (l.startsWith('id=')) id = l.slice(3);
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

/** El índice de la cadena: una línea por digest, `fecha digest n [inicial]`. */
function leeIndice(indice = INDICE) {
  if (!existsSync(indice)) return [];
  return readFileSync(indice, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [fecha, digest, n, marca] = l.trim().split(/\s+/); return { fecha, digest, n: Number(n), inicial: marca === 'inicial' }; });
}

/** El archivo de un día: cabecera legible, un bloque por señal, y el digest al final. */
function archivoDia({ fecha, anterior, bloques, textoCadena, digest, inicial, incorporado, tardias = 0, alteradas = [], prematuras = [] }) {
  const cab = [
    '# FARO · integridad · ' + fecha,
    '#',
    '# Cada bloque es el payload canónico de una señal y su huella SHA-256. Puedes',
    '# recalcular cualquiera: guarda las líneas del payload (de «faro-sello-v1» hasta',
    '# «tesis_sha256=», ambas incluidas, con salto de línea final) en un archivo y ejecuta',
    '#     sha256sum archivo.txt',
    '# El resultado tiene que ser la huella de debajo. El procedimiento completo, con un',
    '# ejemplo paso a paso, está en getfaro.org/verificar',
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
    ...(alteradas.length ? ['#',
      '# ══════════════════════════════════════════════════════════════════════════',
      '# ⚠ INCIDENCIA DE INTEGRIDAD · ' + alteradas.length + ' señal(es) ya selladas ya no',
      '# coinciden con la huella que se publicó en su día. Va escrito aquí, en el propio',
      '# registro público, porque un sistema que detecta esto y se lo calla no vale nada.',
      ...alteradas.flatMap((a) => ['#',
        '#   señal    ' + a.id,
        '#   anclada  ' + a.anclada + '  (en ' + a.archivo + ')',
        '#   ahora    ' + a.ahora]),
      '#',
      '# La huella anclada NO se toca: sigue siendo la prueba de lo que se publicó.',
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
    '#',
    '# El digest del final encadena el del día anterior, así que alterar una señal vieja',
    '# rompe todos los digests posteriores y no solo el suyo.',
    '',
  ].join('\n');
  const cuerpo = bloques.map((b) => b.payload + 'huella=' + b.huella + '\n').join('\n');
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
  const prematuras = [];   // LIGA-114 · el defecto conocido, separado de una manipulación
  let anclables = 0;
  for (const fila of filas) {
    const campos = Sello.crudo(fila);
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
    const { payload, huella } = await Sello.huellaDeJson(fila);
    const ya = ancladas.get((campos.id && campos.id.valor) || '');
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
      if (ya.huella !== huella) {
        const entradaNueva = defectoAnclajePrematuro(ya.payload, payload);
        if (entradaNueva) {
          prematuras.push({ id: campos.id.valor, archivo: ya.archivo, anclada: ya.huella,
            ahora: huella, entrada: entradaNueva, estado: campos.status?.valor || '' });
        } else {
          alteradas.push({ id: campos.id.valor, archivo: ya.archivo, anclada: ya.huella, ahora: huella });
        }
      }
      continue;                                // ya está en la cadena: no se ancla dos veces
    }
    if (!definitiva) continue;
    anclables++;
    // `tardia`: pública ahora, pero de un día que la cadena ya cerró (p. ej. se validó
    // después). Entra HOY —su fecha real de publicación va dentro del payload, así que no
    // engaña a nadie— porque la alternativa es que no entre nunca.
    conHuella.push({ dia, payload, huella, tardia: !!cubierto && dia <= cubierto });
  }

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
  return { nuevos, total: anclables, primeraVez, alteradas, prematuras };
}

if (process.argv[1] && process.argv[1].endsWith('sellar.mjs')) {
  const check = process.argv.includes('--check');
  genera({ escribir: !check }).then(({ nuevos, total, primeraVez, alteradas, prematuras }) => {
    for (const d of nuevos) {
      console.log(`${check ? 'faltaría' : 'escrito '} integridad/${d.fecha}.txt · ${d.bloques.length} señales · digest ${d.digest.slice(0, 16)}…${d.inicial ? ' (BLOQUE INICIAL)' : ''}${d.tardias ? ` · ${d.tardias} tardía(s)` : ''}`);
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
    if (alteradas.length) {
      console.log('\nINCIDENCIA · ' + alteradas.length + ' señal(es) selladas ya no coinciden con su huella publicada:');
      for (const a of alteradas) console.log(`  ${a.id} · anclada ${a.anclada.slice(0, 16)}… · ahora ${a.ahora.slice(0, 16)}… (${a.archivo})`);
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
    if (check && (nuevos.length || alteradas.length)) process.exit(1);
  }).catch((e) => { console.error('no se pudo generar la cadena:', e.message); process.exit(1); });
}
