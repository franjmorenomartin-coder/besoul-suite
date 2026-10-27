// REFORMA-FINANZAS-CLIENTES (2026-10-27): pruebas del registro real de Finanzas, los cierres, el
// Dashboard, la gestión de entrenadores simplificada y la base de datos de clientes de la Agenda.
//   node finance-tests/run_reforma_tests.cjs [<respaldo.json>]
// Sin respaldo: pruebas sintéticas completas. Con respaldo: además, con los datos reales en memoria
// (nada se escribe en el respaldo ni en Firestore) y comparando los meses anteriores a octubre de
// 2026 con el código del commit de referencia (BASE_REF, por defecto bbf444c). No imprime datos
// personales: solo recuentos, importes agregados y trainerKeys.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const FR = require(path.join(RAIZ, 'besoul-finanzas-real.js'));
const EX = require(path.join(RAIZ, 'besoul-exportar.js'));
const BD = require(path.join(RAIZ, 'besoul-clientes-bd.js'));
const Guardado = require(path.join(RAIZ, 'besoul-finanzas-guardado.js'));
const Datos = require(path.join(RAIZ, 'besoul-datos.js'));
const { crearFirestore, FieldPath, FieldValue } = require('./firestore_falso.cjs');
const BASE_REF = process.env.BASE_REF || 'bbf444c';

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}
async function lanza(fn) { try { await fn(); return null; } catch (e) { return e.code || e.message; } }
const r2 = n => Math.round((n || 0) * 100) / 100;
const copia = x => JSON.parse(JSON.stringify(x));
const silencio = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

