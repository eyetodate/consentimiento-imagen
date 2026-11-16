/*
 * Consentimiento de cesión de imagen — app para iPad (PWA, sin conexión).
 * Todos los datos se guardan exclusivamente en el dispositivo (IndexedDB).
 */
(function () {
  'use strict';

  const APP_VERSION = '1.1.0';
  const TEXTO_VERSION = 'CI-FOTOS-MSS-2pag-RGPD v1';

  const FINALIDADES = [
    { id: 'seguimiento', corto: 'Seguimiento', texto: 'Con la finalidad de elaborar un dossier de seguimiento de mi tratamiento, en el que se puede ver la evolución del tratamiento que me ha sido aplicado.' },
    { id: 'docencia', corto: 'Congresos y publicaciones', texto: 'Científicas y de docencia, para su uso en conferencias, congresos así como revistas científicas y libros de textos.' },
    { id: 'difusion', corto: 'Webs y redes sociales', texto: 'Con fines de difusión, tanto en medios de comunicación visual, así como en las webs corporativas de la entidad y en redes sociales.' },
    { id: 'publicidad', corto: 'Publicidad', texto: 'Fines publicitarios, de la actividad del DOCTOR, tanto en su parte benéfica como no.' },
  ];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const TINTA = '#0d2366';

  // ------------------------------------------------------------------ utilidades
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** JSON canónico (claves ordenadas) para calcular la huella de forma reproducible. */
  function canon(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }

  async function sha256(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function verificarIntegridad(rec) {
    const copia = Object.assign({}, rec);
    delete copia.hash;
    return (await sha256(canon(copia))) === rec.hash;
  }

  const p2 = (n) => String(n).padStart(2, '0');
  const fechaLarga = (d) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  const fechaCorta = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const horaCorta = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const fechaHora = (d) => `${fechaCorta(d)} ${horaCorta(d)}:${p2(d.getSeconds())}`;

  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function slug(s) {
    return normalizar(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  }

  const limpiar = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const nombreCompleto = (p) => limpiar(`${p.nombre} ${p.apellidos}`);
  const etiquetaDoc = (t) => ({ DNI: 'D.N.I.', NIE: 'N.I.E.', PAS: 'pasaporte' }[t] || 'documento');
  const etiquetaDocCorta = (t) => ({ DNI: 'DNI', NIE: 'NIE', PAS: 'Pasaporte' }[t] || 'Doc.');

  function validarDocumento(tipo, valor) {
    let v = String(valor || '').toUpperCase().replace(/[\s.\-]/g, '');
    const L = 'TRWAGMYFPDXBNJZSQVHLCKE';
    if (!v) return { ok: false, msg: 'Introduzca el número de documento.' };
    if (tipo === 'DNI' && /^[XYZ]\d{7}[A-Z]$/.test(v)) tipo = 'NIE';
    if (tipo === 'DNI') {
      if (/^\d{7}[A-Z]$/.test(v)) v = '0' + v;
      if (!/^\d{8}[A-Z]$/.test(v)) return { ok: false, msg: 'El DNI debe tener 8 números y una letra (ej.: 12345678Z).' };
      if (L[parseInt(v.slice(0, 8), 10) % 23] !== v[8]) return { ok: false, msg: 'La letra del DNI no corresponde al número. Revíselo.' };
    } else if (tipo === 'NIE') {
      if (!/^[XYZ]\d{7}[A-Z]$/.test(v)) return { ok: false, msg: 'El NIE debe tener el formato X1234567L.' };
      const num = parseInt('XYZ'.indexOf(v[0]) + v.slice(1, 8), 10);
      if (L[num % 23] !== v[8]) return { ok: false, msg: 'La letra del NIE no corresponde al número. Revíselo.' };
    } else {
      if (!/^[A-Z0-9]{5,20}$/.test(v)) return { ok: false, msg: 'El número de pasaporte solo puede contener letras y números.' };
    }
    return { ok: true, valor: v, tipo };
  }

  function textoDomicilio(d) {
    if (!d) return '';
    const partes = [];
    if (d.calle) partes.push(d.calle + (d.numero ? `, núm. ${d.numero}` : ''));
    else if (d.numero) partes.push(`núm. ${d.numero}`);
    if (d.localidad) partes.push(`Localidad ${d.localidad}`);
    if (d.provincia) partes.push(`Provincia ${d.provincia}`);
    if (d.cp) partes.push(`C.P. ${d.cp}`);
    return partes.join(', ');
  }

  // ------------------------------------------------------------------ base de datos
  const DB = {
    db: null,
    abrir() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('consentimiento-imagen', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('consentimientos')) db.createObjectStore('consentimientos', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('eliminados')) db.createObjectStore('eliminados', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
        };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    _tx(store, modo, fn) {
      return new Promise((res, rej) => {
        const tx = this.db.transaction(store, modo);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => res(req ? req.result : undefined);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
    },
    get(store, key) { return this._tx(store, 'readonly', (s) => s.get(key)); },
    all(store) { return this._tx(store, 'readonly', (s) => s.getAll()); },
    put(store, val, key) { return this._tx(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))); },
    del(store, key) { return this._tx(store, 'readwrite', (s) => s.delete(key)); },
    add(store, val) { return this._tx(store, 'readwrite', (s) => s.add(val)); },
  };

  // ------------------------------------------------------------------ estado
  let cfg = null;           // configuración del doctor
  let borrador = null;      // consentimiento en curso
  let recActual = null;     // consentimiento abierto en detalle / éxito
  const pdfArchivos = new Map();
  const pdfPromesas = new Map();
  const pads = {};

  const cfgCompleta = () => !!(cfg && cfg.nombre && cfg.nif && cfg.domicilio && cfg.email && cfg.lugar && cfg.firma);

  // ------------------------------------------------------------------ texto del documento
  function construirDocumento(b, c, fecha) {
    const pac = b.paciente;
    const rep = b.representante;
    const nom = nombreCompleto(pac);
    const dom = textoDomicilio(pac.domicilio);
    const idPac = `${etiquetaDoc(pac.tipoDoc)} ${pac.documento}`;
    const B = [];
    B.push({ t: 'title', x: 'ACUERDO DE CESIÓN DE IMAGEN' });
    B.push({ t: 'h', x: 'DATOS DEL CEDENTE' });
    B.push({ t: 'p', x: `D./Dª ${nom}, ${dom ? `con domicilio en ${dom}, y ` : 'con '}${idPac}.` });
    if (rep) {
      B.push({ t: 'h', x: 'REPRESENTANTE LEGAL DEL CEDENTE' });
      B.push({ t: 'p', x: `D./Dª ${rep.nombre}, con ${etiquetaDoc(rep.tipoDoc)} ${rep.documento}, en su condición de representante legal (${rep.calidad}) del arriba indicado cedente.` });
    }
    B.push({ t: 'p', x: 'Por este acuerdo autoriza expresamente a:' });
    B.push({ t: 'p', b: true, x: `${c.nombre.toUpperCase()} con CIF nº ${c.nif} y con domicilio a efectos en ${c.domicilio}, (en adelante, EL DOCTOR).` });
    B.push({ t: 'p', x: 'Que por parte de EL DOCTOR se me ha sido explicado e informado que se va a producir la captación de mi imagen y voz a través de fotografías y/o vídeo, posterior conservación y transmisión de dichas imágenes y voz durante el tratamiento al que me estoy sometiendo.' });
    B.push({ t: 'p', x: 'Posteriormente, estas mismas fotografías y/o vídeo, será destinado a las siguientes finalidades que marque,' });
    for (const f of FINALIDADES) B.push({ t: 'check', id: f.id, x: f.texto, v: !!b.finalidades[f.id] });
    B.push({ t: 'p', x: 'Mi autorización se refiere a la totalidad de usos que puedan tener dichas imágenes y voz, o partes de las mismas, en las que aparezca, utilizando los medios técnicos conocidos en la actualidad y los que pudieran desarrollarse en el futuro, todo ello con la única salvedad y limitación de aquellas utilizaciones o aplicaciones que pudieran atentar al derecho al honor en los términos previstos en la Ley Orgánica 1/1985, de 5 de Mayo, de Protección Civil al Derecho al Honor, la Intimidad Personal y familiar y a la Propia Imagen.' });
    B.push({ t: 'p', x: 'Mi autorización no tiene ámbito geográfico determinado ya que me ha sido informado, que uno de sus usos será para la inclusión de las imágenes y/o voz en páginas webs, o en sus correspondientes perfiles de las distintas redes sociales en las que se encuentra, por lo que EL DOCTOR, pueda ceder a cualquier tercero, los derechos de explotación sobre las imágenes y/o voz, o partes de los mismos, en las que intervenga, para la consecución de las finalidades ya descritas, pudiendo utilizar esas imágenes y/o voz, o partes de los mismos, sin limitación geográfica de ninguna clase, dada las características de su difusión a través de la web.' });
    B.push({ t: 'p', x: 'Los datos personales se conservarán durante:' });
    B.push({ t: 'li', x: 'no más tiempo del necesario para los fines de los tratamientos especificados en los apartados anteriores,' });
    B.push({ t: 'li', x: 'los plazos previstos en las disposiciones legales aplicables o,' });
    B.push({ t: 'li', x: 'los que se deriven de las relaciones contractuales entre la entidad responsable del tratamiento y el titular de los datos o interesado, sin perjuicio del ejercicio de los derechos que a continuación se indican.' });
    B.push({ t: 'p', x: 'Manifiesto así mismo mi renuncia a percibir cualquier tipo de compensación o retribución económica por la cesión efectuada en este documento, con independencia de los fines a los que se destine.' });
    B.push({ t: 'p', x: 'En cumplimiento de lo dispuesto en el art 13 del Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016, relativo a la protección de las personas físicas en lo que respecta al tratamiento de datos personales y a la libre circulación de estos datos (Reglamento General de Protección de Datos), informamos al interesado, como titular de los datos de carácter personal que nos ha facilitado, que la finalidad de los datos cedidos es la gestión y uso de las imágenes tal y como en este documento se recoge. El responsable de este tratamiento es EL DOCTOR.' });
    B.push({ t: 'p', x: `Con respecto a sus datos personales, Vd. dispone de los derechos de acceso, rectificación, oposición, supresión (derecho al olvido), limitación del tratamiento y portabilidad, en su caso, que puede ejercitar ante el responsable del tratamiento dirigiéndose a través de correo electrónico a la dirección ${c.email}, acompañando fotocopia de DNI.` });
    if (c.web) {
      B.push({ t: 'h', x: 'INFORMACIÓN ADICIONAL' });
      B.push({ t: 'p', x: `Vd. puede consultar la información adicional y detallada sobre nuestra política de Protección de Datos en nuestra página web: ${c.web}` });
    }
    B.push({ t: 'h', x: 'CONSIENTO' });
    B.push({ t: 'p', x: 'Que se me proceda a la captación de mi imagen y voz a través de fotografías y/o video, para su posterior conservación y transmisión de las mismas durante la realización del tratamiento que se me va a practicar, lo cual autorizo en el pertinente documento de consentimiento para su posterior utilización en los fines ya indicados.' });
    B.push({ t: 'p', x: 'Manifiesto así mismo mi renuncia a percibir cualquier tipo de compensación o retribución económica por la cesión efectuada en este documento, con independencia de los fines a los que se destine y han sido autorizadas por mí.' });
    B.push({ t: 'p', x: `Don/Doña ${nom}, ${dom ? `con domicilio en ${dom} y ` : 'con '}${etiquetaDoc(pac.tipoDoc)} nº ${pac.documento}.` });
    if (rep) B.push({ t: 'p', x: `Don/Doña ${rep.nombre}, en calidad de ${rep.calidad} de ${nom}.` });
    B.push({ t: 'p', x: `En ${c.lugar}, a ${fechaLarga(fecha)}.` });
    B.push({ t: 'firmas' });
    return B;
  }

  function renderDocHTML(bloques, opts) {
    opts = opts || {};
    let h = '';
    let enLista = false;
    for (const b of bloques) {
      if (b.t !== 'li' && enLista) { h += '</ul>'; enLista = false; }
      switch (b.t) {
        case 'title': h += `<h2 class="doc-titulo">${esc(b.x)}</h2>`; break;
        case 'h': h += `<h3 class="doc-sec">${esc(b.x)}</h3>`; break;
        case 'p': h += `<p${b.b ? ' class="doc-destacado"' : ''}>${esc(b.x)}</p>`; break;
        case 'li': if (!enLista) { h += '<ul>'; enLista = true; } h += `<li>${esc(b.x)}</li>`; break;
        case 'check':
          if (opts.interactivo) {
            const on = !!(opts.sel && opts.sel[b.id]);
            h += `<button type="button" class="finalidad${on ? ' marcada' : ''}" data-finalidad="${b.id}" aria-pressed="${on}"><span class="caja" aria-hidden="true"></span><span class="finalidad-texto">${esc(b.x)}</span><span class="finalidad-estado">${on ? 'Autorizo' : 'No autorizo'}</span></button>`;
          } else {
            h += `<div class="finalidad estatica ${b.v ? 'si' : 'no'}"><span class="caja" aria-hidden="true">${b.v ? '✓' : ''}</span><span class="finalidad-texto"><strong>${b.v ? 'SÍ AUTORIZO.' : 'NO AUTORIZO.'}</strong> ${esc(b.x)}</span></div>`;
          }
          break;
        case 'firmas': h += opts.rec ? htmlFirmas(opts.rec) : '<p class="doc-nota">Las firmas se recogerán en el siguiente paso.</p>'; break;
      }
    }
    if (enLista) h += '</ul>';
    return h;
  }

  function htmlFirmas(rec) {
    const col = (titulo, firma, nombre, vacio) => `
      <div class="firma-col">
        <div class="firma-tit">${esc(titulo)}</div>
        <div class="firma-img">${firma ? `<img src="${firma}" alt="Firma de ${esc(nombre)}">` : `<span class="firma-vacia">${esc(vacio || '')}</span>`}</div>
        <div class="firma-fdo">Fdo.: ${esc(nombre)}</div>
      </div>`;
    let h = '<div class="firmas">';
    h += col(rec.doctor.nombre, rec.doctor.firma, rec.doctor.nombre);
    h += col('El Paciente', rec.firmas.paciente && rec.firmas.paciente.png, nombreCompleto(rec.paciente), 'Firma el representante legal');
    if (rec.representante) h += col('El Representante Legal', rec.firmas.representante && rec.firmas.representante.png, rec.representante.nombre);
    return h + '</div>';
  }

  // ------------------------------------------------------------------ panel de firma
  function anchoTrazo(tipo, p) {
    if (tipo === 'pen') return 0.8 + Math.max(0.05, Math.min(1, p || 0.5)) * 3.2;
    return 2.4;
  }

  function dibujarSegmento(ctx, tr, k, w, h) {
    const P = tr.puntos;
    const X = (i) => P[i][0] * w;
    const Y = (i) => P[i][1] * h;
    ctx.lineWidth = anchoTrazo(tr.tipo, P[k - 1][3]);
    ctx.beginPath();
    if (k === 1) ctx.moveTo(X(0), Y(0));
    else ctx.moveTo((X(k - 2) + X(k - 1)) / 2, (Y(k - 2) + Y(k - 1)) / 2);
    ctx.quadraticCurveTo(X(k - 1), Y(k - 1), (X(k - 1) + X(k)) / 2, (Y(k - 1) + Y(k)) / 2);
    ctx.stroke();
  }

  function dibujarFinal(ctx, tr, w, h) {
    const P = tr.puntos;
    const n = P.length;
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(P[0][0] * w, P[0][1] * h, anchoTrazo(tr.tipo, P[0][3]) / 2 + 0.3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.lineWidth = anchoTrazo(tr.tipo, P[n - 1][3]);
    ctx.beginPath();
    ctx.moveTo((P[n - 2][0] * w + P[n - 1][0] * w) / 2, (P[n - 2][1] * h + P[n - 1][1] * h) / 2);
    ctx.lineTo(P[n - 1][0] * w, P[n - 1][1] * h);
    ctx.stroke();
  }

  function prepararCtx(ctx) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = TINTA;
    ctx.fillStyle = TINTA;
  }

  function dibujarTrazos(ctx, trazos, w, h) {
    prepararCtx(ctx);
    for (const tr of trazos) {
      for (let k = 1; k < tr.puntos.length; k++) dibujarSegmento(ctx, tr, k, w, h);
      dibujarFinal(ctx, tr, w, h);
    }
  }

  class PadFirma {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.limpiar();
      this.onCambio = () => {};
      canvas.addEventListener('pointerdown', (e) => this.abajo(e));
      canvas.addEventListener('pointermove', (e) => this.mover(e));
      canvas.addEventListener('pointerup', (e) => this.arriba(e));
      canvas.addEventListener('pointercancel', (e) => this.arriba(e));
      canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      if (window.ResizeObserver) new ResizeObserver(() => this.ajustar()).observe(canvas);
      window.addEventListener('orientationchange', () => setTimeout(() => this.ajustar(), 300));
    }

    limpiar() {
      this.trazos = [];
      this.actual = null;
      this.idPuntero = null;
      this.t0 = null;
      this.inicio = null;
      this.fin = null;
      this.usoLapiz = false;
      if (this.w) this.redibujar();
      if (this.c) this.c.parentElement.classList.remove('con-firma');
    }

    ajustar() {
      const r = this.c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = window.devicePixelRatio || 1;
      this.w = r.width;
      this.h = r.height;
      this.c.width = Math.round(r.width * dpr);
      this.c.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.redibujar();
    }

    redibujar() {
      this.ctx.clearRect(0, 0, this.w, this.h);
      dibujarTrazos(this.ctx, this.trazos, this.w, this.h);
    }

    pos(e) {
      const r = this.c.getBoundingClientRect();
      const t = Math.round(performance.now() - this.t0);
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000, t, Math.round((e.pressure || 0) * 100) / 100];
    }

    abajo(e) {
      if (e.pointerType === 'touch' && this.usoLapiz) return; // rechazo de la palma al usar el lápiz
      if (this.actual) return;
      e.preventDefault();
      if (!this.w) this.ajustar();
      try { this.c.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
      if (e.pointerType === 'pen') this.usoLapiz = true;
      if (this.t0 == null) { this.t0 = performance.now(); this.inicio = new Date().toISOString(); }
      this.idPuntero = e.pointerId;
      this.actual = { tipo: e.pointerType || 'touch', puntos: [this.pos(e)] };
      this.trazos.push(this.actual);
      prepararCtx(this.ctx);
      this.c.parentElement.classList.add('con-firma');
    }

    mover(e) {
      if (!this.actual || e.pointerId !== this.idPuntero) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      prepararCtx(this.ctx);
      for (const ev of (evs.length ? evs : [e])) {
        const p = this.pos(ev);
        const P = this.actual.puntos;
        const ult = P[P.length - 1];
        if (Math.abs(p[0] - ult[0]) * this.w < 0.6 && Math.abs(p[1] - ult[1]) * this.h < 0.6) continue;
        P.push(p);
        dibujarSegmento(this.ctx, this.actual, P.length - 1, this.w, this.h);
      }
    }

    arriba(e) {
      if (!this.actual || e.pointerId !== this.idPuntero) return;
      prepararCtx(this.ctx);
      dibujarFinal(this.ctx, this.actual, this.w, this.h);
      this.actual = null;
      this.idPuntero = null;
      this.fin = new Date().toISOString();
      this.onCambio();
    }

    vacia() { return this.trazos.length === 0; }

    /** Devuelve un mensaje de error si la firma no es válida. */
    problema() {
      if (!this.trazos.length) return 'Falta la firma.';
      let minX = 1, maxX = 0, minY = 1, maxY = 0, n = 0;
      for (const t of this.trazos) for (const p of t.puntos) { n++; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      if (n < 8 || ((maxX - minX) * this.w < 40 && (maxY - minY) * this.h < 25)) return 'La firma es demasiado pequeña. Bórrela y firme de nuevo.';
      return null;
    }

    exportar() {
      let minX = 1, maxX = 0, minY = 1, maxY = 0, n = 0;
      for (const t of this.trazos) for (const p of t.puntos) { n++; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      const pad = 10;
      const S = 2;
      const bw = (maxX - minX) * this.w + pad * 2;
      const bh = (maxY - minY) * this.h + pad * 2;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bw * S));
      cv.height = Math.max(1, Math.round(bh * S));
      const ctx = cv.getContext('2d');
      ctx.scale(S, S);
      ctx.translate(-minX * this.w + pad, -minY * this.h + pad);
      dibujarTrazos(ctx, this.trazos, this.w, this.h);
      return {
        png: cv.toDataURL('image/png'),
        ancho: cv.width,
        alto: cv.height,
        lienzo: { ancho: Math.round(this.w), alto: Math.round(this.h) },
        inicio: this.inicio,
        fin: this.fin,
        duracionMs: this.trazos.length ? this.trazos[this.trazos.length - 1].puntos.slice(-1)[0][2] : 0,
        numTrazos: this.trazos.length,
        numPuntos: n,
        trazos: this.trazos.map((t) => ({ tipo: t.tipo, puntos: t.puntos })),
      };
    }
  }

  // ------------------------------------------------------------------ navegación
  const VISTAS = {
    inicio: { titulo: 'Consentimientos de imagen' },
    datos: { titulo: 'Nuevo consentimiento', atras: 'cancelar' },
    documento: { titulo: 'Nuevo consentimiento', atras: 'cancelar' },
    firma: { titulo: 'Nuevo consentimiento', atras: 'cancelar' },
    exito: { titulo: 'Consentimiento guardado' },
    detalle: { titulo: 'Consentimiento', atras: 'inicio' },
    ajustes: { titulo: 'Ajustes', atras: 'inicio' },
  };
  let vistaActual = 'inicio';

  function ir(nombre) {
    vistaActual = nombre;
    for (const v of Object.keys(VISTAS)) $('#v-' + v).hidden = v !== nombre;
    const def = VISTAS[nombre];
    $('#titulo').textContent = def.titulo;
    const atras = $('#btn-atras');
    atras.hidden = !def.atras;
    atras.textContent = def.atras === 'cancelar' ? 'Cancelar' : '‹ Inicio';
    $('#btn-ajustes').hidden = nombre !== 'inicio';
    window.scrollTo(0, 0);
    if (nombre === 'inicio') mostrarInicio();
    if (nombre === 'ajustes') mostrarAjustes();
    if (nombre === 'firma') requestAnimationFrame(() => { pads.paciente.ajustar(); pads.representante.ajustar(); });
  }

  async function cancelarBorrador() {
    const ok = await modal({
      titulo: '¿Cancelar este consentimiento?',
      html: '<p>Se perderán los datos introducidos y no se guardará nada.</p>',
      botones: [{ texto: 'Seguir rellenando', clase: 'sec', valor: false }, { texto: 'Sí, cancelar', clase: 'peligro', valor: true }],
    });
    if (ok) { borrador = null; ir('inicio'); }
  }

  // ------------------------------------------------------------------ inicio
  async function mostrarInicio() {
    const lista = (await DB.all('consentimientos')).sort((a, b) => (a.creado < b.creado ? 1 : -1));
    $('#aviso-config').hidden = cfgCompleta();
    $('#contador').textContent = lista.length ? `(${lista.length})` : '';

    // aviso de copia de seguridad
    const ultima = await DB.get('config', 'ultimaCopia');
    const pendientes = lista.filter((r) => !ultima || r.creado > ultima).length;
    const dias = ultima ? (Date.now() - new Date(ultima).getTime()) / 86400000 : Infinity;
    const avisoB = $('#aviso-backup');
    if (pendientes > 0 && dias >= 7) {
      $('#aviso-backup-texto').innerHTML = `<strong>${pendientes} consentimiento${pendientes > 1 ? 's' : ''} sin copia de seguridad.</strong> ${ultima ? `Última copia: ${fechaCorta(new Date(ultima))}.` : 'Todavía no se ha hecho ninguna copia.'}`;
      avisoB.hidden = false;
    } else avisoB.hidden = true;

    const q = normalizar($('#buscar').value).trim();
    const filtrada = q ? lista.filter((r) => normalizar(`${r.paciente.nombre} ${r.paciente.apellidos} ${r.paciente.apellidos} ${r.paciente.nombre} ${r.paciente.documento} ${r.representante ? r.representante.nombre : ''}`).includes(q)) : lista;
    const ul = $('#lista');
    ul.innerHTML = filtrada.map((r) => {
      const d = new Date(r.creado);
      const chips = FINALIDADES.filter((f) => r.finalidades[f.id]).map((f) => `<span class="chip chip-${f.id}">${esc(f.corto)}</span>`).join('');
      return `<li><button type="button" class="item" data-id="${r.id}">
        <span class="item-princ"><strong>${esc(limpiar(r.paciente.apellidos))}, ${esc(limpiar(r.paciente.nombre))}</strong>
        <span class="item-sec">${etiquetaDocCorta(r.paciente.tipoDoc)} ${esc(r.paciente.documento)} · ${fechaCorta(d)} ${horaCorta(d)} · Nº ${r.numero}${r.representante ? ' · Representante legal' : ''}</span>
        <span class="chips">${chips}</span></span>
        <span class="chev" aria-hidden="true">›</span></button></li>`;
    }).join('');
    const vacia = $('#lista-vacia');
    vacia.hidden = filtrada.length > 0;
    vacia.innerHTML = lista.length ? 'No hay resultados para esta búsqueda.' : 'Todavía no hay consentimientos firmados.<br>Pulse <strong>+ Nuevo consentimiento</strong> para empezar.';
    $('#restaurar-inicio').hidden = lista.length > 0;
  }

  // ------------------------------------------------------------------ paso 1: datos
  function nuevoConsentimiento() {
    if (!cfgCompleta()) {
      toast('Primero configure los datos y la firma del doctor.');
      ir('ajustes');
      return;
    }
    borrador = { paciente: null, representante: null, finalidades: {}, leido: false };
    const f = $('#f-datos');
    f.reset();
    $('#rep-campos').hidden = true;
    $('#rep-otro').hidden = true;
    $('#info-previos').hidden = true;
    $$('.error', f).forEach((e) => (e.textContent = ''));
    $$('.invalido', f).forEach((e) => e.classList.remove('invalido'));
    pads.paciente.limpiar();
    pads.representante.limpiar();
    ir('datos');
  }

  function errorCampo(form, nombre, msg) {
    const el = form.elements[nombre];
    if (el) el.classList.add('invalido');
    const p = $(`[data-error="${nombre}"]`, form);
    if (p) p.textContent = msg;
  }

  async function avisarPrevios() {
    const f = $('#f-datos');
    const v = validarDocumento(f.elements.tipoDoc.value, f.elements.documento.value);
    const info = $('#info-previos');
    if (!v.ok) { info.hidden = true; return; }
    const previos = (await DB.all('consentimientos')).filter((r) => r.paciente.documento === v.valor).sort((a, b) => (a.creado < b.creado ? 1 : -1));
    if (previos.length) {
      info.textContent = `Este paciente ya tiene ${previos.length} consentimiento${previos.length > 1 ? 's' : ''} firmado${previos.length > 1 ? 's' : ''} (el último el ${fechaCorta(new Date(previos[0].creado))}). Puede continuar igualmente.`;
      info.hidden = false;
    } else info.hidden = true;
  }

  function enviarDatos(ev) {
    ev.preventDefault();
    const f = ev.target;
    const E = f.elements;
    $$('.error', f).forEach((e) => (e.textContent = ''));
    $$('.invalido', f).forEach((e) => e.classList.remove('invalido'));
    let ok = true;
    const nombre = limpiar(E.nombre.value);
    const apellidos = limpiar(E.apellidos.value);
    if (!nombre) { E.nombre.classList.add('invalido'); ok = false; }
    if (!apellidos) { E.apellidos.classList.add('invalido'); ok = false; }
    const doc = validarDocumento(E.tipoDoc.value, E.documento.value);
    if (!doc.ok) { errorCampo(f, 'documento', doc.msg); ok = false; } else { E.documento.value = doc.valor; E.tipoDoc.value = doc.tipo; }
    const cp = limpiar(E.cp.value);
    if (cp && !/^\d{5}$/.test(cp)) { E.cp.classList.add('invalido'); errorCampo(f, 'general', 'El código postal debe tener 5 cifras.'); ok = false; }

    let representante = null;
    if (E.conRep.checked) {
      const rn = limpiar(E.repNombre.value);
      if (!rn) { E.repNombre.classList.add('invalido'); ok = false; }
      const rd = validarDocumento(E.repTipoDoc.value, E.repDocumento.value);
      if (!rd.ok) { errorCampo(f, 'repDocumento', rd.msg); ok = false; } else { E.repDocumento.value = rd.valor; E.repTipoDoc.value = rd.tipo; }
      let calidad = E.repCalidad.value;
      if (calidad === 'otro') {
        calidad = limpiar(E.repCalidadOtro.value);
        if (!calidad) { E.repCalidadOtro.classList.add('invalido'); ok = false; }
      }
      if (ok) representante = { nombre: rn, tipoDoc: rd.tipo, documento: rd.valor, calidad };
    }
    if (!ok) {
      if (!$('[data-error="general"]', f).textContent) errorCampo(f, 'general', 'Revise los campos marcados en rojo.');
      const primero = $('.invalido', f);
      if (primero) primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    borrador.paciente = {
      nombre, apellidos, tipoDoc: doc.tipo, documento: doc.valor,
      domicilio: { calle: limpiar(E.calle.value), numero: limpiar(E.numero.value), localidad: limpiar(E.localidad.value), provincia: limpiar(E.provincia.value), cp },
    };
    borrador.representante = representante;
    mostrarDocumento();
  }

  // ------------------------------------------------------------------ paso 2: documento
  function mostrarDocumento() {
    const bloques = construirDocumento(borrador, cfg, new Date());
    $('#doc-lectura').innerHTML = renderDocHTML(bloques, { interactivo: true, sel: borrador.finalidades });
    $('#chk-leido').checked = borrador.leido;
    $('#err-documento').textContent = '';
    ir('documento');
  }

  function alternarFinalidad(btn) {
    const id = btn.dataset.finalidad;
    borrador.finalidades[id] = !borrador.finalidades[id];
    const on = borrador.finalidades[id];
    btn.classList.toggle('marcada', on);
    btn.setAttribute('aria-pressed', on);
    $('.finalidad-estado', btn).textContent = on ? 'Autorizo' : 'No autorizo';
    $('#err-documento').textContent = '';
  }

  function irAFirma() {
    borrador.leido = $('#chk-leido').checked;
    const err = $('#err-documento');
    if (!FINALIDADES.some((f) => borrador.finalidades[f.id])) {
      err.textContent = 'Marque al menos una finalidad. Si no desea autorizar ninguna, no es necesario firmar el documento.';
      return;
    }
    if (!borrador.leido) {
      err.textContent = 'Marque la casilla «He leído y comprendo el contenido de este documento».';
      return;
    }
    const nom = nombreCompleto(borrador.paciente);
    const autoriza = FINALIDADES.filter((f) => borrador.finalidades[f.id]);
    const noAutoriza = FINALIDADES.filter((f) => !borrador.finalidades[f.id]);
    $('#resumen-firma').innerHTML = `
      <p><strong>${esc(nom)}</strong> · ${etiquetaDocCorta(borrador.paciente.tipoDoc)} ${esc(borrador.paciente.documento)}${borrador.representante ? `<br>Representante legal: <strong>${esc(borrador.representante.nombre)}</strong> (${esc(borrador.representante.calidad)}) · ${etiquetaDocCorta(borrador.representante.tipoDoc)} ${esc(borrador.representante.documento)}` : ''}</p>
      <div class="resumen-fin"><div><span class="resumen-tit si">Autoriza</span><ul>${autoriza.map((f) => `<li>${esc(f.corto)}</li>`).join('')}</ul></div>
      ${noAutoriza.length ? `<div><span class="resumen-tit no">No autoriza</span><ul>${noAutoriza.map((f) => `<li>${esc(f.corto)}</li>`).join('')}</ul></div>` : ''}</div>
      <p class="nota">Al firmar, acepta el documento que acaba de leer con las opciones marcadas. Fecha: ${fechaLarga(new Date())}.</p>`;
    const conRep = !!borrador.representante;
    $('#bloque-pad-rep').hidden = !conRep;
    $('#pad-paciente-titulo').textContent = conRep ? 'Firma del paciente (opcional)' : 'Firma del paciente';
    $('#pad-paciente-nombre').textContent = nom;
    $('#pad-rep-nombre').textContent = conRep ? borrador.representante.nombre : '';
    $('#err-firma').textContent = '';
    ir('firma');
  }

  // ------------------------------------------------------------------ paso 3: firma y guardado
  async function firmarYGuardar() {
    const err = $('#err-firma');
    err.textContent = '';
    const conRep = !!borrador.representante;
    if (conRep) {
      const pr = pads.representante.problema();
      if (pr) { err.textContent = 'Representante legal: ' + pr; return; }
      if (!pads.paciente.vacia()) {
        const pp = pads.paciente.problema();
        if (pp) { err.textContent = 'Paciente: ' + pp; return; }
      }
    } else {
      const pp = pads.paciente.problema();
      if (pp) { err.textContent = pp; return; }
    }

    const btn = $('#btn-firmar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const ahora = new Date();
      const todos = await DB.all('consentimientos');
      const elim = await DB.all('eliminados');
      const ultimo = todos.concat(elim).sort((a, b) => b.numero - a.numero)[0];
      const rec = {
        id: uuid(),
        numero: (ultimo ? ultimo.numero : 0) + 1,
        creado: ahora.toISOString(),
        creadoLocal: fechaHora(ahora),
        zonaHoraria: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
        textoVersion: TEXTO_VERSION,
        appVersion: APP_VERSION,
        paciente: borrador.paciente,
        representante: borrador.representante,
        finalidades: Object.fromEntries(FINALIDADES.map((f) => [f.id, !!borrador.finalidades[f.id]])),
        leidoYComprendido: true,
        lugar: cfg.lugar,
        doctor: { nombre: cfg.nombre, nif: cfg.nif, domicilio: cfg.domicilio, email: cfg.email, web: cfg.web || '', firma: cfg.firma },
        documento: construirDocumento(borrador, cfg, ahora),
        firmas: {
          paciente: pads.paciente.vacia() ? null : pads.paciente.exportar(),
          representante: conRep ? pads.representante.exportar() : null,
        },
        dispositivo: {
          userAgent: navigator.userAgent,
          plataforma: navigator.platform || '',
          idioma: navigator.language || '',
          pantalla: `${screen.width}x${screen.height} @${window.devicePixelRatio || 1}x`,
          appInstalada: !!(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone),
        },
        hashAnterior: ultimo ? ultimo.hash : null,
      };
      rec.hash = await sha256(canon(rec));
      await DB.add('consentimientos', rec);
      borrador = null;
      pads.paciente.limpiar();
      pads.representante.limpiar();
      recActual = rec;
      prepararPDF(rec);
      $('#exito-texto').innerHTML = `Registro nº <strong>${rec.numero}</strong> · ${esc(nombreCompleto(rec.paciente))} · ${fechaHora(ahora)}`;
      ir('exito');
    } catch (e) {
      console.error(e);
      err.textContent = 'No se ha podido guardar: ' + (e && e.message ? e.message : e) + '. Inténtelo de nuevo.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Firmar y guardar';
    }
  }

  // ------------------------------------------------------------------ detalle
  function descripcionPuntero(f) {
    if (!f) return '';
    const tipos = new Set(f.trazos.map((t) => t.tipo));
    const nombres = { pen: 'lápiz digital', touch: 'dedo', mouse: 'ratón' };
    return Array.from(tipos).map((t) => nombres[t] || t).join(' y ');
  }

  function presionRegistrada(f) {
    return !!(f && f.trazos.some((t) => t.tipo === 'pen' && t.puntos.some((p) => p[3] > 0 && p[3] < 1)));
  }

  function filasEvidencias(rec, integra, anterior) {
    const d = new Date(rec.creado);
    const filas = [
      ['Identificador del documento', rec.id],
      ['Nº de registro', String(rec.numero)],
      ['Fecha y hora de la firma', `${rec.creadoLocal || fechaHora(d)} (${rec.zonaHoraria || 'hora local'}) · UTC ${rec.creado}`],
      ['Lugar', rec.lugar],
      ['Paciente', `${nombreCompleto(rec.paciente)} · ${etiquetaDocCorta(rec.paciente.tipoDoc)} ${rec.paciente.documento}`],
    ];
    if (rec.representante) filas.push(['Representante legal', `${rec.representante.nombre} · ${etiquetaDocCorta(rec.representante.tipoDoc)} ${rec.representante.documento} · ${rec.representante.calidad}`]);
    filas.push(['Finalidades', FINALIDADES.map((f) => `${f.corto}: ${rec.finalidades[f.id] ? 'SÍ' : 'NO'}`).join(' · ')]);
    filas.push(['Lectura del documento', 'El firmante marcó «He leído y comprendo el contenido de este documento».']);
    const desc = (f) => f ? `Capturada con ${descripcionPuntero(f)} · ${f.numTrazos} trazos, ${f.numPuntos} puntos · duración ${(f.duracionMs / 1000).toFixed(1)} s${presionRegistrada(f) ? ' · presión registrada' : ''} · inicio ${f.inicio}` : 'No firma';
    filas.push(['Firma del paciente', rec.firmas.paciente ? desc(rec.firmas.paciente) : (rec.representante ? 'No firma (firma el representante legal)' : 'No firma')]);
    if (rec.representante) filas.push(['Firma del representante', desc(rec.firmas.representante)]);
    filas.push(['Firma del doctor', 'Firma registrada previamente en la configuración de la aplicación']);
    filas.push(['Dispositivo', `${rec.dispositivo.userAgent} · pantalla ${rec.dispositivo.pantalla}`]);
    filas.push(['Versión del texto / app', `${rec.textoVersion} · app ${rec.appVersion}`]);
    filas.push(['Huella SHA-256 del registro', rec.hash]);
    filas.push(['Huella del registro anterior', rec.hashAnterior ? `${rec.hashAnterior}${anterior ? ` (registro nº ${anterior})` : ''}` : 'Ninguna (primer registro)']);
    if (integra !== undefined) filas.push(['Comprobación de integridad', integra ? 'Correcta: el registro no ha sido modificado desde su firma.' : 'FALLIDA: el contenido no coincide con su huella.']);
    return filas;
  }

  async function mostrarDetalle(id) {
    const rec = await DB.get('consentimientos', id);
    if (!rec) { toast('No se encuentra el consentimiento.'); ir('inicio'); return; }
    recActual = rec;
    prepararPDF(rec);
    const integra = await verificarIntegridad(rec);
    let anterior = null;
    if (rec.hashAnterior) {
      const todos = (await DB.all('consentimientos')).concat(await DB.all('eliminados'));
      const a = todos.find((r) => r.hash === rec.hashAnterior);
      if (a) anterior = a.numero;
    }
    const sello = $('#detalle-integridad');
    sello.className = 'sello ' + (integra ? 'ok' : 'mal');
    sello.innerHTML = integra
      ? `<strong>✓ Documento íntegro</strong><span>Registro nº ${rec.numero} · firmado el ${fechaHora(new Date(rec.creado))}</span>`
      : `<strong>⚠ Integridad no verificada</strong><span>El contenido de este registro no coincide con su huella digital.</span>`;
    $('#doc-detalle').innerHTML = renderDocHTML(rec.documento, { rec });
    $('#evidencias').innerHTML = `<h2>Evidencias de la firma electrónica</h2><dl>${filasEvidencias(rec, integra, anterior).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    ir('detalle');
  }

  async function eliminarActual() {
    const rec = recActual;
    if (!rec) return;
    const ok = await modal({
      titulo: 'Eliminar consentimiento',
      html: `<p>Va a eliminar definitivamente el consentimiento nº <strong>${rec.numero}</strong> de <strong>${esc(nombreCompleto(rec.paciente))}</strong>. Esta acción <strong>no se puede deshacer</strong>.</p>
             <p>Solo debe hacerse si el paciente lo solicita (derecho de supresión) o por error en el registro. Se guardará únicamente una anotación anónima (número, fecha y huella) para mantener la cadena de registros.</p>
             <label class="modal-label">Escriba <strong>ELIMINAR</strong> para confirmar<input id="confirmar-eliminar" autocapitalize="characters" autocomplete="off" autocorrect="off"></label>`,
      botones: [{ texto: 'Cancelar', clase: 'sec', valor: false }, { texto: 'Eliminar', clase: 'peligro', valor: true }],
      validar: (v) => !v || $('#confirmar-eliminar').value.trim().toUpperCase() === 'ELIMINAR',
    });
    if (!ok) return;
    await DB.put('eliminados', { id: rec.id, numero: rec.numero, hash: rec.hash, creado: rec.creado, eliminado: new Date().toISOString() });
    await DB.del('consentimientos', rec.id);
    pdfArchivos.delete(rec.id);
    pdfPromesas.delete(rec.id);
    recActual = null;
    toast('Consentimiento eliminado.');
    ir('inicio');
  }

  // ------------------------------------------------------------------ PDF
  function cargarImagen(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('No se pudo cargar la imagen de la firma'));
      im.src = src;
    });
  }

  async function firmaAJpeg(png) {
    const im = await cargarImagen(png);
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, 0, 0);
    const b64 = cv.toDataURL('image/jpeg', 0.92).split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, w: cv.width, h: cv.height };
  }

  async function generarPDF(rec) {
    const doc = new MiniPDF.Doc({
      title: `Consentimiento de cesión de imagen - ${nombreCompleto(rec.paciente)}`,
      author: rec.doctor.nombre,
      subject: `Registro nº ${rec.numero} - ${rec.id}`,
    });
    const { W, H } = doc;
    const M = 56, CW = W - 2 * M, TOP = 54, BOTTOM = H - 64;
    const SZ = 9.3, LH = 12.8;
    let y = TOP;
    const nuevaPagina = () => { doc.addPage(); y = TOP; };
    const espacio = (h) => { if (y + h > BOTTOM) nuevaPagina(); };

    const parrafo = (texto, o) => {
      o = o || {};
      const font = o.font || 'F1';
      const size = o.size || SZ;
      const indent = o.indent || 0;
      const fi = o.firstIndent || 0;
      const lineas = MiniPDF.wrap(texto, font, size, CW - indent, fi);
      lineas.forEach((ln, i) => {
        espacio(LH);
        const x = M + indent + (i === 0 ? fi : 0);
        const w = CW - indent - (i === 0 ? fi : 0);
        if (i < lineas.length - 1 && o.justificar !== false) doc.textJustified(x, y + size, ln, w, { font, size });
        else doc.text(x, y + size, ln, { font, size });
        y += LH;
      });
    };

    const imgs = {};
    imgs.doctor = rec.doctor.firma ? await firmaAJpeg(rec.doctor.firma) : null;
    imgs.paciente = rec.firmas.paciente ? await firmaAJpeg(rec.firmas.paciente.png) : null;
    imgs.representante = rec.firmas.representante ? await firmaAJpeg(rec.firmas.representante.png) : null;
    const idx = {};
    for (const k of Object.keys(imgs)) if (imgs[k]) idx[k] = doc.addJpeg(imgs[k].bytes, imgs[k].w, imgs[k].h);

    for (const b of rec.documento) {
      switch (b.t) {
        case 'title':
          espacio(34);
          doc.text(W / 2, y + 14, b.x, { font: 'F2', size: 14, align: 'center' });
          y += 30;
          break;
        case 'h':
          espacio(LH + 22);
          y += 6;
          doc.text(M, y + 10, b.x, { font: 'F2', size: 10 });
          y += 16;
          break;
        case 'p':
          parrafo(b.x, { font: b.b ? 'F2' : 'F1' });
          y += 5;
          break;
        case 'li':
          espacio(LH);
          doc.text(M + 6, y + SZ, '•', { size: SZ });
          parrafo(b.x, { indent: 16 });
          y += 2;
          break;
        case 'check': {
          espacio(LH * 2);
          const bx = M + 2, by = y + 1.2, bs = 9.5;
          doc.rect(bx, by, bs, bs, { stroke: 0, width: 0.8 });
          if (b.v) {
            doc.line(bx + 1.8, by + 5, bx + 4, by + 7.6, { width: 1.4 });
            doc.line(bx + 4, by + 7.6, bx + 8.2, by + 1.8, { width: 1.4 });
          }
          const etiqueta = b.v ? 'SÍ AUTORIZO.' : 'NO AUTORIZO.';
          doc.text(M + 18, y + SZ, etiqueta, { font: 'F2', size: SZ });
          const ew = MiniPDF.textWidth(etiqueta + ' ', 'F2', SZ);
          parrafo(b.x, { indent: 18, firstIndent: ew });
          y += 5;
          break;
        }
        case 'firmas': {
          espacio(132);
          y += 10;
          const cols = [
            { tit: rec.doctor.nombre, img: 'doctor', nom: rec.doctor.nombre },
            { tit: 'El Paciente', img: 'paciente', nom: nombreCompleto(rec.paciente), vacio: rec.representante ? '(firma el representante legal)' : '' },
          ];
          if (rec.representante) cols.push({ tit: 'El Representante Legal', img: 'representante', nom: rec.representante.nombre });
          const cw = CW / cols.length;
          cols.forEach((c, i) => {
            const cx = M + cw * i + cw / 2;
            const titulo = MiniPDF.wrap(c.tit, 'F2', 8.5, cw - 10)[0];
            doc.text(cx, y + 9, titulo, { font: 'F2', size: 8.5, align: 'center' });
            const boxW = cw - 22, boxH = 66, boxY = y + 16;
            if (idx[c.img] != null) {
              const im = imgs[c.img];
              const esc2 = Math.min(boxW / im.w, boxH / im.h);
              const iw = im.w * esc2, ih = im.h * esc2;
              doc.image(idx[c.img], cx - iw / 2, boxY + (boxH - ih) / 2, iw, ih);
            } else if (c.vacio) {
              doc.text(cx, boxY + boxH / 2 + 3, c.vacio, { font: 'F3', size: 7.5, align: 'center', color: 0.45 });
            }
            doc.line(cx - boxW / 2, boxY + boxH + 4, cx + boxW / 2, boxY + boxH + 4, { width: 0.6 });
            const fdo = MiniPDF.wrap('Fdo.: ' + c.nom, 'F1', 8, cw - 10);
            fdo.slice(0, 2).forEach((ln, j) => doc.text(cx, boxY + boxH + 15 + j * 10, ln, { size: 8, align: 'center' }));
          });
          y += 126;
          break;
        }
      }
    }

    // Hoja de evidencias
    nuevaPagina();
    doc.text(W / 2, y + 13, 'HOJA DE EVIDENCIAS DE LA FIRMA ELECTRÓNICA', { font: 'F2', size: 12.5, align: 'center' });
    y += 26;
    parrafo('Este documento ha sido firmado de forma manuscrita digitalizada en un dispositivo táctil. A continuación se recogen los datos técnicos que acompañan a la firma y permiten verificar su autenticidad e integridad.', { size: 8.8, justificar: true });
    y += 10;
    const integra = await verificarIntegridad(rec);
    let anterior = null;
    if (rec.hashAnterior) {
      const todos = (await DB.all('consentimientos')).concat(await DB.all('eliminados'));
      const a = todos.find((r) => r.hash === rec.hashAnterior);
      if (a) anterior = a.numero;
    }
    const KW = 150;
    for (const [k, v] of filasEvidencias(rec, integra, anterior)) {
      const lineasV = MiniPDF.wrap(v, 'F1', 8.5, CW - KW - 8, 0);
      const lineasK = MiniPDF.wrap(k, 'F2', 8.5, KW - 6, 0);
      const alto = Math.max(lineasV.length, lineasK.length) * 11 + 8;
      espacio(alto);
      doc.line(M, y, M + CW, y, { width: 0.4, color: 0.75 });
      lineasK.forEach((ln, i) => doc.text(M, y + 13 + i * 11, ln, { font: 'F2', size: 8.5 }));
      lineasV.forEach((ln, i) => doc.text(M + KW + 8, y + 13 + i * 11, ln, { size: 8.5 }));
      y += alto;
    }
    doc.line(M, y, M + CW, y, { width: 0.4, color: 0.75 });
    y += 14;
    parrafo('La huella SHA-256 se calcula sobre la totalidad de los datos del registro: texto íntegro del documento firmado, datos identificativos, finalidades marcadas, imágenes de las firmas y datos dinámicos de los trazos (coordenadas, tiempos y presión). Cualquier modificación posterior del registro produciría una huella distinta. Cada registro incluye además la huella del registro anterior, de modo que no es posible intercalar ni suprimir registros sin dejar constancia.', { size: 8.3 });

    // Pie de página
    const total = doc.pages.length;
    for (let i = 0; i < total; i++) {
      doc.setPage(i);
      doc.line(M, H - 46, W - M, H - 46, { width: 0.4, color: 0.7 });
      doc.text(M, H - 35, `Consentimiento de cesión de imagen · Registro nº ${rec.numero} · ${fechaHora(new Date(rec.creado))}`, { size: 7, color: 0.4 });
      doc.text(W - M, H - 35, `Página ${i + 1} de ${total}`, { size: 7, color: 0.4, align: 'right' });
      doc.text(M, H - 25, `ID ${rec.id} · SHA-256 ${rec.hash}`, { size: 6.2, color: 0.4 });
    }
    return doc.build();
  }

  function nombrePDF(rec) {
    const d = new Date(rec.creado);
    return `CI_imagen_${slug(rec.paciente.apellidos)}_${slug(rec.paciente.nombre)}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_n${rec.numero}.pdf`;
  }

  function prepararPDF(rec) {
    if (!pdfPromesas.has(rec.id)) {
      const pr = generarPDF(rec).then((bytes) => {
        const f = new File([bytes], nombrePDF(rec), { type: 'application/pdf' });
        pdfArchivos.set(rec.id, f);
        return f;
      }).catch((e) => { pdfPromesas.delete(rec.id); throw e; });
      pdfPromesas.set(rec.id, pr);
    }
    return pdfPromesas.get(rec.id);
  }

  async function compartirPDFActual(btn) {
    const rec = recActual;
    if (!rec) return;
    const listo = pdfArchivos.get(rec.id);
    if (listo) { compartirArchivo(listo); return; }
    const txt = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparando PDF…';
    try {
      const f = await prepararPDF(rec);
      compartirArchivo(f);
    } catch (e) {
      console.error(e);
      toast('No se pudo generar el PDF: ' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = txt;
    }
  }

  // ------------------------------------------------------------------ compartir / descargar
  function descargar(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Abre la hoja de compartir del sistema (iPad: Guardar en Archivos, Mail, AirDrop, Imprimir…). Devuelve true si se compartió. */
  async function compartirArchivo(file) {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        if (e && e.name === 'NotAllowedError') {
          return modal({
            titulo: 'Archivo preparado',
            html: `<p>${esc(file.name)}</p>`,
            botones: [{ texto: 'Cancelar', clase: 'sec', valor: false }, { texto: 'Compartir / guardar', clase: 'prim', valor: 'compartir' }],
          }).then(async (v) => {
            if (v !== 'compartir') return false;
            try { await navigator.share({ files: [file] }); return true; } catch (_) { descargar(file); return true; }
          });
        }
        console.warn(e);
      }
    }
    descargar(file);
    return true;
  }

  // ------------------------------------------------------------------ ajustes
  async function mostrarAjustes() {
    const f = $('#f-ajustes');
    const c = cfg || {};
    for (const k of ['nombre', 'nif', 'domicilio', 'email', 'web', 'lugar']) f.elements[k].value = c[k] || '';
    $('#err-ajustes').textContent = '';
    $$('.invalido', f).forEach((e) => e.classList.remove('invalido'));
    pads.doctor.limpiar();
    if (c.firma) {
      $('#img-firma-doctor').src = c.firma;
      $('#firma-doctor-actual').hidden = false;
      $('#firma-doctor-pad').hidden = true;
    } else {
      $('#firma-doctor-actual').hidden = true;
      $('#firma-doctor-pad').hidden = false;
      requestAnimationFrame(() => pads.doctor.ajustar());
    }
    await actualizarEstadoBackup();
    const info = $('#info-almacen');
    let txt = '';
    try {
      if (navigator.storage && navigator.storage.persisted) {
        const pers = await navigator.storage.persisted();
        txt += pers ? 'Almacenamiento persistente: activado. ' : 'Almacenamiento persistente: no concedido por el sistema (haga copias de seguridad con regularidad). ';
      }
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        txt += `Espacio usado: ${(est.usage / 1048576).toFixed(1)} MB.`;
      }
    } catch (_) { /* opcional */ }
    const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!instalada) txt += ' La app no está instalada en la pantalla de inicio: en Safari pulse Compartir › «Añadir a pantalla de inicio».';
    info.textContent = txt;
    $('#version-app').textContent = `Versión ${APP_VERSION} · Texto legal ${TEXTO_VERSION}`;
  }

  async function actualizarEstadoBackup() {
    const n = (await DB.all('consentimientos')).length;
    const ultima = await DB.get('config', 'ultimaCopia');
    $('#estado-backup').textContent = `${n} consentimiento${n === 1 ? '' : 's'} guardado${n === 1 ? '' : 's'} en este iPad. ` + (ultima ? `Última copia exportada: ${fechaHora(new Date(ultima))}.` : 'Todavía no se ha exportado ninguna copia.');
  }

  async function guardarAjustes(ev) {
    ev.preventDefault();
    const f = ev.target;
    const E = f.elements;
    const err = $('#err-ajustes');
    err.textContent = '';
    $$('.invalido', f).forEach((e) => e.classList.remove('invalido'));
    const nuevo = Object.assign({}, cfg || {});
    for (const k of ['nombre', 'nif', 'domicilio', 'email', 'web', 'lugar']) nuevo[k] = limpiar(E[k].value);
    nuevo.nif = nuevo.nif.toUpperCase();
    const faltan = ['nombre', 'nif', 'domicilio', 'email', 'lugar'].filter((k) => !nuevo[k]);
    faltan.forEach((k) => E[k].classList.add('invalido'));
    if (nuevo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo.email)) { E.email.classList.add('invalido'); faltan.push('email'); }
    const padVisible = !$('#firma-doctor-pad').hidden;
    if (padVisible) {
      if (!pads.doctor.vacia()) {
        const pr = pads.doctor.problema();
        if (pr) { err.textContent = 'Firma del doctor: ' + pr; return; }
        nuevo.firma = pads.doctor.exportar().png;
      } else if (!nuevo.firma) {
        err.textContent = 'Falta la firma del doctor.';
        return;
      }
    }
    if (faltan.length) { err.textContent = 'Complete los campos obligatorios marcados en rojo.'; return; }
    const eraCompleta = cfgCompleta();
    await DB.put('config', nuevo, 'cfg');
    cfg = nuevo;
    toast('Ajustes guardados.');
    if (!eraCompleta) ir('inicio');
    else mostrarAjustes();
  }

  const NOMBRE_JSON = 'copia_seguridad.json';

  function textoLeeme(n, ahora) {
    return '﻿' + [
      'CONSENTIMIENTOS DE CESIÓN DE IMAGEN - EXPORTACIÓN',
      `Fecha de exportación: ${fechaHora(ahora)}`,
      `Número de consentimientos: ${n}`,
      '',
      'Contenido:',
      '  PDF/                  Un PDF por cada consentimiento firmado (incluye firmas y hoja de evidencias).',
      `  ${NOMBRE_JSON}  Copia completa para restaurar los consentimientos en la app`,
      '                        (Ajustes > Importar copia). Puede importarse el ZIP entero o solo este archivo.',
      '',
      'Este archivo contiene datos personales de pacientes. Guárdelo en un lugar seguro y con acceso restringido.',
      '',
    ].join('\r\n');
  }

  async function exportarCopia(btn) {
    const txt = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparando…';
    try {
      const consentimientos = (await DB.all('consentimientos')).sort((a, b) => a.numero - b.numero);
      const eliminados = await DB.all('eliminados');
      const ahora = new Date();
      const enc = new TextEncoder();
      const archivos = [];
      for (let i = 0; i < consentimientos.length; i++) {
        btn.textContent = `Generando PDF ${i + 1} de ${consentimientos.length}…`;
        const f = await prepararPDF(consentimientos[i]);
        archivos.push({ nombre: 'PDF/' + f.name, datos: new Uint8Array(await f.arrayBuffer()) });
      }
      const datos = { app: 'consentimiento-imagen', formato: 1, exportado: ahora.toISOString(), appVersion: APP_VERSION, config: cfg, consentimientos, eliminados };
      archivos.unshift(
        { nombre: 'LEEME.txt', datos: enc.encode(textoLeeme(consentimientos.length, ahora)) },
        { nombre: NOMBRE_JSON, datos: enc.encode(JSON.stringify(datos)) }
      );
      const nombre = `consentimientos_${ahora.getFullYear()}-${p2(ahora.getMonth() + 1)}-${p2(ahora.getDate())}_${p2(ahora.getHours())}${p2(ahora.getMinutes())}.zip`;
      const file = new File(MiniZip.crear(archivos), nombre, { type: 'application/zip' });
      btn.disabled = false;
      btn.textContent = txt;
      const ok = await compartirArchivo(file);
      if (ok) {
        await DB.put('config', ahora.toISOString(), 'ultimaCopia');
        await actualizarEstadoBackup();
        toast(`Exportados ${consentimientos.length} consentimientos.`);
      }
    } catch (e) {
      console.error(e);
      toast('Error al exportar: ' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = txt;
    }
  }

  async function importarCopia(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    let datos;
    try {
      const buf = await file.arrayBuffer();
      const cab = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
      let texto;
      if (cab[0] === 0x50 && cab[1] === 0x4b) { // "PK": archivo ZIP
        const entradas = await MiniZip.leer(buf);
        const json = entradas.find((e) => e.nombre.split('/').pop() === NOMBRE_JSON)
          || entradas.find((e) => /\.json$/i.test(e.nombre) && !e.nombre.split('/').pop().startsWith('._'));
        if (!json) throw new Error(`El ZIP no contiene ${NOMBRE_JSON}.`);
        texto = new TextDecoder().decode(json.datos);
      } else {
        texto = new TextDecoder().decode(buf);
      }
      datos = JSON.parse(texto);
    } catch (e) {
      modal({ titulo: 'Archivo no válido', html: `<p>El archivo no es una copia de seguridad de esta aplicación.</p>${e && e.message && !(e instanceof SyntaxError) ? `<p class="nota">${esc(e.message)}</p>` : ''}`, botones: [{ texto: 'Aceptar', clase: 'prim', valor: true }] });
      return;
    }
    if (!datos || datos.app !== 'consentimiento-imagen' || !Array.isArray(datos.consentimientos)) {
      modal({ titulo: 'Archivo no válido', html: '<p>El archivo no es una copia de seguridad de esta aplicación.</p>', botones: [{ texto: 'Aceptar', clase: 'prim', valor: true }] });
      return;
    }
    const existentes = new Set((await DB.all('consentimientos')).map((r) => r.id));
    const eliminadosLocal = new Set((await DB.all('eliminados')).map((r) => r.id));
    let nuevos = 0, repetidos = 0, dudosos = 0, omitidos = 0;
    for (const r of datos.consentimientos) {
      if (!r || !r.id || !r.hash) continue;
      if (existentes.has(r.id)) { repetidos++; continue; }
      if (eliminadosLocal.has(r.id)) { omitidos++; continue; }
      if (!(await verificarIntegridad(r))) dudosos++;
      await DB.put('consentimientos', r);
      nuevos++;
    }
    for (const e of datos.eliminados || []) {
      if (e && e.id && !eliminadosLocal.has(e.id)) {
        await DB.put('eliminados', e);
        if (existentes.has(e.id)) await DB.del('consentimientos', e.id);
      }
    }
    let cfgMsg = '';
    if (datos.config && !cfgCompleta()) {
      cfg = datos.config;
      await DB.put('config', cfg, 'cfg');
      cfgMsg = '<li>Se han importado también los datos y la firma del doctor.</li>';
    }
    await modal({
      titulo: 'Copia importada',
      html: `<ul><li>${nuevos} consentimiento(s) añadidos.</li><li>${repetidos} ya existían en este iPad.</li>${omitidos ? `<li>${omitidos} omitidos porque fueron eliminados en este iPad.</li>` : ''}${dudosos ? `<li><strong>${dudosos} con integridad no verificada</strong> (el contenido no coincide con su huella).</li>` : ''}${cfgMsg}</ul>`,
      botones: [{ texto: 'Aceptar', clase: 'prim', valor: true }],
    });
    if (vistaActual === 'ajustes') mostrarAjustes();
    else ir('inicio');
  }

  // ------------------------------------------------------------------ modal y aviso
  function modal({ titulo, html, botones, validar }) {
    return new Promise((res) => {
      const m = $('#modal');
      $('#modal-titulo').textContent = titulo;
      $('#modal-cuerpo').innerHTML = html || '';
      const acc = $('#modal-acciones');
      acc.innerHTML = '';
      for (const b of botones) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `btn ${b.clase || 'sec'}`;
        el.textContent = b.texto;
        el.addEventListener('click', () => {
          if (validar && !validar(b.valor)) {
            const inp = $('input', m);
            if (inp) { inp.classList.add('invalido'); inp.focus(); }
            return;
          }
          m.hidden = true;
          res(b.valor);
        });
        acc.appendChild(el);
      }
      m.hidden = false;
      const inp = $('input', m);
      if (inp) setTimeout(() => inp.focus(), 50);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ------------------------------------------------------------------ arranque
  function enlazarEventos() {
    $('#btn-atras').addEventListener('click', () => {
      const def = VISTAS[vistaActual];
      if (def.atras === 'cancelar') cancelarBorrador();
      else ir('inicio');
    });
    $('#btn-ajustes').addEventListener('click', () => ir('ajustes'));
    $$('[data-ir]').forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
    $('#btn-nuevo').addEventListener('click', nuevoConsentimiento);
    $('#buscar').addEventListener('input', () => mostrarInicio());
    $('#lista').addEventListener('click', (e) => {
      const it = e.target.closest('.item');
      if (it) mostrarDetalle(it.dataset.id);
    });

    // paso 1
    const fd = $('#f-datos');
    fd.addEventListener('submit', enviarDatos);
    fd.elements.conRep.addEventListener('change', (e) => { $('#rep-campos').hidden = !e.target.checked; });
    fd.elements.repCalidad.addEventListener('change', (e) => { $('#rep-otro').hidden = e.target.value !== 'otro'; });
    fd.elements.documento.addEventListener('change', avisarPrevios);
    fd.elements.tipoDoc.addEventListener('change', avisarPrevios);
    fd.addEventListener('input', (e) => {
      e.target.classList && e.target.classList.remove('invalido');
      const p = $(`[data-error="${e.target.name}"]`, fd);
      if (p) p.textContent = '';
    });
    $$('[data-cancelar]').forEach((b) => b.addEventListener('click', cancelarBorrador));

    // paso 2
    $('#doc-lectura').addEventListener('click', (e) => {
      const b = e.target.closest('.finalidad');
      if (b) alternarFinalidad(b);
    });
    $('#chk-leido').addEventListener('change', (e) => { borrador.leido = e.target.checked; $('#err-documento').textContent = ''; });
    $('#btn-doc-atras').addEventListener('click', () => ir('datos'));
    $('#btn-a-firma').addEventListener('click', irAFirma);

    // paso 3
    $('#btn-firma-atras').addEventListener('click', () => ir('documento'));
    $('#btn-firmar').addEventListener('click', firmarYGuardar);
    $$('[data-borrar]').forEach((b) => b.addEventListener('click', () => { pads[b.dataset.borrar].limpiar(); $('#err-firma').textContent = ''; }));

    // éxito y detalle
    $('#btn-exito-pdf').addEventListener('click', (e) => compartirPDFActual(e.currentTarget));
    $('#btn-exito-ver').addEventListener('click', () => recActual && mostrarDetalle(recActual.id));
    $('#btn-exito-inicio').addEventListener('click', () => ir('inicio'));
    $('#btn-detalle-pdf').addEventListener('click', (e) => compartirPDFActual(e.currentTarget));
    $('#btn-eliminar').addEventListener('click', eliminarActual);

    // ajustes
    $('#f-ajustes').addEventListener('submit', guardarAjustes);
    $('#btn-rehacer-firma-doctor').addEventListener('click', () => {
      $('#firma-doctor-actual').hidden = true;
      $('#firma-doctor-pad').hidden = false;
      requestAnimationFrame(() => pads.doctor.ajustar());
    });
    $('#btn-exportar').addEventListener('click', (e) => exportarCopia(e.currentTarget));
    $('#input-importar').addEventListener('change', (e) => importarCopia(e.target));
  }

  async function iniciar() {
    if (!window.isSecureContext || !window.crypto || !crypto.subtle || !window.indexedDB) {
      document.body.innerHTML = '<div class="fatal"><h1>No se puede iniciar la aplicación</h1><p>La aplicación debe abrirse desde su dirección segura (https://…) en Safari o en la app instalada en la pantalla de inicio.</p></div>';
      return;
    }
    try {
      await DB.abrir();
    } catch (e) {
      document.body.innerHTML = `<div class="fatal"><h1>No se puede acceder al almacenamiento</h1><p>${esc(e && e.message)}</p><p>Compruebe que Safari no está en modo de navegación privada.</p></div>`;
      return;
    }
    cfg = (await DB.get('config', 'cfg')) || null;
    pads.paciente = new PadFirma($('#pad-paciente'));
    pads.representante = new PadFirma($('#pad-rep'));
    pads.doctor = new PadFirma($('#pad-doctor'));
    pads.paciente.onCambio = pads.representante.onCambio = () => { $('#err-firma').textContent = ''; };
    pads.doctor.onCambio = () => { $('#err-ajustes').textContent = ''; };
    enlazarEventos();
    ir('inicio');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { /* opcional */ }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }

  // Exponer funciones puras para pruebas
  window.__ci = { validarDocumento, canon, sha256, construirDocumento, generarPDF, verificarIntegridad };

  iniciar();
})();
