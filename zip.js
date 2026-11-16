/*
 * ZIP mínimo sin dependencias.
 * - crear(): genera un ZIP sin compresión (los PDF ya están compactos).
 * - leer(): lee ZIP sin compresión o con "deflate" (si el navegador tiene DecompressionStream),
 *   para aceptar también ZIP que se hayan vuelto a comprimir con otro programa.
 */
(function (global) {
  'use strict';

  const TABLA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** archivos: [{ nombre: 'carpeta/a.pdf', datos: Uint8Array }] → Array de partes para un Blob/File */
  function crear(archivos) {
    const enc = new TextEncoder();
    const d = new Date();
    const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const locales = [];
    const central = [];
    let offset = 0;
    let tamCentral = 0;

    for (const a of archivos) {
      const nb = enc.encode(a.nombre);
      const len = a.datos.length;
      const crc = crc32(a.datos);

      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true); // nombres en UTF-8
      h.setUint16(8, 0, true);      // sin compresión
      h.setUint16(10, dosT, true);
      h.setUint16(12, dosD, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, len, true);
      h.setUint32(22, len, true);
      h.setUint16(26, nb.length, true);
      h.setUint16(28, 0, true);
      locales.push(new Uint8Array(h.buffer), nb, a.datos);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, dosT, true);
      c.setUint16(14, dosD, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, len, true);
      c.setUint32(24, len, true);
      c.setUint16(28, nb.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nb);

      offset += 30 + nb.length + len;
      tamCentral += 46 + nb.length;
    }

    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, archivos.length, true);
    e.setUint16(10, archivos.length, true);
    e.setUint32(12, tamCentral, true);
    e.setUint32(16, offset, true);
    return locales.concat(central, [new Uint8Array(e.buffer)]);
  }

  async function inflar(datos) {
    if (!global.DecompressionStream) throw new Error('Este ZIP está comprimido y el navegador no puede descomprimirlo. Extraiga copia_seguridad.json e impórtelo directamente.');
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([datos]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** buf: ArrayBuffer → [{ nombre, datos: Uint8Array }] */
  async function leer(buf) {
    const v = new DataView(buf);
    let eo = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eo = i; break; }
    }
    if (eo < 0) throw new Error('El archivo ZIP no es válido.');
    const total = v.getUint16(eo + 10, true);
    let p = v.getUint32(eo + 16, true);
    const dec = new TextDecoder();
    const res = [];
    for (let n = 0; n < total; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('El archivo ZIP está dañado.');
      const metodo = v.getUint16(p + 10, true);
      const tam = v.getUint32(p + 20, true);
      const ln = v.getUint16(p + 28, true);
      const le = v.getUint16(p + 30, true);
      const lc = v.getUint16(p + 32, true);
      const loc = v.getUint32(p + 42, true);
      const nombre = dec.decode(new Uint8Array(buf, p + 46, ln));
      const ini = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
      let datos = new Uint8Array(buf, ini, tam);
      if (metodo === 8) datos = await inflar(datos);
      else if (metodo !== 0) throw new Error('Formato de compresión no compatible.');
      res.push({ nombre, datos });
      p += 46 + ln + le + lc;
    }
    return res;
  }

  global.MiniZip = { crear, leer };
})(window);
