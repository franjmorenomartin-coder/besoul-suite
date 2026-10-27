// BESOUL V1 — Exportación a Excel (.xlsx) y CSV sin dependencias externas (REFORMA-FINANZAS-CLIENTES,
// 2026-10-27). Lo usan Finanzas (ingresos y gastos reales) y Agenda (base de datos de clientes).
//
//  - XLSX: libro Office Open XML mínimo (un ZIP sin compresión con las hojas en XML). Todo texto va
//    como cadena en línea (t="inlineStr"): Excel nunca lo interpreta como número ni como fórmula,
//    así que un teléfono "+34 600..." o un ID "0012" se conservan tal cual. Los importes van como
//    número real, para poder sumarlos en Excel.
//  - CSV: separador ";" (Excel en español), BOM UTF-8 y comillas dobles. Un texto que empieza por
//    = + - @ tabulador o retorno se antepone con un apóstrofo (protección contra inyección de
//    fórmulas al abrir el CSV en una hoja de cálculo). Los teléfonos e IDs se exportan como texto
//    entre comillas; aun así, Excel puede reinterpretar un CSV: para conservar el formato, usar XLSX.
//
// Ninguna función modifica los datos que recibe. UMD: <script> (window.BesoulExportar) y require().
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.BesoulExportar = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Columna: { clave, titulo, tipo: 'texto' | 'numero' | 'importe' | 'fecha' }. Una fila es un objeto.
  function valorCelda(fila, col) {
    const v = typeof col.valor === 'function' ? col.valor(fila) : (fila || {})[col.clave];
    return v === undefined || v === null ? '' : v;
  }
  function esNumerica(col) { return col.tipo === 'numero' || col.tipo === 'importe'; }
  function numeroValido(v) { return typeof v === 'number' ? Number.isFinite(v) : (v !== '' && Number.isFinite(Number(v))); }

  // ---------- CSV ----------
  const PELIGROSOS = /^[=+\-@\t\r]/;
  function sanearTextoHojaCalculo(texto) {
    const s = String(texto ?? '');
    return PELIGROSOS.test(s) ? `'${s}` : s;
  }
  function celdaCSV(v, col) {
    if (esNumerica(col) && numeroValido(v)) return String(Number(v)).replace('.', ',');
    const s = sanearTextoHojaCalculo(v);
    return `"${s.replace(/"/g, '""')}"`;
  }
  function generarCSV(filas, columnas) {
    const cabecera = columnas.map(c => celdaCSV(c.titulo, { tipo: 'texto' })).join(';');
    const cuerpo = (filas || []).map(f => columnas.map(c => celdaCSV(valorCelda(f, c), c)).join(';'));
    return '﻿' + [cabecera].concat(cuerpo).join('\r\n') + '\r\n';
  }

  // ---------- XLSX ----------
  function xml(texto) {
    // Caracteres de control no permitidos en XML 1.0 (salvo \t \n \r) se eliminan.
    return String(texto ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function letraColumna(i) {
    let n = i + 1, s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function nombreHojaValido(nombre, usados) {
    let base = String(nombre || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Hoja';
    let n = base, i = 2;
    while (usados.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
    usados.add(n.toLowerCase());
    return n;
  }
  function hojaXML(filas, columnas) {
    const cols = columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, String(c.titulo || '').length + 4))}" customWidth="1"/>`).join('');
    const celdaTexto = (ref, v, estilo) => `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    const filasXML = [];
    filasXML.push(`<row r="1">${columnas.map((c, i) => celdaTexto(`${letraColumna(i)}1`, c.titulo, 1)).join('')}</row>`);
    (filas || []).forEach((f, idx) => {
      const r = idx + 2;
      const celdas = columnas.map((c, i) => {
        const ref = `${letraColumna(i)}${r}`;
        const v = valorCelda(f, c);
        if (v === '') return '';
        if (esNumerica(c) && numeroValido(v)) return `<c r="${ref}"${c.tipo === 'importe' ? ' s="2"' : ''}><v>${Number(v)}</v></c>`;
        return celdaTexto(ref, v, 0);
      }).join('');
      filasXML.push(`<row r="${r}">${celdas}</row>`);
    });
    const ultima = `${letraColumna(Math.max(0, columnas.length - 1))}${Math.max(1, (filas || []).length + 1)}`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<dimension ref="A1:${ultima}"/>`
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + `<cols>${cols}</cols><sheetData>${filasXML.join('')}</sheetData>`
      + (columnas.length ? `<autoFilter ref="A1:${ultima}"/>` : '')
      + '</worksheet>';
  }
  const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    + '</styleSheet>';

  // CRC-32 (ZIP).
  let TABLA_CRC = null;
  function crc32(bytes) {
    if (!TABLA_CRC) {
      TABLA_CRC = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TABLA_CRC[n] = c >>> 0; }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = TABLA_CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(texto) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(texto);
    return Uint8Array.from(Buffer.from(texto, 'utf8'));
  }
  // ZIP "stored" (sin compresión): suficiente para Excel/LibreOffice/Numbers y sin dependencias.
  function zip(archivos) {
    const partes = [], central = [];
    let offset = 0;
    const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF];
    const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
    archivos.forEach(({ nombre, contenido }) => {
      const nombreBytes = utf8(nombre), datos = utf8(contenido), crc = crc32(datos);
      const cabeceraLocal = Uint8Array.from([].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(datos.length), u32(datos.length), u16(nombreBytes.length), u16(0)));
      partes.push(cabeceraLocal, nombreBytes, datos);
      central.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(datos.length), u32(datos.length), u16(nombreBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nombreBytes);
      offset += cabeceraLocal.length + nombreBytes.length + datos.length;
    });
    const tamCentral = central.reduce((s, b) => s + b.length, 0);
    const fin = Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(archivos.length), u16(archivos.length), u32(tamCentral), u32(offset), u16(0)));
    const todo = partes.concat(central, [fin]);
    const salida = new Uint8Array(todo.reduce((s, b) => s + b.length, 0));
    let p = 0; todo.forEach(b => { salida.set(b, p); p += b.length; });
    return salida;
  }
  // hojas: [{ nombre, filas, columnas }]. Devuelve los bytes del .xlsx.
  function generarXLSX(hojas) {
    const usados = new Set();
    const lista = (hojas && hojas.length ? hojas : [{ nombre: 'Hoja', filas: [], columnas: [] }]).map(h => ({ ...h, nombre: nombreHojaValido(h.nombre, usados) }));
    const archivos = [
      { nombre: '[Content_Types].xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + lista.map((h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
      { nombre: '_rels/.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { nombre: 'xl/workbook.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + lista.map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { nombre: 'xl/_rels/workbook.xml.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + lista.map((h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${lista.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { nombre: 'xl/styles.xml', contenido: ESTILOS },
    ].concat(lista.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXML(h.filas, h.columnas || []) })));
    return zip(archivos);
  }

  // Descarga en el navegador (no se usa en Node).
  function descargar(nombreArchivo, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombreArchivo; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function descargarCSV(nombreArchivo, filas, columnas) { descargar(nombreArchivo, generarCSV(filas, columnas), 'text/csv;charset=utf-8'); }
  function descargarXLSX(nombreArchivo, hojas) { descargar(nombreArchivo, generarXLSX(hojas), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }

  return { sanearTextoHojaCalculo, generarCSV, generarXLSX, crc32, descargarCSV, descargarXLSX };
}));