// ======================================================================= 1. módulo del registro real
async function pruebasModulo() {
  console.log('\n== Módulo besoul-finanzas-real.js ==');
  const fs1 = crearFirestore();
  const op = (mes, o, ctx = {}) => FR.ejecutarOperacion({ firestore: fs1, FieldValue, FieldPath, mes, op: o, ctx: { actor: 'admin@test', ...ctx } });
  const doc = mes => FR.normalizarDocMes(fs1.datos[`besoulFinanzasMeses/${mes}`] || null, mes);
  const res = (mes, legado, especiales) => FR.resumenMes({ doc: doc(mes), legado, especiales, mes });

  check('importe con formato español 2.223,32', FR.normalizarImporte('2.223,32'), 2223.32);
  check('importe 175', FR.normalizarImporte('175'), 175);
  check('octubre 2026 es registro real; septiembre no', [FR.esMesRegistroReal('2026-10'), FR.esMesRegistroReal('2026-09')], [true, false]);

  // Cobros: varios del mismo entrenador, cada uno en su mes.
  await op('2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'eu', centroId: 'inacua', fecha: '2026-10-05', importe: '200', estado: 'confirmado' } });
  await op('2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'eu', centroId: 'inacua', fecha: '2026-10-20', importe: '150,50', estado: 'confirmado' } });
  await op('2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'carmen', centroId: 'alfa_prime', fecha: '2026-10-07', importe: 300, estado: 'pendiente' } });
  await op('2026-11', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'eu', centroId: 'inacua', fecha: '2026-11-04', importe: 99, estado: 'confirmado' } });
  check('documento de octubre creado con rev 1 y luego rev 3', doc('2026-10').rev, 3);
  const oct = res('2026-10');
  check('varios cobros del mismo entrenador suman en su mes', oct.cobros.porEntrenador.eu.total, 350.5);
  check('cobro pendiente de confirmar no suma', [oct.cobros.total, oct.cobros.pendiente, oct.cobros.registrosPendientes], [350.5, 300, 1]);
  check('total por centro', oct.cobros.porCentro, { inacua: 350.5 });
  check('noviembre independiente de octubre', res('2026-11').cobros.total, 99);
  check('diciembre sin registros = 0 (no se arrastra nada)', res('2026-12').resultado, 0);

  // Duplicados.
  check('registro idéntico rechazado (doble envío)', await lanza(() => op('2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'eu', centroId: 'inacua', fecha: '2026-10-05', importe: 200, estado: 'confirmado' } })), 'registro-duplicado');
  check('registro idéntico permitido solo si se confirma', await lanza(() => op('2026-10', { tipo: 'crear', permitirDuplicado: true, coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'eu', centroId: 'inacua', fecha: '2026-10-05', importe: 200, estado: 'confirmado' } })), null);
  const idDup = FR.registros(doc('2026-10'), 'ingresosEntrenadores').filter(r => r.fecha === '2026-10-05')[1].id;
  await op('2026-10', { tipo: 'anular', coleccion: 'ingresosEntrenadores', id: idDup, motivo: 'duplicado de prueba' });
  check('anular = deja de sumar pero se conserva', [res('2026-10').cobros.total, FR.registros(doc('2026-10'), 'ingresosEntrenadores', { incluirAnulados: true }).length], [350.5, 4]);
  check('el anulado guarda quién y cuándo', (() => { const a = doc('2026-10').ingresosEntrenadores[idDup]; return [a.anulado, a.anuladoPor, !!a.anuladoEn, a.motivoAnulacion]; })(), [true, 'admin@test', true, 'duplicado de prueba']);
  check('empleado BESOUL no admite cobro manual (duplicaría su facturación)', await lanza(() => op('2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'igor', centroId: 'inacua', fecha: '2026-10-05', importe: 200 } }, { empleados: ['igor'] })), 'registro-no-valido');
  check('importe 0 o negativo rechazado', await lanza(() => op('2026-10', { tipo: 'crear', coleccion: 'gastosCentros', datos: { centroId: 'inacua', fecha: '2026-10-05', concepto: 'x', importe: -5 } })), 'registro-no-valido');

  // Edición.
  const idEu = FR.registros(doc('2026-10'), 'ingresosEntrenadores').find(r => r.fecha === '2026-10-20').id;
  await op('2026-10', { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: idEu, datos: { importe: '160' } });
  check('editar cambia solo ese registro y deja rastro', [res('2026-10').cobros.total, doc('2026-10').ingresosEntrenadores[idEu].modificadoPor], [360, 'admin@test']);
  check('editar sin cambios no escribe', await (async () => { const n = fs1.escrituras; await op('2026-10', { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: idEu, datos: { importe: 160 } }); return fs1.escrituras - n; })(), 0);
  // El centro guardado en el cobro no cambia aunque el entrenador cambie de centro: es un dato del registro.
  check('el cobro conserva su centro', doc('2026-10').ingresosEntrenadores[idEu].centroId, 'inacua');

  // Gastos de centros y generales; crearVarios sin duplicar.
  await op('2026-10', { tipo: 'crear', coleccion: 'gastosCentros', datos: { centroId: 'inacua', fecha: '2026-10-01', concepto: 'Canon pactado octubre', importe: '1.200' } });
  await op('2026-10', { tipo: 'crear', coleccion: 'gastos', datos: { categoria: 'Software', concepto: 'Licencia', tipo: 'fijo', fecha: '2026-10-02', importe: 40 } });
  const r = await op('2026-11', { tipo: 'crearVarios', coleccion: 'gastos', lista: [{ categoria: 'Software', concepto: 'Licencia', tipo: 'fijo', fecha: '2026-11-01', importe: 40 }, { categoria: 'Software', concepto: 'Licencia', tipo: 'fijo', fecha: '2026-11-01', importe: 40 }] });
  check('copiar varios no duplica dentro del mismo lote', FR.registros(doc('2026-11'), 'gastos').length, 1);
  check('crearVarios devuelve los ids creados', (r.plan.ids || []).length, 1);
  const oct2 = res('2026-10', null, { empleados: [{ key: 'igor', centroId: 'inacua', importe: 1929.99 }], actividades: [{ key: 'carmen', centroId: 'alfa_prime', importe: 45 }] });
  check('resultado real de octubre = cobros + especiales + otros − gastos', [oct2.ingresosReales, oct2.gastosReales, oct2.resultado], [r2(360 + 1929.99 + 45), 1240, r2(360 + 1929.99 + 45 - 1240)]);

  // Heredados del sistema anterior: suman una sola vez, antes y después del traspaso.
  const legado = { gastos: [{ categoria: 'Otros', concepto: 'Gasto anterior', importe: '10', fecha: '2026-10-03' }], otrosIngresos: [{ categoria: 'Otros', concepto: 'Ingreso anterior', importe: 5 }] };
  const antes = res('2026-10', legado);
  check('heredados cuentan antes del traspaso', [antes.gastosGenerales.total, antes.otrosIngresos.total, antes.gastosGenerales.heredados], [50, 5, 1]);
  check('no se puede revisar con heredados pendientes', await lanza(() => op('2026-10', { tipo: 'revisar' }, { legadoPendiente: FR.hayLegadoPendiente(doc('2026-10'), legado) })), 'legado-pendiente');
  await op('2026-10', { tipo: 'importarLegado', legado });
  const despues = res('2026-10', legado);
  check('tras el traspaso los totales no cambian (sin duplicar)', [despues.gastosGenerales.total, despues.otrosIngresos.total, despues.resultado], [antes.gastosGenerales.total, antes.otrosIngresos.total, antes.resultado]);
  check('el traspaso no se repite', await lanza(() => op('2026-10', { tipo: 'importarLegado', legado })), 'legado-ya-importado');
  check('los heredados quedan identificados', FR.registros(doc('2026-10'), 'gastos').filter(g => g.origen === 'heredado').map(g => g.id), ['her_gas_202610_0']);

  // Estados y cierre.
  await op('2026-10', { tipo: 'revisar' }, { legadoPendiente: false });
  check('revisado bloquea crear', await lanza(() => op('2026-10', { tipo: 'crear', coleccion: 'gastos', datos: { categoria: 'Otros', concepto: 'x', fecha: '2026-10-09', importe: 1 } })), 'mes-revisado');
  check('no se cierra sin fotografía', await lanza(() => op('2026-10', { tipo: 'cerrar' })), 'cierre-sin-fotografia');
  const especiales = { empleados: [{ key: 'igor', centroId: 'inacua', importe: 1929.99 }], actividades: [] };
  const snap = FR.construirSnapshot({ mes: '2026-10', doc: doc('2026-10'), legado, especiales, estadistica: { total: { facturacion: 12345 } }, modelo: 'registro_real' });
  await op('2026-10', { tipo: 'cerrar', snapshot: snap });
  const cerrado = doc('2026-10');
  check('cerrado guarda quién cierra y la fotografía', [cerrado.estado, cerrado.cierre.cerradoPor, cerrado.cierre.snapshot.resumen.resultado], ['cerrado', 'admin@test', snap.resumen.resultado]);
  check('la hora del cierre es la del servidor', !!(cerrado.cierre.cerradoEn && cerrado.cierre.cerradoEn.__ts), true);
  check('cerrado bloquea editar, anular y crear', [
    await lanza(() => op('2026-10', { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: idEu, datos: { importe: 1 } })),
    await lanza(() => op('2026-10', { tipo: 'anular', coleccion: 'ingresosEntrenadores', id: idEu })),
    await lanza(() => op('2026-10', { tipo: 'crear', coleccion: 'gastos', datos: { categoria: 'Otros', concepto: 'x', fecha: '2026-10-09', importe: 1 } })),
  ], ['mes-cerrado', 'mes-cerrado', 'mes-cerrado']);
  check('reabrir exige motivo', await lanza(() => op('2026-10', { tipo: 'reabrir', motivo: 'no' })), 'reapertura-sin-motivo');
  await op('2026-10', { tipo: 'reabrir', motivo: 'Corregir un cobro mal registrado' });
  const reab = doc('2026-10');
  check('reapertura registra usuario, fecha y motivo', [reab.estado, reab.ultimaReapertura.por, reab.ultimaReapertura.motivo, !!reab.ultimaReapertura.en], ['abierto', 'admin@test', 'Corregir un cobro mal registrado', true]);
  check('historial de estados completo', reab.historialEstados.map(h => `${h.de}>${h.a}`), ['abierto>revisado', 'revisado>cerrado', 'cerrado>abierto']);
  check('reabierto vuelve a admitir cambios', await lanza(() => op('2026-10', { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: idEu, datos: { importe: 170 } })), null);
  check('la fotografía anterior queda guardada al reabrir (no se borra)', !!reab.cierre.snapshot, true);
  check('volver a abierto solo desde revisado', await lanza(() => op('2026-10', { tipo: 'volverAbierto' })), 'mes-abierto');

  // Cobro de un entrenador sin centro asignado: el cierre no puede llevar claves vacías (Firestore las rechaza).
  await op('2026-12', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { trainerKey: 'nuevo', centroId: '', fecha: '2026-12-03', importe: 80, estado: 'confirmado' } });
  check('cobro sin centro: agrupado como «sin_centro»', res('2026-12').cobros.porCentro, { sin_centro: 80 });
  await op('2026-12', { tipo: 'revisar' }, { legadoPendiente: false });
  const snapDic = FR.construirSnapshot({ mes: '2026-12', doc: doc('2026-12'), legado: null, especiales: null, estadistica: { centros: { '': { x: 1 } }, n: NaN }, modelo: 'registro_real' });
  check('cerrar un mes con cobro sin centro (y claves vacías en la estadística) funciona', await lanza(() => op('2026-12', { tipo: 'cerrar', snapshot: snapDic })), null);
  check('la fotografía guardada no tiene claves vacías ni NaN', [Object.keys(doc('2026-12').cierre.snapshot.estadistica.centros), doc('2026-12').cierre.snapshot.estadistica.n], [['(vacío)'], null]);

  // Escrituras dirigidas: una edición solo toca su ruta, rev, actualizadoEn y actualizadoPor.
  const capt = [];
  const fsCapt = { collection: c => fs1.collection(c), runTransaction: fn => fs1.runTransaction(tx => fn({ get: r => tx.get(r), set: (a, b) => { capt.push({ set: Object.keys(b) }); tx.set(a, b); }, update: (a, ...args) => { capt.push({ update: args.filter((x, i) => i % 2 === 0).map(p => p.segmentos.join('.')) }); tx.update(a, ...args); } })) };
  await FR.ejecutarOperacion({ firestore: fsCapt, FieldValue, FieldPath, mes: '2026-10', op: { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: idEu, datos: { observaciones: 'nota' } }, ctx: { actor: 'admin@test' } });
  check('edición = escritura dirigida (sin reescribir el documento)', capt[0].update.sort(), ['actualizadoEn', 'actualizadoPor', `ingresosEntrenadores.${idEu}.modificadoEn`, `ingresosEntrenadores.${idEu}.modificadoPor`, `ingresosEntrenadores.${idEu}.observaciones`, 'rev'].sort());
}

// ======================================================================= 2. exportación
function leerZip(bytes) {
  const b = Buffer.from(bytes);
  const archivos = {};
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const crc = b.readUInt32LE(p + 14), tam = b.readUInt32LE(p + 18), nlen = b.readUInt16LE(p + 26), xlen = b.readUInt16LE(p + 28);
    const nombre = b.slice(p + 30, p + 30 + nlen).toString('utf8');
    const contenido = b.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + tam);
    archivos[nombre] = { texto: contenido.toString('utf8'), crcOk: EX.crc32(contenido) === crc };
    p += 30 + nlen + xlen + tam;
  }
  return archivos;
}
function pruebasExportar() {
  console.log('\n== Exportación (besoul-exportar.js) ==');
  const columnas = [{ clave: 'nombre', titulo: 'Nombre', tipo: 'texto' }, { clave: 'tel', titulo: 'Teléfono', tipo: 'texto' }, { clave: 'id', titulo: 'ID', tipo: 'texto' }, { clave: 'importe', titulo: 'Importe', tipo: 'importe' }];
  const filas = [{ nombre: '=HYPERLINK("x")', tel: '+34 600 000 000', id: '0012', importe: 1234.5 }, { nombre: 'Ana "la" <b>', tel: '', id: '7', importe: '' }];
  const csv = EX.generarCSV(filas, columnas);
  check('CSV con BOM y separador ;', [csv.charCodeAt(0), csv.split('\r\n')[0]], [0xFEFF, '"Nombre";"Teléfono";"ID";"Importe"'].map((x, i) => i === 0 ? x : x.replace(/^﻿/, '')).map((x, i) => i === 1 ? csv.split('\r\n')[0].replace(/^﻿/, '') === '"Nombre";"Teléfono";"ID";"Importe"' ? csv.split('\r\n')[0] : x : x));
  check('CSV: fórmula neutralizada, teléfono e ID como texto, importe con coma', csv.split('\r\n')[1], `"'=HYPERLINK(""x"")";"'+34 600 000 000";"0012";1234,5`);
  check('CSV: vacío sigue vacío (no 0)', csv.split('\r\n')[2], '"Ana ""la"" <b>";"";"7";""');
  const zip = leerZip(EX.generarXLSX([{ nombre: 'Clientes', filas, columnas }, { nombre: 'Clientes', filas: [], columnas }]));
  check('XLSX: estructura y CRC correctos', ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].every(n => zip[n] && zip[n].crcOk), true);
  const hoja = zip['xl/worksheets/sheet1.xml'].texto;
  check('XLSX: teléfono e ID como texto (inlineStr), importe como número', [hoja.includes('<is><t xml:space="preserve">+34 600 000 000</t></is>') || hoja.includes('<t>+34 600 000 000</t>') || hoja.includes('+34 600 000 000'), /t="inlineStr"[^>]*><is><t[^>]*>0012</.test(hoja), /<v>1234.5<\/v>/.test(hoja)], [true, true, true]);
  check('XLSX: una fórmula nunca se guarda como fórmula', hoja.includes('<f>'), false);
  check('XLSX: caracteres escapados', hoja.includes('&lt;b&gt;') && hoja.includes('&quot;la&quot;'), true);
  check('XLSX: nombres de hoja únicos', /name="Clientes".*name="Clientes \(2\)"/.test(zip['xl/workbook.xml'].texto), true);
}

// ======================================================================= 3. base de datos de clientes
function escenarioClientes() {
  const ahora = new Date(2026, 9, 27, 12, 0);
  const clientes = {
    igor: [
      { id: 'c1', tipo: 'individual', nombre: 'Cliente Uno', telefono: '600000001', email: 'uno@x.es', modalidad: 'Individual Plan', factor: 2, tipoCompra: 'Mensualidad', descuentoPct: 10, estadoCliente: 'activo', fechaAlta: '2026-01-10', reservaToken: 'SECRETO' },
      { id: 'c2', tipo: 'individual', nombre: 'Pareja Dos', telefono: '600000002', email: '', modalidad: 'Pareja', factor: 1, tipoCompra: 'Mensualidad', descuentoPct: 0, estadoCliente: 'activo' },
      { id: 'c3', tipo: 'individual', nombre: 'Baja Tres', telefono: '600000003', email: 'tres@x.es', modalidad: 'Individual Bono', factor: 10, tipoCompra: 'Bono', estadoCliente: 'baja', fechaEstado: '2026-09-30', observacionesEstado: 'Se muda' },
      { id: 'g1', tipo: 'grupo', nombre: 'Grupo Mañanas', modalidad: 'Grupo Reducido Plan', factor: 2, tipoCompra: 'Mensualidad', estadoCliente: 'activo', integrantesObj: [{ id: 'm1', nombre: 'Miembro A', telefono: '611', email: 'a@x.es' }, { id: 'm2', nombre: 'Miembro B', telefono: '612', email: 'b@x.es' }] },
      { id: 'c4', tipo: 'individual', nombre: 'Miembro A', telefono: '611', email: 'a@x.es', modalidad: 'Miembro Subordinado', vinculacion: 'g1', memberId: 'm1', descuentoPct: 20, estadoCliente: 'activo' },
      { id: 'c5', tipo: 'individual', nombre: 'Miembro B', telefono: '612', email: 'b@x.es', modalidad: 'Miembro Subordinado', vinculacion: 'g1', memberId: 'm2', estadoCliente: 'activo' },
    ],
    eu: [
      { id: 'e1', tipo: 'individual', nombre: 'Trío Cuatro', telefono: '+34 622 000 004', email: 'cuatro@x.es', modalidad: 'Trío', factor: 1, tipoCompra: 'Mensualidad', descuentoPct: 5, estadoCliente: 'activo' },
      { id: 'e2', tipo: 'individual', nombre: 'Inactivo Cinco', telefono: '600000005', email: 'cinco@x.es', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', estadoCliente: 'inactivo', fechaEstado: '2026-10-01' },
    ],
  };
  const agenda = {
    igor: {
      '2026-10-20_10:00': { id: 'c1' }, '2026-10-30_10:00': { id: 'c1' }, '2026-10-21_10:00': { id: 'c1', estadoCancelacion: 'cancelada_fuera_plazo' },
      '2026-10-22_09:00': { id: 'g1' }, '2026-11-03_09:00': { id: 'g1' },
      '2026-10-28_18:00': { id: 'lead-x', esPruebaCRM: true, leadId: 'L1', nombre: 'Lead Seis' },
    },
  };
  const pruebasCRM = { igor: { '2026-10-28_18:00': { esPruebaCRM: true, tipoCita: 'pruebaCRM', leadId: 'L1', nombre: 'Lead Seis', telefono: '633', email: 'seis@x.es', tipoPrueba: 'Valoración inicial' } } };
  const TARIFAS = { 'Individual Plan': { 1: 120, 2: 210 }, 'Individual Bono': { 10: 270 }, Pareja: { 1: 90 }, 'Trío': { 1: 70 }, 'Grupo Reducido Plan': { 2: 80 } };
  // Precio de referencia (misma fórmula que la Agenda: tarifa × personas × (1 − descuento)).
  const precio = (f, tk, grupo) => {
    const tarifa = x => (TARIFAS[x.modalidad] || {})[x.factor] ?? '';
    if (f.tipo === 'grupo') return { unitario: tarifa(f), final: 160 * 0.9 + 80 };
    if (grupo) { const b = tarifa(grupo); return { base: b, final: b * (1 - (f.descuentoPct || 0) / 100) }; }
    const mult = f.modalidad === 'Pareja' ? 2 : (f.modalidad === 'Trío' ? 3 : 1);
    const b = tarifa(f) === '' ? '' : tarifa(f) * mult;
    return { base: b, final: b === '' ? '' : b * (1 - (f.descuentoPct || 0) / 100) };
  };
  return { ahora, clientes, agenda, pruebasCRM, TARIFAS, precio, entrenadores: { igor: { nombre: 'Igor', centro: 'Inacua' }, eu: { nombre: 'Eu', centro: 'Inacua' } } };
}
function pruebasClientesBD() {
  console.log('\n== Base de datos de clientes (besoul-clientes-bd.js) ==');
  const e = escenarioClientes();
  const original = copia(e.clientes);
  const bd = BD.construir({ clientes: e.clientes, agenda: e.agenda, pruebasCRM: e.pruebasCRM, entrenadores: e.entrenadores, ahora: e.ahora, precio: e.precio, tarifas: e.TARIFAS, actividades: {} });
  const fila = id => bd.clientes.find(r => r.id === id);
  check('no modifica los datos de origen', JSON.stringify(e.clientes) === JSON.stringify(original), true);
  check('un grupo no es fila de cliente; sus integrantes sí (sin duplicar)', [bd.clientes.length, bd.clientes.some(r => r.id === 'g1'), bd.grupos.length, bd.integrantes.length], [8, false, 1, 2]);
  check('ids únicos', new Set(bd.clientes.map(r => r.trainerKey + r.id)).size, bd.clientes.length);
  check('descuento en columna propia y reflejado en el precio final', [fila('c1').precioBase, fila('c1').descuentoPct, fila('c1').descuentoImporte, fila('c1').precioFinal], [210, 10, 21, 189]);
  check('pareja: precio por persona × 2', [fila('c2').modalidad, fila('c2').precioBase, fila('c2').precioFinal, fila('c2').conDescuento], ['Pareja', 180, 180, false]);
  check('trío con descuento', [fila('e1').modalidad, fila('e1').precioBase, fila('e1').descuentoImporte, fila('e1').precioFinal], ['Trío', 210, 10.5, 199.5]);
  check('integrante: tarifa del grupo con su propio descuento', [fila('c4').modalidad, fila('c4').grupoNombre, fila('c4').grupoIntegrantes, fila('c4').precioBase, fila('c4').precioFinal], ['Grupo cerrado', 'Grupo Mañanas', 2, 80, 64]);
  check('frecuencia y sesiones mensuales del plan; bono sin sesiones mensuales', [fila('c1').frecuenciaSemanal, fila('c1').sesionesMensuales, fila('c3').tipoTarifa, fila('c3').sesionesMensuales], [2, 8, 'Bono', '']);
  check('baja: fecha de baja y observación administrativa', [fila('c3').estado, fila('c3').fechaBaja, fila('c3').observaciones], ['Baja definitiva', '2026-09-30', 'Se muda']);
  check('inactivo: sin fecha de baja inventada', [fila('e2').estado, fila('e2').fechaBaja], ['Inactivo temporal', '']);
  check('campos que no constan quedan vacíos, nunca 0', [fila('c2').email, fila('c2').apellidos, fila('c3').descuentoPct, fila('c2').fechaAlta], ['', '', '', '']);
  check('sesiones realizadas/pendientes/canceladas y fechas', [fila('c1').sesionesRealizadas, fila('c1').sesionesPendientes, fila('c1').sesionesCanceladas, fila('c1').ultimaSesion, fila('c1').proximaSesion], [1, 1, 1, '2026-10-20 10:00', '2026-10-30 10:00']);
  check('integrante hereda las sesiones de su grupo', [fila('c4').sesionesRealizadas, fila('c4').sesionesPendientes], [1, 1]);
  check('prueba CRM aparece como «En prueba» y no factura', (() => { const p = bd.clientes.find(r => r.estadoClave === 'prueba'); return [p.nombreCompleto, p.precioFinal, p.sesionesPendientes]; })(), ['Lead Seis', '', 1]);
  check('nunca se exporta el token de reservas', JSON.stringify(bd).includes('SECRETO'), false);
  const filtra = f => BD.filtrar(bd.clientes, f).map(r => r.id).sort();
  check('búsqueda por nombre (sin acentos/mayúsculas)', filtra({ texto: 'trio' }), ['e1']);
  check('búsqueda por teléfono (solo dígitos)', filtra({ texto: '622 000' }), ['e1']);
  check('búsqueda por email', filtra({ texto: 'cinco@' }), ['e2']);
  check('filtros combinados: Inacua → Igor → activos → integrantes de grupo → con descuento', filtra({ centro: 'Inacua', trainerKey: 'igor', estado: 'activo', grupo: 'grupo_cerrado', conDescuento: 'si' }), ['c4']);
  check('filtro modalidad Pareja + tarifa Mensualidad', filtra({ modalidad: 'Pareja', tipoTarifa: 'Mensualidad' }), ['c2']);
  check('filtro sin descuento', filtra({ conDescuento: 'no', estado: 'activo' }), ['c2', 'c5']);
  const orden = BD.ordenar(bd.clientes, 'precioFinal', 'desc').map(r => r.precioFinal);
  check('orden numérico descendente con vacíos al final', orden, [270, 199.5, 189, 180, 120, 80, 64, '']);
  check('orden por texto ascendente', BD.ordenar(bd.clientes, 'nombreCompleto', 'asc').map(r => r.id).slice(0, 3), ['c3', 'c1', 'e2']);
  const hojas = BD.hojas(bd, BD.filtrar(bd.clientes, { trainerKey: 'eu' }), ['nombreCompleto', 'telefono', 'precioFinal']);
  check('exportación filtrada con columnas elegidas y las 4 hojas', [hojas.map(h => h.nombre), hojas[0].filas.length, hojas[0].columnas.map(c => c.clave), hojas[1].filas.length], [['Clientes', 'Grupos', 'Integrantes', 'Tarifas'], 2, ['nombreCompleto', 'telefono', 'precioFinal'], 0]);
  const zip = leerZip(EX.generarXLSX(BD.hojas(bd, bd.clientes)));
  check('Excel completo: 4 hojas válidas', [1, 2, 3, 4].every(i => zip[`xl/worksheets/sheet${i}.xml`] && zip[`xl/worksheets/sheet${i}.xml`].crcOk), true);
  check('Excel: teléfono como texto', /inlineStr"[^>]*><is><t[^>]*>\+34 622 000 004</.test(zip['xl/worksheets/sheet1.xml'].texto), true);
  return bd;
}

// ======================================================================= 4. páginas reales (finanzas, dashboard)
function scriptPrincipal(html, marca) { return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes(marca)); }
function elementoFalso() { const cl = new Set(); return { innerHTML: '', innerText: '', value: '', className: '', classList: { add: c => cl.add(c), remove: c => cl.delete(c), toggle: (c, on) => { if (on === undefined ? !cl.has(c) : on) cl.add(c); else cl.delete(c); }, contains: c => cl.has(c) }, setAttribute() {}, removeAttribute() {}, scrollIntoView() {}, focus() {}, setSelectionRange() {} }; }
function cargarFinanzas(html, { dbFinanzas, agendaData, perfiles, mes, firestore, meses = {}, conModulo = true }) {
  const principal = scriptPrincipal(html, 'function construirCalculoVivo').replace(/\r\n/g, '\n').replace(/\n    inicializar\(\);\s*$/, '\n');
  const registro = { alertas: [], confirmaciones: [], prompts: [], respuestaConfirm: true, respuestaPrompt: '', guardados: 0 };
  const elementos = {};
  const entorno = {
    document: { getElementById: id => (elementos[id] = elementos[id] || elementoFalso()), querySelectorAll: () => [], addEventListener() {}, createElement: () => elementoFalso(), body: { appendChild() {} } },
    window: { addEventListener() {} }, navigator: {},
    firebase: { apps: [], firestore: { FieldValue, FieldPath } },
    alert: t => registro.alertas.push(String(t)),
    confirm: t => { registro.confirmaciones.push(String(t)); return registro.respuestaConfirm; },
    prompt: t => { registro.prompts.push(String(t)); return registro.respuestaPrompt; },
    console: silencio, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    BesoulFinanzasReal: FR, BesoulExportar: EX, BesoulFinanzasGuardado: Guardado, BesoulDatos: Datos,
  };
  const n = Object.keys(entorno);
  const opt = f => `typeof ${f} === 'function' ? ${f} : null`;
  const cuerpo = `${principal}
    usuarioFinanzasEmail = 'admin@test';
    dbFinanzas = normalizarFinanzas(__e.dbFinanzas); agendaData = __e.agendaData; perfilesUsuarios = __e.perfiles; mesSeleccionadoFinanzas = __e.mes;
    firestore = __e.firestore; mesesFinanzas = __e.meses; estadoCargaMeses = 'listo';
    function guardarConfigFinanzas(){ __r.guardados++; return Promise.resolve({ ok:true }); }
    return {
      get db(){ return dbFinanzas; }, set mes(v){ mesSeleccionadoFinanzas = v; }, get mes(){ return mesSeleccionadoFinanzas; },
      get meses(){ return mesesFinanzas; }, set meses(v){ mesesFinanzas = v; },
      get calculo(){ return calculoActual; },
      construirCalculoVivo, construirCalculoActual: ${opt('construirCalculoActual')}, pintarTodo,
      settingsTrainerParaMes, centroTrainer, estadoMes: ${opt('estadoMes')}, mesEditable: ${opt('mesEditable')},
      analisisEmpleado: ${opt('analisisEmpleado')}, registrarGastoEmpleado: ${opt('registrarGastoEmpleado')},
      planCambioEntrenador: ${opt('planCambioEntrenador')}, gestionSet: ${opt('gestionSet')}, guardarCambioGestion: ${opt('guardarCambioGestion')},
      abrirFormRegistro: ${opt('abrirFormRegistro')}, formSet: ${opt('formSet')}, guardarFormRegistro: ${opt('guardarFormRegistro')}, anularRegistro: ${opt('anularRegistro')}, editarRegistroForm: ${opt('editarRegistroForm')},
      importarLegadoMes: ${opt('importarLegadoMes')}, marcarMesRevisado: ${opt('marcarMesRevisado')}, cerrarMesActual: ${opt('cerrarMesActual')}, reabrirMesCerrado: ${opt('reabrirMesCerrado')}, volverMesAbierto: ${opt('volverMesAbierto')},
      copiarGastosFijosMesAnterior: ${opt('copiarGastosFijosMesAnterior')}, filasRegistros: ${opt('filasRegistros')}, filtroSet: ${opt('filtroSet')},
      calcularIncentivoEmpleado: ${opt('calcularIncentivoEmpleado')}, cambiarModeloEconomico: ${opt('cambiarModeloEconomico')},
      espera(){ return typeof colaOperacionesMes === 'undefined' ? Promise.resolve() : colaOperacionesMes; },
      editarTrainer,
    };`;
  const api = new Function('__e', '__r', ...n, cuerpo)({ dbFinanzas, agendaData, perfiles, mes, firestore, meses }, registro, ...n.map(k => entorno[k]));
  return { api, registro, elementos };
}
function cargarDashboard(html, { dbFinanzas, agendaData, perfiles, meses = {} }) {
  const principal = scriptPrincipal(html, 'function construirCalculoMes');
  return new Function('__e', 'console', 'window', 'document', 'localStorage', 'BesoulFinanzasReal', 'BesoulDatos', `${principal}
    dbFinanzas = normalizarFinanzas(__e.dbFinanzas); agendaData = __e.agendaData; perfilesUsuarios = __e.perfiles; mesesFinanzas = typeof mesesFinanzas === 'undefined' ? {} : __e.meses;
    return { construirCalculoMes, obtenerMesData: typeof obtenerMesData === 'function' ? obtenerMesData : null, aplicarFiltroFinanzasMes: typeof aplicarFiltroFinanzasMes === 'function' ? aplicarFiltroFinanzasMes : null, set meses(v){ mesesFinanzas = v; } };`)(
    { dbFinanzas, agendaData, perfiles, meses }, silencio, { addEventListener() {} }, { getElementById: () => null }, { getItem: () => null, setItem() {} }, FR, Datos);
}
// Rutas (claves, nunca valores) en las que difieren dos objetos: sirve para diagnosticar sin datos personales.
function rutasDistintas(a, b, base = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [base || '(raíz)'];
  const claves = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return claves.flatMap(k => rutasDistintas(a[k], b[k], base ? `${base}.${Array.isArray(a) && a[k] && a[k].key ? a[k].key : k}` : k));
}
// Igual, pero solo en las claves que existen en la referencia: los campos añadidos por la reforma
// (modelo, actividadBesoulShare, ingresoBesoulEspecial…) no cuentan como diferencia; un valor cambiado, sí.
function rutasCambiadas(nuevo, ref, base = '') {
  if (JSON.stringify(nuevo) === JSON.stringify(ref)) return [];
  if (!nuevo || !ref || typeof nuevo !== 'object' || typeof ref !== 'object') return [base || '(raíz)'];
  return Object.keys(ref).flatMap(k => rutasCambiadas(nuevo[k], ref[k], base ? `${base}.${Array.isArray(ref) && ref[k] && ref[k].key ? ref[k].key : k}` : k));
}
function sinFecha(c) { const { generadoEn, ...resto } = c; return JSON.stringify(resto); }

// Escenario sintético mínimo de Finanzas: un autónomo con un cliente, un empleado (Igor) y Bea.
function escenarioFinanzas() {
  const perfiles = [
    { email: 'eu@x', trainerKey: 'eu', nombre: 'Eu', rol: 'pt', activo: true },
    { email: 'igor@x', trainerKey: 'igor', nombre: 'Igor', rol: 'pt', activo: true },
    { email: 'bea@x', trainerKey: 'bea', nombre: 'Bea', rol: 'admin', activo: true },
  ];
  const ficha = (id, mod, factor, extra = {}) => ({ id, tipo: 'individual', nombre: id, telefono: '1', email: 'a@b', modalidad: mod, factor, tipoCompra: 'Mensualidad', estadoCliente: 'activo', fechaAlta: '2026-01-01', ...extra });
  const agendaData = { clientes: { eu: [ficha('e1', 'Individual Plan', 2)], igor: [ficha('i1', 'Individual Plan', 3), ficha('i2', 'Pareja', 1, { descuentoPct: 10 })], bea: [ficha('b1', 'Individual Plan', 1)] }, agenda: {}, historicoClientes: {} };
  const dbFinanzas = { centros: {}, trainerSettings: { igor: { sistemaPago: 'empleado', costeEmpresaMensual: 970.9 } }, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: { '2026-10': [{ categoria: 'Software', concepto: 'Heredado', importe: 30, tipo: 'fijo' }] }, otrosIngresos: {}, historico: {} };
  return { perfiles, agendaData, dbFinanzas };
}
async function pruebasPaginas() {
  console.log('\n== Finanzas y Dashboard (código real) ==');
  const htmlF = fs.readFileSync(path.join(RAIZ, 'finanzas.html'), 'utf8');
  const htmlD = fs.readFileSync(path.join(RAIZ, 'dashboard.html'), 'utf8');
  const esc = escenarioFinanzas();
  const store = crearFirestore();
  const { api, registro } = cargarFinanzas(htmlF, { ...copia(esc), dbFinanzas: copia(esc.dbFinanzas), mes: '2026-10', firestore: store });
  const sync = () => { const m = {}; Object.keys(store.datos).forEach(r => { m[r.split('/')[1]] = copia(store.datos[r]); }); api.meses = m; api.pintarTodo(); };
  const calc = api.construirCalculoVivo('2026-10');
  const t = k => calc.trainers.find(x => x.key === k);
  check('octubre: motor sin canon (modelo registro_real)', [calc.modelo, 'canones' in calc.total, t('eu').canonCentroShare], ['registro_real', false, undefined]);
  check('Igor empleado: 100 % de su facturación es BESOUL', [t('igor').modelo, t('igor').ingresoBesoulEspecial, t('igor').facturacion], ['empleado', 300 + 162, 462]);
  check('autónomo: facturación estadística sin ingreso automático', [t('eu').modelo, t('eu').facturacion, t('eu').ingresoBesoulEspecial], ['autonomo', 210, 0]);
  check('Bea: responsable sin facturación ni ingresos', [t('bea').modelo, t('bea').facturacion, t('bea').ingresoBesoulEspecial], ['solo_gastos', 0, 0]);
  const sep = api.construirCalculoVivo('2026-09');
  check('septiembre: motor teórico anterior intacto', [sep.modelo, typeof sep.total.canones, typeof sep.total.beneficio], ['teorico_anterior', 'number', 'number']);
  api.pintarTodo();
  check('resumen real de octubre: especiales + heredado, sin cobros', [api.calculo.kpis.tipo, api.calculo.real.modelosEspeciales.ingresosEmpleados, api.calculo.real.gastosGenerales.total, api.calculo.kpis.resultado], ['real', 462, 30, 432]);
  const a = api.analisisEmpleado(t('igor'), '2026-10');
  check('Igor: rentabilidad sin canon de 200 € (antes de incentivos = facturación − coste empresa)', [a.facturacionBesoul, a.costeLaboralPrevisto, a.resultadoAntesIncentivos, 'canonAtribuido' in a], [462, 970.9, r2(462 - 970.9), false]);

  // Flujo de interfaz: registrar un cobro.
  api.abrirFormRegistro('ingresosEntrenadores');
  api.formSet('ingresosEntrenadores', 'trainerKey', 'eu');
  api.formSet('ingresosEntrenadores', 'importe', '175');
  api.formSet('ingresosEntrenadores', 'fecha', '2026-10-10');
  await api.guardarFormRegistro('ingresosEntrenadores');
  await api.espera(); sync();
  const cobros = FR.registros(FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-10'], '2026-10'), 'ingresosEntrenadores');
  check('cobro registrado desde la interfaz con centro del entrenador en ese mes', cobros.map(c => [c.trainerKey, c.centroId, c.importe, c.estado, c.trainerNombre]), [['eu', 'inacua', 175, 'confirmado', 'Eu']]);
  check('el resumen suma el cobro', api.calculo.real.cobros.total, 175);
  // Doble envío del mismo cobro: se pregunta y, si no se confirma, no se registra.
  registro.respuestaConfirm = false;
  api.abrirFormRegistro('ingresosEntrenadores'); api.formSet('ingresosEntrenadores', 'trainerKey', 'eu'); api.formSet('ingresosEntrenadores', 'importe', '175'); api.formSet('ingresosEntrenadores', 'fecha', '2026-10-10');
  await api.guardarFormRegistro('ingresosEntrenadores'); await api.espera(); sync();
  check('doble envío: no se duplica si no se confirma', FR.registros(FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-10'], '2026-10'), 'ingresosEntrenadores').length, 1);
  registro.respuestaConfirm = true;
  // Igor no puede tener cobro manual (no aparece y el módulo lo rechaza).
  api.abrirFormRegistro('ingresosEntrenadores'); api.formSet('ingresosEntrenadores', 'trainerKey', 'igor'); api.formSet('ingresosEntrenadores', 'importe', '200'); api.formSet('ingresosEntrenadores', 'fecha', '2026-10-10');
  registro.alertas.length = 0;
  await api.guardarFormRegistro('ingresosEntrenadores'); await api.espera(); sync();
  check('cobro manual de Igor rechazado (sin duplicar su facturación)', [registro.alertas.some(x => x.includes('empleado BESOUL')), api.calculo.real.cobros.total], [true, 175]);
  // Nómina de Igor: una sola vez.
  api.registrarGastoEmpleado('igor', 'nomina'); await api.espera(); sync();
  api.registrarGastoEmpleado('igor', 'nomina'); await api.espera(); sync();
  const gastos = FR.registros(FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-10'], '2026-10'), 'gastos');
  check('nómina de Igor registrada una vez en gastos generales', gastos.filter(g => g.categoria === 'Sueldos').map(g => [g.importe, g.trainerKey]), [[970.9, 'igor']]);
  const a2 = api.analisisEmpleado(api.calculo.trainers.find(x => x.key === 'igor'), '2026-10');
  check('rentabilidad de Igor con la nómina registrada', [a2.costeLaboral, a2.resultado, a2.nominaPendiente], [970.9, r2(462 - 970.9), false]);

  // Revisar con heredados pendientes: pide traspasar.
  registro.alertas.length = 0;
  api.marcarMesRevisado(); await api.espera();
  check('revisar exige traspasar heredados', registro.alertas.some(x => x.includes('traspasa los registros heredados')), true);
  const totalAntes = api.calculo.kpis.resultado;
  api.importarLegadoMes(); await api.espera(); sync();
  check('traspaso de heredados no cambia el resultado', api.calculo.kpis.resultado, totalAntes);
  api.marcarMesRevisado(); await api.espera(); sync();
  check('mes revisado', api.estadoMes('2026-10'), 'revisado');
  api.cerrarMesActual(); await api.espera(); sync();
  const resultadoCerrado = api.calculo.kpis.resultado;
  check('mes cerrado con fotografía', [api.estadoMes('2026-10'), api.calculo.snapshot ? api.calculo.snapshot.version : null], ['cerrado', 'finanzas-real-v1']);
  // Cambia la Agenda (Igor gana un cliente): la estadística evoluciona, el cierre no.
  api.db; // (sin cambios en Finanzas)
  const fichaNueva = { id: 'i3', tipo: 'individual', nombre: 'i3', telefono: '1', email: 'a@b', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', estadoCliente: 'activo' };
  const agendaMod = cargarFinanzas(htmlF, { ...copia(esc), agendaData: { ...copia(esc.agendaData), clientes: { ...copia(esc.agendaData.clientes), igor: [...copia(esc.agendaData.clientes.igor), fichaNueva] } }, dbFinanzas: copia(esc.dbFinanzas), mes: '2026-10', firestore: store, meses: copia(api.meses) }).api;
  agendaMod.pintarTodo();
  check('mes cerrado: el resultado no cambia aunque cambie la Agenda', [agendaMod.calculo.kpis.resultado, agendaMod.calculo.total.facturacion > api.calculo.total.facturacion], [resultadoCerrado, true]);
  // Cerrado: la interfaz no deja registrar ni la nómina.
  registro.alertas.length = 0;
  api.abrirFormRegistro('gastos'); api.formSet('gastos', 'concepto', 'x'); api.formSet('gastos', 'importe', '5');
  await api.guardarFormRegistro('gastos');
  check('mes cerrado: no admite registros desde la interfaz', registro.alertas.some(x => x.includes('no se pueden cambiar')), true);
  // Una versión antigua o un intento directo: el módulo lo rechaza aunque la interfaz no lo impidiera.
  check('mes cerrado: escritura directa rechazada', await lanza(() => FR.ejecutarOperacion({ firestore: store, FieldValue, FieldPath, mes: '2026-10', op: { tipo: 'crear', coleccion: 'gastos', datos: { categoria: 'Otros', concepto: 'x', fecha: '2026-10-01', importe: 5 } }, ctx: { actor: 'x' } })), 'mes-cerrado');
  // Reabrir sin motivo / con motivo.
  registro.respuestaPrompt = 'ok'; registro.alertas.length = 0;
  api.reabrirMesCerrado(); await api.espera();
  check('reabrir sin motivo suficiente no hace nada', [registro.alertas.some(x => x.includes('al menos 5')), api.estadoMes('2026-10')], [true, 'cerrado']);
  registro.respuestaPrompt = 'Falta un cobro de octubre';
  api.reabrirMesCerrado(); await api.espera(); sync();
  check('reabierto con motivo', [api.estadoMes('2026-10'), FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-10']).ultimaReapertura.motivo], ['abierto', 'Falta un cobro de octubre']);

  // Copiar gastos fijos a noviembre (manual, sin duplicar).
  api.mes = '2026-11'; api.pintarTodo();
  api.copiarGastosFijosMesAnterior(); await api.espera(); sync();
  api.copiarGastosFijosMesAnterior(); await api.espera(); sync();
  const nov = FR.registros(FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-11'], '2026-11'), 'gastos');
  check('gastos fijos copiados a noviembre una sola vez', nov.map(g => [g.concepto.split(' ·')[0], g.importe]).sort(), [['Heredado', 30], ['Nómina coste empresa', 970.9]].sort());
  check('octubre no cambia al copiar', FR.registros(FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-10'], '2026-10'), 'gastos').length, 2);

  // Gestión de entrenadores simplificada.
  api.mes = '2026-10';
  check('gestión: sin exención ni ajuste de canon', ['planAjusteCanon', 'previsualizarAjusteCanon', 'gestionAjusteSet'].every(f => !htmlF.includes(`function ${f}`)), true);
  const plan = api.planCambioEntrenador({ key: 'eu', accion: 'traslado', centroId: 'alfa_prime', mes: '2026-09' });
  check('gestión: no se cambian meses del modelo anterior', plan.errores.some(e => e.includes('conservan su asignación histórica')), true);
  const plan2 = api.planCambioEntrenador({ key: 'eu', accion: 'traslado', centroId: 'alfa_prime', mes: '2026-11' });
  check('gestión: traslado desde noviembre = solo cambio de centro', [plan2.errores, plan2.cambios], [[], [{ campo: 'centroId', valor: 'alfa_prime' }]]);
  const nDocs = Object.keys(store.datos).length, nEscr = store.escrituras;
  api.gestionSet('key', 'eu'); api.gestionSet('accion', 'traslado'); api.gestionSet('centroId', 'alfa_prime'); api.gestionSet('mes', '2026-11');
  await api.guardarCambioGestion();
  check('traslado guardado en la configuración sin generar ingresos ni gastos', [api.centroTrainer('eu', esc.perfiles[0], '2026-11'), api.centroTrainer('eu', esc.perfiles[0], '2026-10'), Object.keys(store.datos).length - nDocs, store.escrituras - nEscr], ['alfa_prime', 'inacua', 0, 0]);
  registro.alertas.length = 0;
  api.mes = '2026-09';
  await api.editarTrainer('eu', 'sistemaPago', 'rango2');
  check('configuración de un mes anterior no editable (no recalcula meses pasados)', [registro.alertas.some(x => x.includes('modelo anterior')), api.settingsTrainerParaMes('eu', '2026-09').sistemaPago], [true, undefined]);

  // Dashboard: mismo motor y mismas cifras.
  const dash = cargarDashboard(htmlD, { ...copia(esc), dbFinanzas: copia(api.db), meses: copia(api.meses) });
  const fin2 = cargarFinanzas(htmlF, { ...copia(esc), dbFinanzas: copia(api.db), mes: '2026-10', firestore: store, meses: copia(api.meses) }).api;
  ['2026-09', '2026-10', '2026-11'].forEach(m => {
    const df = dash.construirCalculoMes(m), ff = fin2.construirCalculoVivo(m);
    check(`Dashboard = Finanzas (estadística) ${m}`, JSON.stringify([df.modelo, r2(df.total.facturacion), df.trainers.map(x => [x.key, r2(x.facturacion), r2(x.ingresoBesoulEspecial || 0), r2(x.bsBruto || 0)])]), JSON.stringify([ff.modelo, r2(ff.total.facturacion), ff.trainers.map(x => [x.key, r2(x.facturacion), r2(x.ingresoBesoulEspecial || 0), r2(x.bsBruto || 0)])]));
    fin2.mes = m; fin2.pintarTodo();
    const dm = dash.aplicarFiltroFinanzasMes(dash.obtenerMesData(m), '', '');
    check(`Dashboard = Finanzas (ingresos, gastos, resultado) ${m}`, [dm.tipo, r2(dm.ingresos), r2(dm.gastos), r2(dm.resultado)], [fin2.calculo.kpis.tipo, r2(fin2.calculo.kpis.ingresos), r2(fin2.calculo.kpis.gastos), r2(fin2.calculo.kpis.resultado)]);
  });
  const dmIgor = dash.aplicarFiltroFinanzasMes(dash.obtenerMesData('2026-10'), '', 'igor');
  check('Dashboard filtrado por Igor: ingresos = su facturación BESOUL', dmIgor.ingresos, 462);
  // Dashboard respeta el mes cerrado (fotografía) aunque cambie la Agenda.
  const mesesCerr = copia(api.meses);
  const snapOct = FR.construirSnapshot({ mes: '2026-10', doc: FR.normalizarDocMes(mesesCerr['2026-10'], '2026-10'), legado: { gastos: [], otrosIngresos: [] }, especiales: { empleados: [{ key: 'igor', centroId: 'inacua', importe: 462 }], actividades: [] }, estadistica: {}, modelo: 'registro_real' });
  mesesCerr['2026-10'] = { ...mesesCerr['2026-10'], estado: 'cerrado', cierre: { cerradoPor: 'admin@test', cerradoEnISO: '2026-10-31', snapshot: snapOct } };
  const dash2 = cargarDashboard(htmlD, { ...copia(esc), agendaData: { ...copia(esc.agendaData), clientes: { ...copia(esc.agendaData.clientes), igor: [] } }, dbFinanzas: copia(api.db), meses: mesesCerr });
  const dc = dash2.aplicarFiltroFinanzasMes(dash2.obtenerMesData('2026-10'), '', '');
  check('Dashboard: mes cerrado = fotografía (no recalcula aunque la Agenda cambie)', [dc.estadoMes, r2(dc.resultado)], ['cerrado', snapOct.resumen.resultado]);
  check('Dashboard: no escribe en Firestore', /\.(set|update|add|delete)\(/.test(scriptPrincipal(htmlD, 'function construirCalculoMes').replace(/classList\.(add|remove)\(/g, '')) && !/collection\([^)]*\)\.doc\([^)]*\)\.(set|update)\(/.test(htmlD), false);
}

// ======================================================================= 4b. gestión y empleado
// Lo que sigue vigente de run_gestion_entrenadores_tests.cjs y run_empleado_tests.cjs (retiradas: sus
// demás comprobaciones eran del canon, la exención y el ajuste de canon, eliminados en la reforma).
async function pruebasGestionEmpleado() {
  console.log('\n== Gestión de entrenadores y empleado (vigente de las suites anteriores) ==');
  const htmlF = fs.readFileSync(path.join(RAIZ, 'finanzas.html'), 'utf8');
  const esc = escenarioFinanzas();
  esc.perfiles.push({ email: 'nuevo@x', trainerKey: 'nuevo', nombre: 'Nuevo', rol: 'pt', activo: true });
  esc.agendaData.clientes.nuevo = [{ id: 'n1', tipo: 'individual', nombre: 'n1', telefono: '1', email: 'a@b', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', estadoCliente: 'activo', fechaAlta: '2026-01-01' }];
  const store = crearFirestore();
  const { api, registro } = cargarFinanzas(htmlF, { ...esc, mes: '2026-10', firestore: store });
  check('sin centro configurado: septiembre en Inacua (intacto), octubre «Sin centro asignado»', [api.centroTrainer('nuevo', esc.perfiles[3], '2026-09'), api.centroTrainer('nuevo', esc.perfiles[3], '2026-10')], ['inacua', 'sin_centro']);
  check('sin centro: su facturación estadística se sigue contando', r2(api.construirCalculoVivo('2026-10').trainers.find(t => t.key === 'nuevo').facturacion), 120);
  const octAntes = sinFecha(api.construirCalculoVivo('2026-10'));
  api.gestionSet('key', 'eu'); api.gestionSet('accion', 'baja'); api.gestionSet('mes', '2026-11');
  const res = await api.guardarCambioGestion();
  check('baja económica desde noviembre: se guarda tras confirmar (solo la configuración)', [res && res.ok, registro.guardados, registro.confirmaciones.length > 0, Object.keys(store.datos).length], [true, 1, true, 0]);
  check('baja no retroactiva: octubre idéntico', sinFecha(api.construirCalculoVivo('2026-10')), octAntes);
  const nov = api.construirCalculoVivo('2026-11').trainers.find(t => t.key === 'eu');
  check('noviembre: marcado de baja, su facturación estadística no se pierde y no genera ingresos', [nov && nov.bajaEconomica, nov && r2(nov.facturacion), nov && nov.ingresoBesoulEspecial], [true, 210, 0]);
  check('historial de versiones conservado', api.db.trainerSettingsVersiones.eu.map(v => [v.desde, v.estadoEconomico ?? null]), [['0000-01', null], ['2026-11', 'baja']]);
  check('una segunda baja se rechaza', api.planCambioEntrenador({ key: 'eu', accion: 'baja', mes: '2026-12' }).errores.some(e => /Ya está de baja/.test(e)), true);
  check('reactivación: un único cambio de estado económico', api.planCambioEntrenador({ key: 'eu', accion: 'reactivacion', mes: '2026-12' }).cambios, [{ campo: 'estadoEconomico', valor: 'activo' }]);
  esc.perfiles[0].activo = false;
  check('acceso retirado con gestión registrada: sigue en los meses en que estaba de alta', api.construirCalculoVivo('2026-10').trainers.some(t => t.key === 'eu'), true);
  esc.perfiles[0].activo = true;
  // Incentivos: configurables pero pendientes; nunca entran solos en el resultado.
  api.db.trainerSettings.igor.incentivoModelo = 'opcion_b';
  const inc = api.calcularIncentivoEmpleado('igor', '2026-10');
  check('incentivo Opción B = 5 € × individuales + 10 € × grupos (una vez por ficha)', inc.importe, 5 * inc.individuales.length + 10 * inc.grupos.length);
  api.pintarTodo();
  const an = api.analisisEmpleado(api.calculo.trainers.find(t => t.key === 'igor'), '2026-10');
  check('incentivo calculado pero no registrado: el resultado antes de incentivos no lo descuenta', [an.resultadoAntesIncentivos, FR.registros(FR.normalizarDocMes(store.datos['besoulFinanzasMeses/2026-10'] || null, '2026-10'), 'gastos').some(g => g.categoria === 'Incentivos')], [r2(462 - 970.9), false]);
  delete api.db.trainerSettings.igor.incentivoModelo;
  // Pasar a empleado desde octubre no cambia septiembre.
  const esc2 = escenarioFinanzas(); esc2.dbFinanzas.trainerSettings = {};
  const { api: a2 } = cargarFinanzas(htmlF, { ...esc2, mes: '2026-10', firestore: crearFirestore() });
  const sepAntes = sinFecha(a2.construirCalculoVivo('2026-09'));
  await a2.cambiarModeloEconomico('igor', 'empleado');
  check('empleado desde octubre: octubre empleado, septiembre idéntico (sin retroactividad)', [a2.construirCalculoVivo('2026-10').trainers.find(t => t.key === 'igor').modelo, sinFecha(a2.construirCalculoVivo('2026-09')) === sepAntes], ['empleado', true]);
}

// ======================================================================= 5. con el respaldo real
function cargarRespaldo(ruta) {
  // Igual que run_gestion_entrenadores_tests.cjs: la Agenda real es la estructura nueva (documentos por semana/cliente).
  const b = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const E = b.estructuraNueva, lista = [];
  [['semanas', 'besoulAgendaSemanas'], ['clientes', 'besoulClientes'], ['trainers', 'besoulTrainers'], ['historico', 'besoulHistoricoClientes'], ['notas', 'besoulNotas']]
    .forEach(([col, n]) => (E[n] || []).forEach(d => lista.push({ col, id: d.id, data: d.data })));
  const MAPAS = { centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {} };
  return { dbFinanzas: { ...MAPAS, ...copia(b.besoulSuite.finanzas) }, agendaData: Datos.legadoDesdeDocs(Datos.agrupar(lista)), perfiles: (b.besoulUsers || []).map(u => ({ ...u.data, email: u.id })) };
}
function codigoEnRef(archivo) { return execFileSync('git', ['show', `${BASE_REF}:${archivo}`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
async function pruebasRespaldo(ruta) {
  console.log(`\n== Con el respaldo real (comparando con ${BASE_REF}) ==`);
  const datos = cargarRespaldo(ruta);
  const nClientes = Object.values(datos.agendaData.clientes || {}).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
  check('respaldo cargado (entrenadores y fichas)', [datos.perfiles.length > 0, nClientes > 0], [true, true]);
  const htmlF = fs.readFileSync(path.join(RAIZ, 'finanzas.html'), 'utf8');
  const htmlD = fs.readFileSync(path.join(RAIZ, 'dashboard.html'), 'utf8');
  const htmlRef = codigoEnRef('finanzas.html');
  const htmlDRef = codigoEnRef('dashboard.html');
  const store = crearFirestore();
  const nuevo = cargarFinanzas(htmlF, { ...copia(datos), mes: '2026-10', firestore: store }).api;
  const ref = cargarFinanzasRef(htmlRef, copia(datos));
  const dash = cargarDashboard(htmlD, copia(datos));
  const dashRef = cargarDashboardRef(htmlDRef, copia(datos));
  const meses = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  let iguales = 0, igualesDash = 0;
  meses.forEach(m => {
    const a = nuevo.construirCalculoVivo(m), b = ref.construirCalculoVivo(m);
    const dif = rutasCambiadas(JSON.parse(sinFecha(a)), JSON.parse(sinFecha(b)));
    if (!dif.length) iguales++; else console.log(`   diferencia en ${m}: ${dif.slice(0, 8).join(' · ')}`);
    const c = dash.construirCalculoMes(m), d = dashRef.construirCalculoMes(m);
    const difD = rutasCambiadas(JSON.parse(sinFecha(c)), JSON.parse(sinFecha(d)));
    if (!difD.length) igualesDash++; else console.log(`   diferencia Dashboard en ${m}: ${difD.slice(0, 8).join(' · ')}`);
  });
  check('enero–septiembre: Finanzas calcula exactamente igual que antes (todos los campos anteriores, histórico intacto)', iguales, meses.length);
  check('enero–septiembre: Dashboard calcula exactamente igual que antes', igualesDash, meses.length);
  const oct = nuevo.construirCalculoVivo('2026-10');
  const octRef = ref.construirCalculoVivo('2026-10');
  check('octubre: la facturación estadística no cambia con la reforma', r2(oct.total.facturacion), r2(octRef.total.facturacion));
  check('octubre: la facturación por entrenador no cambia', JSON.stringify(oct.trainers.map(t => [t.key, r2(t.facturacion)]).sort()), JSON.stringify(octRef.trainers.map(t => [t.key, r2(t.facturacion)]).sort()));
  check('octubre: sin cánones ni reparto por tramos', [oct.modelo, oct.trainers.every(t => !('canonCentroShare' in t) && !('bsBruto' in t))], ['registro_real', true]);
  const solo = oct.trainers.filter(t => ['bea', 'soraya'].includes(t.key));
  check('Bea y Soraya sin facturación ni ingresos automáticos', solo.every(t => t.facturacion === 0 && t.ingresoBesoulEspecial === 0 && t.modelo === 'solo_gastos'), true);
  const vero = oct.trainers.filter(t => t.actividadBesoulShare > 0);
  check('actividades especiales: solo la parte BESOUL es ingreso automático', vero.every(t => r2(t.ingresoBesoulEspecial) === r2(t.actividadBesoulShare)), true);
  const verRef = octRef.trainers.filter(t => vero.some(v => v.key === t.key));
  // La referencia no exponía la parte BESOUL ni la del entrenador; sí la del centro y la facturación de actividades.
  check('reparto de actividades (Verónica) idéntico al de antes', JSON.stringify(vero.map(t => [t.key, r2(t.actividadCentroShare), r2(t.facturacionActividades), r2(t.actividadBesoulShare + t.actividadCentroShare + t.actividadPtNeto)]).sort()), JSON.stringify(verRef.map(t => [t.key, r2(t.actividadCentroShare || 0), r2(t.facturacionActividades || 0), r2(t.facturacionActividades || 0)]).sort()));
  const veroSep = nuevo.construirCalculoVivo('2026-09').trainers.filter(t => vero.some(v => v.key === t.key));
  const veroSepRef = ref.construirCalculoVivo('2026-09').trainers.filter(t => vero.some(v => v.key === t.key));
  check('Verónica en septiembre (modelo anterior): reparto y parte BESOUL iguales', JSON.stringify(veroSep.map(t => [t.key, r2(t.bsBruto), r2(t.ptNeto), r2(t.actividadCentroShare)])), JSON.stringify(veroSepRef.map(t => [t.key, r2(t.bsBruto), r2(t.ptNeto), r2(t.actividadCentroShare)])));
  // Igor como empleado (configuración prevista para producción, solo en memoria).
  const conIgor = copia(datos);
  conIgor.dbFinanzas.trainerSettings = { ...(conIgor.dbFinanzas.trainerSettings || {}), igor: { ...((conIgor.dbFinanzas.trainerSettings || {}).igor || {}), sistemaPago: 'empleado', costeEmpresaMensual: 970.9 } };
  const fIgor = cargarFinanzas(htmlF, { ...conIgor, mes: '2026-10', firestore: crearFirestore() }).api;
  const cIgor = fIgor.construirCalculoVivo('2026-10');
  const igor = cIgor.trainers.find(t => t.key === 'igor');
  if (igor) {
    fIgor.pintarTodo();
    const an = fIgor.analisisEmpleado(igor, '2026-10');
    console.log(`   Igor octubre: facturación ${r2(igor.facturacion)} · ingreso BESOUL ${r2(igor.ingresoBesoulEspecial)} · antes de incentivos ${an.resultadoAntesIncentivos}`);
    check('Igor: ingreso BESOUL = su facturación (sin la parte de centro de actividades)', r2(igor.ingresoBesoulEspecial), r2(igor.facturacion - (igor.actividadCentroShare || 0)));
    check('Igor: resultado antes de incentivos = facturación − 970,90 (sin canon de 200 €)', an.resultadoAntesIncentivos, r2(igor.ingresoBesoulEspecial - 970.9));
    check('Igor: su facturación a clientes no cambia al ser empleado', r2(igor.facturacion), r2(octRef.trainers.find(t => t.key === 'igor').facturacion));
  } else check('Igor presente en octubre', false, true);
  // Andrés: fichas intactas y su facturación anterior a octubre igual.
  const andresRef = meses.map(m => (ref.construirCalculoVivo(m).trainers.find(t => /andres/.test(t.key)) || {}).facturacion || 0);
  const andresNuevo = meses.map(m => (nuevo.construirCalculoVivo(m).trainers.find(t => /andres/.test(t.key)) || {}).facturacion || 0);
  check('Andrés: facturación anterior a octubre sin cambios', JSON.stringify(andresNuevo), JSON.stringify(andresRef));
  // Octubre real con los heredados del respaldo: suman una vez y el traspaso no cambia el total.
  nuevo.pintarTodo();
  const antes = nuevo.calculo.real;
  check('octubre: los gastos heredados del sistema anterior cuentan (marcados heredado)', [antes.gastosGenerales.heredados, r2(antes.gastosGenerales.total)], [(datos.dbFinanzas.gastos?.['2026-10'] || []).length, r2((datos.dbFinanzas.gastos?.['2026-10'] || []).reduce((s, g) => s + (parseFloat(String(g.importe).replace(',', '.')) || 0), 0))]);
  check('octubre: ningún cobro inventado; ningún gasto de centro automático (ni 2.223,32 ni 23,32)', [antes.cobros.total, antes.gastosCentros.total], [0, 0]);
  // Base de datos de clientes con los datos reales y el precio calculado por el código REAL de la Agenda
  // (precioFichaBaseDatos y sus dependencias, extraídas tal cual de agenda.html).
  const ag = cargarPrecioAgenda(datos.agendaData);
  const bd = BD.construir({ clientes: datos.agendaData.clientes, agenda: datos.agendaData.agenda, pruebasCRM: datos.agendaData.pruebasCRM || {}, entrenadores: {}, ahora: new Date(2026, 9, 27), precio: ag.precio, tarifas: ag.tarifas, actividades: ag.actividades() });
  const personas = bd.clientes.filter(r => r.estadoClave !== 'prueba');
  const conTarifa = personas.filter(r => typeof r.precioFinal === 'number');
  console.log(`   Precios (respaldo): ${conTarifa.length}/${personas.length} filas con precio final; ${personas.filter(r => r.conDescuento).length} con descuento`);
  check('respaldo: precio final = precio de la Agenda (importeEfectivoCliente) en todas las fichas individuales con tarifa', personas.filter(r => !r.grupoNombre && !r.actividadId && typeof r.precioFinal === 'number').every(r => {
    const f = datos.agendaData.clientes[r.trainerKey].find(x => x.id === r.id); return r2(r.precioFinal) === r2(ag.importe(f, r.trainerKey));
  }), true);
  check('respaldo: descuento € = base − final, y sin descuento final = base', conTarifa.filter(r => typeof r.precioBase === 'number').every(r => r2(r.descuentoImporte) === r2(r.precioBase - r.precioFinal) && (r.conDescuento || r2(r.precioFinal) === r2(r.precioBase))), true);
  check('respaldo: con descuento el final nunca supera la base', conTarifa.filter(r => r.conDescuento && typeof r.precioBase === 'number').every(r => r.precioFinal <= r.precioBase), true);
  check('respaldo: sin tarifa conocida → precio vacío, nunca 0 inventado', personas.filter(r => r.precioFinal === 0 && r.precioBase === '').length, 0);
  const nPersonas = Object.values(datos.agendaData.clientes || {}).reduce((s, l) => s + (Array.isArray(l) ? l.filter(f => f && f.tipo !== 'grupo').length : 0), 0);
  check('respaldo: una fila por ficha de persona (los grupos aparte, sin duplicar)', bd.clientes.filter(r => r.estadoClave !== 'prueba').length, nPersonas);
  check('respaldo: ids únicos por entrenador', new Set(bd.clientes.map(r => r.trainerKey + '|' + r.id)).size, bd.clientes.length);
  check('respaldo: ningún token de reservas ni contrato en la exportación', /reservaToken|contratoCliente/.test(JSON.stringify(bd.clientes.map(r => Object.keys(r)))), false);
  const tokens = Object.values(datos.agendaData.clientes || {}).flat().map(f => f && f.reservaToken).filter(Boolean);
  const texto = JSON.stringify(bd);
  check('respaldo: ningún valor de token aparece en las hojas', tokens.some(tk => texto.includes(tk)), false);
  console.log(`   Base de datos (respaldo): ${bd.clientes.length} filas de clientes, ${bd.grupos.length} grupos, ${bd.integrantes.length} integrantes`);
}
// Extrae de agenda.html precioFichaBaseDatos con todas las funciones de las que depende (cierre por
// nombre) y las constantes de tarifas; las variables de estado se inicializan con los datos del respaldo.
function cargarPrecioAgenda(agendaData) {
  const html = fs.readFileSync(path.join(RAIZ, 'agenda.html'), 'utf8');
  const bloque = desde => { let i = html.indexOf('{', desde), d = 0; for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (d === 0) return html.slice(desde, i + 1); } } throw new Error('bloque sin cerrar'); };
  const defs = {};
  for (const m of html.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) if (!(m[1] in defs)) defs[m[1]] = m.index;
  const incl = new Set(), pend = ['precioFichaBaseDatos'];
  while (pend.length) {
    const n = pend.pop(); if (incl.has(n) || !(n in defs)) continue; incl.add(n);
    for (const m of bloque(defs[n]).matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) if (m[1] in defs && !incl.has(m[1])) pend.push(m[1]);
  }
  const constante = n => { const i = html.indexOf(`const ${n} =`); if (i < 0) throw new Error(`falta ${n}`); return bloque(i) + ';'; };
  const codigo = [constante('TARIFAS_2026'), constante('DEFAULT_CATALOGO_ACTIVIDADES'), ...[...incl].map(n => bloque(defs[n]))].join('\n');
  return new Function('__a', `
    let entrenadorVisto = ''; let lunesActual = new Date(2026, 9, 26);
    let dbClientes = __a.clientes || {}; let dbAgenda = __a.agenda || {};
    let dbCatalogoActividades = __a.catalogoActividades || {}; let dbTarifasActividadVersiones = __a.tarifasActividadVersiones || {};
    ${codigo}
    return { precio: precioFichaBaseDatos, tarifas: TARIFAS_2026, actividades: catalogoActividadesVivo,
      importe(f, tk){ const p = entrenadorVisto; entrenadorVisto = tk; try { return importeEfectivoCliente(f); } finally { entrenadorVisto = p; } } };`)(agendaData);
}
// Código de referencia (commit anterior): mismo cargador que en run_gestion_entrenadores_tests.cjs.
function cargarFinanzasRef(html, { dbFinanzas, agendaData, perfiles }) {
  const principal = scriptPrincipal(html, 'function construirCalculoVivo').replace(/\r\n/g, '\n').replace(/\n    inicializar\(\);\s*$/, '\n');
  return new Function('__e', 'console', 'window', 'document', 'localStorage', 'firebase', 'alert', 'confirm', 'BesoulFinanzasGuardado', 'BesoulDatos', `${principal}
    dbFinanzas = normalizarFinanzas(__e.dbFinanzas); agendaData = __e.agendaData; perfilesUsuarios = __e.perfiles; mesSeleccionadoFinanzas = '2026-10';
    return { construirCalculoVivo };`)({ dbFinanzas, agendaData, perfiles }, silencio, { addEventListener() {} }, { getElementById: () => null, querySelectorAll: () => [] }, { getItem: () => null, setItem() {} }, { apps: [] }, () => {}, () => true, Guardado, Datos);
}
function cargarDashboardRef(html, { dbFinanzas, agendaData, perfiles }) {
  const principal = scriptPrincipal(html, 'function construirCalculoMes');
  return new Function('__e', 'console', 'window', 'document', 'localStorage', 'BesoulDatos', `${principal}
    dbFinanzas = normalizarFinanzas(__e.dbFinanzas); agendaData = __e.agendaData; perfilesUsuarios = __e.perfiles;
    return { construirCalculoMes };`)({ dbFinanzas, agendaData, perfiles }, silencio, { addEventListener() {} }, { getElementById: () => null }, { getItem: () => null, setItem() {} }, Datos);
}

(async () => {
  await pruebasModulo();
  pruebasExportar();
  pruebasClientesBD();
  await pruebasPaginas();
  await pruebasGestionEmpleado();
  if (process.argv[2]) await pruebasRespaldo(process.argv[2]);
  console.log(`\n${pass} PASS · ${fail} FAIL`);
  if (fail) { console.log('\nFallos:\n' + fails.join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
