/*
 * Generador de PDF mínimo y sin dependencias.
 * Soporta: texto Helvetica / Helvetica-Bold / Helvetica-Oblique (WinAnsiEncoding),
 * texto justificado, líneas, rectángulos e imágenes JPEG.
 * Coordenadas en puntos con origen ARRIBA a la izquierda (se convierten internamente).
 */
(function (global) {
  'use strict';

  // Anchos AFM (1/1000 em) para ASCII 32..126
  const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
    334,260,334,584];
  const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
    389,280,389,584];
  const EXTRA_REG = { 'ª':370,'º':365,'¿':611,'¡':333,'«':556,'»':556,'°':400,'·':278,'€':556,'…':1000,'–':556,'—':1000,'“':333,'”':333,'‘':222,'’':222,'•':350,'í':278,'ì':278,'î':278,'ï':278,' ':278 };
  const EXTRA_BOLD = { 'ª':370,'º':365,'¿':611,'¡':333,'«':556,'»':556,'°':400,'·':278,'€':556,'…':1000,'–':556,'—':1000,'“':500,'”':500,'‘':278,'’':278,'•':350,'í':278,'ì':278,'î':278,'ï':278,' ':278 };
  const WINANSI_EXTRA = { '€':0x80,'‚':0x82,'…':0x85,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97 };

  const FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Helvetica-Oblique' };

  function charWidth(ch, font) {
    const bold = font === 'F2';
    const extra = bold ? EXTRA_BOLD : EXTRA_REG;
    if (extra[ch] != null) return extra[ch];
    let c = ch.charCodeAt(0);
    if (c < 32 || c > 126) {
      const base = ch.normalize('NFD')[0];
      c = base.charCodeAt(0);
      if (c < 32 || c > 126) return 556;
    }
    return (bold ? W_BOLD : W_REG)[c - 32];
  }

  function textWidth(str, font, size) {
    let w = 0;
    for (const ch of str) w += charWidth(ch, font);
    return (w * size) / 1000;
  }

  function winAnsiByte(ch) {
    const c = ch.charCodeAt(0);
    if (c < 128) return c;
    if (c >= 160 && c <= 255) return c;
    if (WINANSI_EXTRA[ch] != null) return WINANSI_EXTRA[ch];
    return 63; // '?'
  }

  // Cadena literal PDF con escapes (solo ASCII en el resultado)
  function pdfLiteral(str) {
    let out = '(';
    for (const ch of str) {
      const b = winAnsiByte(ch);
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
      else out += String.fromCharCode(b);
    }
    return out + ')';
  }

  // Cadena de texto UTF-16BE (para metadatos)
  function pdfUtf16(str) {
    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return '<' + hex + '>';
  }

  function bytesOf(s) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  /** Divide un texto en líneas que caben en maxWidth. firstIndent reduce el ancho de la primera línea. */
  function wrap(text, font, size, maxWidth, firstIndent) {
    const lines = [];
    const paragraphs = String(text).split('\n');
    for (const para of paragraphs) {
      const words = para.split(/ +/).filter((w) => w.length);
      let line = '';
      let avail = maxWidth - (lines.length === 0 ? firstIndent || 0 : 0);
      if (!words.length) { lines.push(''); continue; }
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (textWidth(test, font, size) <= avail || !line) {
          line = test;
          // palabra sola más larga que la línea: cortar por caracteres
          while (textWidth(line, font, size) > avail && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && textWidth(line.slice(0, cut), font, size) > avail) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
            avail = maxWidth;
          }
        } else {
          lines.push(line);
          line = word;
          avail = maxWidth;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  class Doc {
    constructor(opts) {
      opts = opts || {};
      this.W = 595.28; // A4
      this.H = 841.89;
      this.title = opts.title || '';
      this.author = opts.author || '';
      this.subject = opts.subject || '';
      this.pages = [];
      this.images = [];
      this.addPage();
    }

    addPage() {
      this.page = { ops: [] };
      this.pages.push(this.page);
      return this.pages.length - 1;
    }

    setPage(i) { this.page = this.pages[i]; }

    /** Texto en (x, y) donde y es la línea base medida desde arriba. */
    text(x, y, str, o) {
      o = o || {};
      const font = o.font || 'F1';
      const size = o.size || 10;
      let tx = x;
      if (o.align === 'center') tx = x - textWidth(str, font, size) / 2;
      else if (o.align === 'right') tx = x - textWidth(str, font, size);
      const color = o.color != null ? o.color : 0;
      const tw = o.wordSpacing || 0;
      this.page.ops.push(
        `BT ${n2(color)} g /${font} ${n2(size)} Tf ${n2(tw)} Tw ${n2(tx)} ${n2(this.H - y)} Td ${pdfLiteral(str)} Tj ET`
      );
    }

    /** Línea de texto justificada al ancho dado. */
    textJustified(x, y, str, width, o) {
      o = o || {};
      const font = o.font || 'F1';
      const size = o.size || 10;
      const spaces = (str.match(/ /g) || []).length;
      const natural = textWidth(str, font, size);
      let ws = 0;
      if (spaces > 0 && natural < width) ws = (width - natural) / spaces;
      if (ws > size * 0.9) ws = 0; // evita huecos exagerados
      this.text(x, y, str, Object.assign({}, o, { wordSpacing: ws }));
    }

    line(x1, y1, x2, y2, o) {
      o = o || {};
      const color = o.color != null ? o.color : 0;
      this.page.ops.push(
        `${n2(color)} G ${n2(o.width || 0.5)} w 1 J ${n2(x1)} ${n2(this.H - y1)} m ${n2(x2)} ${n2(this.H - y2)} l S`
      );
    }

    rect(x, y, w, h, o) {
      o = o || {};
      const ops = [];
      if (o.fill != null) ops.push(`${n2(o.fill)} g`);
      if (o.stroke != null) ops.push(`${n2(o.stroke)} G ${n2(o.width || 0.5)} w`);
      ops.push(`${n2(x)} ${n2(this.H - y - h)} ${n2(w)} ${n2(h)} re`);
      if (o.fill != null && o.stroke != null) ops.push('B');
      else if (o.fill != null) ops.push('f');
      else ops.push('S');
      ops.push('0 g');
      this.page.ops.push(ops.join(' '));
    }

    /** Registra una imagen JPEG y devuelve su índice. */
    addJpeg(bytes, widthPx, heightPx) {
      this.images.push({ bytes, w: widthPx, h: heightPx });
      return this.images.length - 1;
    }

    /** Dibuja la imagen idx con esquina superior izquierda (x, y) y tamaño (w, h). */
    image(idx, x, y, w, h) {
      this.page.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.H - y - h)} cm /Im${idx} Do Q`);
    }

    build() {
      const parts = [];
      let len = 0;
      const offsets = [];
      const push = (x) => {
        const b = typeof x === 'string' ? bytesOf(x) : x;
        parts.push(b);
        len += b.length;
      };
      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

      let n = 0;
      const alloc = () => ++n;
      const catalog = alloc();
      const pagesId = alloc();
      const fontIds = {};
      for (const k of Object.keys(FONTS)) fontIds[k] = alloc();
      const info = alloc();
      const imgIds = this.images.map(() => alloc());
      const pageIds = this.pages.map(() => [alloc(), alloc()]);

      const obj = (id, dict, stream) => {
        offsets[id] = len;
        push(`${id} 0 obj\n`);
        if (stream) {
          push(`${dict.slice(0, -2)}/Length ${stream.length} >>\nstream\n`);
          push(stream);
          push('\nendstream\nendobj\n');
        } else {
          push(dict + '\nendobj\n');
        }
      };

      obj(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      obj(pagesId, `<< /Type /Pages /Kids [${pageIds.map((p) => p[0] + ' 0 R').join(' ')}] /Count ${this.pages.length} >>`);
      for (const k of Object.keys(FONTS)) {
        obj(fontIds[k], `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k]} /Encoding /WinAnsiEncoding >>`);
      }
      const d = new Date();
      const p2 = (v) => String(v).padStart(2, '0');
      const pdfDate = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      obj(info, `<< /Title ${pdfUtf16(this.title)} /Author ${pdfUtf16(this.author)} /Subject ${pdfUtf16(this.subject)} /Producer ${pdfUtf16('Consentimiento de imagen (app iPad)')} /CreationDate (${pdfDate}) >>`);

      this.images.forEach((im, i) => {
        obj(imgIds[i], `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`, im.bytes);
      });

      const fontRes = Object.keys(FONTS).map((k) => `/${k} ${fontIds[k]} 0 R`).join(' ');
      const imgRes = imgIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ');
      const resources = `<< /Font << ${fontRes} >>${imgIds.length ? ` /XObject << ${imgRes} >>` : ''} >>`;

      this.pages.forEach((pg, i) => {
        const [pid, cid] = pageIds[i];
        obj(pid, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources ${resources} /Contents ${cid} 0 R >>`);
        obj(cid, '<< >>', bytesOf(pg.ops.join('\n')));
      });

      const xref = len;
      let x = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= n; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
      push(x);
      const idHex = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
      push(`trailer\n<< /Size ${n + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xref}\n%%EOF\n`);

      const out = new Uint8Array(len);
      let o = 0;
      for (const b of parts) { out.set(b, o); o += b.length; }
      return out;
    }
  }

  global.MiniPDF = { Doc, wrap, textWidth };
})(window);
