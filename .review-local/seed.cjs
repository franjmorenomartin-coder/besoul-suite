// HOTFIX-CRM-DUPLICADOS-FECHA-ALTA -- datos FICTICIOS para la revisión local del incidente CRM.
// Escribe SOLO en el Firebase Emulator (127.0.0.1) del proyecto ficticio demo-besoul-revision,
// usando su API REST (sin dependencias). Se niega a ejecutarse contra cualquier otro destino.
// Ninguna persona real: nombres "Ficticio/a", emails @example.test, teléfonos inventados.
//
//   node .review-local/seed.cjs
'use strict';

const PROYECTO = 'demo-besoul-revision';
const FIRESTORE = 'http://127.0.0.1:8085';
const AUTH = 'http://127.0.0.1:9099';
const PASSWORD = 'RevisionLocal2026!';

if (!PROYECTO.startsWith('demo-') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(FIRESTORE) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(AUTH)) {
  console.error('REFUSED: el seed solo puede escribir en un emulador local de un proyecto demo-*.');
  process.exit(1);
}

// ---- conversión JS -> valores tipados de la API REST de Firestore ----
function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  return { mapValue: { fields: campos(v) } };
}
function campos(obj) { const f = {}; Object.keys(obj).forEach(k => { f[k] = valor(obj[k]); }); return f; }

async function pedir(url, opciones) {
  const r = await fetch(url, opciones);
  if (!r.ok) throw new Error(`${opciones.method} ${url} -> ${r.status} ${await r.text()}`);
  return r.json().catch(() => ({}));
}
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
async function escribir(ruta, datos) {
  await pedir(`${FIRESTORE}/v1/projects/${PROYECTO}/databases/(default)/documents/${ruta}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: campos(datos) }) });
}
async function crearUsuario(email) {
  await pedir(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROYECTO}/accounts`, { method: 'POST', headers: owner, body: JSON.stringify({ email, password: PASSWORD, emailVerified: true }) })
    .catch(e => { if (!/EMAIL_EXISTS/.test(e.message)) throw e; });
}

const USUARIOS = [
  { email: 'admin.revision@example.test', nombre: 'Admin Revisión (ficticio)', rol: 'admin', trainerKey: 'adminrevision' },
  { email: 'laura.revision@example.test', nombre: 'Laura Ficticia', rol: 'pt', trainerKey: 'laura' },
  { email: 'carlos.revision@example.test', nombre: 'Carlos Ficticio', rol: 'pt', trainerKey: 'carlos' },
];

function cliente(id, extra) {
  return {
    id, tipo: 'individual', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber',
    descuentoPct: 0, estadoCliente: 'activo', fechaCambioEstado: '', observacionesEstado: '',
    contratoCliente: { firmado: false, nombreArchivo: '', tipoMime: '', contenidoBase64: '', subidaEn: '' }, ...extra,
  };
}
function lead(extra) {
  return {
    estado: 'Contactado', fuente: 'Instagram', medioCaptacion: '', captadorNombre: '', objetivo: '', horarioPreferido: '',
    tipoPrueba: 'Valoración inicial', duracionPrueba: '45 min', fechaPrueba: '', motivoPerdida: '', proximaAccion: '', fechaProximaAccion: '',
    notas: '', notaEntrenadorPrueba: '', historial: [], convertido: false,
    createdByEmail: 'admin.revision@example.test', createdByName: 'Admin Revisión (ficticio)', ...extra,
  };
}

const LEADS = {
  // Septiembre normal (sin fechaAltaReal: comportamiento histórico = mes de createdAt)
  lead_septiembre: lead({ nombre: 'Lead Ficticio Septiembre', telefono: '600 100 001', email: 'lead.septiembre@example.test', centroId: 'alfa_prime', centroNombre: 'Alfa Prime', trainerKey: 'laura', trainerName: 'Laura Ficticia', createdAt: '2026-09-12T09:00:00.000Z', updatedAt: '2026-09-12T09:00:00.000Z' }),
  // Octubre normal
  lead_octubre: lead({ nombre: 'Lead Ficticio Octubre', estado: 'Nuevo lead', fuente: 'Google', telefono: '600 100 002', email: 'lead.octubre@example.test', centroId: 'fantasy', centroNombre: 'Fantasy', trainerKey: 'carlos', trainerName: 'Carlos Ficticio', createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z' }),
  // El caso de Sandra: se apuntó el 28/09, se registró y convirtió el 01/10
  lead_alta_tardia: lead({ nombre: 'Señora Ficticia Núñez', estado: 'Convertido a cliente', convertido: true, telefono: '600 100 003', email: 'senora.nunez@example.test', centroId: 'alfa_prime', centroNombre: 'Alfa Prime', trainerKey: 'laura', trainerName: 'Laura Ficticia', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:10:00.000Z', fechaAltaReal: '2026-09-28', convertedAt: '2026-10-01T08:10:00.000Z', fechaConversion: '2026-10-01', convertedTrainerKey: 'laura', convertedClientId: 'cli_crm_lead_alta_tardia', historial: [{ tipo: 'Fecha de alta real', texto: 'Registrado el 01/10/2026 con fecha de alta real 28/09/2026.', campo: 'fechaAltaReal', valorAnterior: '', valorNuevo: '2026-09-28', fecha: '2026-10-01T08:00:00.000Z', usuario: 'Admin Revisión (ficticio)', userEmail: 'admin.revision@example.test' }] }),
  // Convertido en octubre pero de la cohorte de agosto (evento vs cohorte)
  lead_agosto_convertido_octubre: lead({ nombre: 'Lead Ficticio Agosto', estado: 'Convertido a cliente', convertido: true, telefono: '600 100 004', email: 'lead.agosto@example.test', centroId: 'inacua', centroNombre: 'Inacua', trainerKey: 'carlos', trainerName: 'Carlos Ficticio', createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-10-03T10:00:00.000Z', convertedAt: '2026-10-03T10:00:00.000Z', fechaConversion: '2026-10-03', convertedTrainerKey: 'carlos', convertedClientId: 'cli_crm_lead_agosto' }),
  // Lead existente para probar el aviso al CREAR un lead con el mismo teléfono/email
  lead_existente_duplicable: lead({ nombre: 'Lead Ficticio Existente', estado: 'Prueba realizada', telefono: '+34 655 444 333', email: 'existente.ficticio@example.test', centroId: 'lagunillas', centroNombre: 'Lagunillas', trainerKey: 'laura', trainerName: 'Laura Ficticia', createdAt: '2026-09-18T11:00:00.000Z', updatedAt: '2026-09-18T11:00:00.000Z' }),
  // Lead SIN convertir cuya persona YA está en Agenda (mismo móvil en otro formato que "Rosa")
  lead_para_convertir: lead({ nombre: 'Lead Ficticio Para Convertir', estado: 'Prueba realizada', fechaPrueba: '2026-09-24T08:00:00.000Z', telefono: '+34611222333', email: 'para.convertir@example.test', centroId: 'alfa_prime', centroNombre: 'Alfa Prime', trainerKey: 'laura', trainerName: 'Laura Ficticia', createdAt: '2026-09-20T09:30:00.000Z', updatedAt: '2026-09-20T09:30:00.000Z' }),
  // Lead SIN convertir y sin coincidencias: conversión limpia
  lead_conversion_limpia: lead({ nombre: 'Lead Ficticio Conversión Limpia', estado: 'Prueba realizada', telefono: '600 100 007', email: 'conversion.limpia@example.test', centroId: 'capuchinos', centroNombre: 'Capuchinos', trainerKey: 'laura', trainerName: 'Laura Ficticia', createdAt: '2026-10-02T09:00:00.000Z', updatedAt: '2026-10-02T09:00:00.000Z' }),
};

const AGENDA = {
  clientes: {
    laura: [
      cliente('cli_rosa_ficticia', { nombre: 'Rosa Ficticia', telefono: '611 222 333', email: 'rosa.ficticia@example.test', fechaAlta: '2026-06-01' }),
      cliente('cli_crm_lead_alta_tardia', { nombre: 'Señora Ficticia Núñez', telefono: '600 100 003', email: 'senora.nunez@example.test', fechaAlta: '2026-09-28', origenCRM: true, leadId: 'lead_alta_tardia' }),
    ],
    carlos: [
      cliente('cli_tomas_ficticio', { nombre: 'Tomás Ficticio', telefono: '622 000 111', email: 'tomas.ficticio@example.test', fechaAlta: '2026-07-15' }),
      cliente('cli_crm_lead_agosto', { nombre: 'Lead Ficticio Agosto', telefono: '600 100 004', email: 'lead.agosto@example.test', fechaAlta: '2026-08-20', origenCRM: true, leadId: 'lead_agosto_convertido_octubre' }),
    ],
    adminrevision: [],
  },
  agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, historicoClientes: {}, notas: {},
};

(async () => {
  for (const u of USUARIOS) {
    await crearUsuario(u.email);
    await escribir(`besoulUsers/${u.email}`, { nombre: u.nombre, rol: u.rol, trainerKey: u.trainerKey, activo: true, email: u.email });
  }
  for (const [id, datos] of Object.entries(LEADS)) await escribir(`besoulLeads/${id}`, datos);
  await escribir('besoulSuite/agenda', AGENDA);
  console.log(`Datos ficticios cargados en el emulador (${PROYECTO}): ${USUARIOS.length} usuarios, ${Object.keys(LEADS).length} leads, ${Object.values(AGENDA.clientes).flat().length} clientes de Agenda.`);
  console.log(`Contraseña de todas las cuentas: ${PASSWORD}`);
})().catch(e => { console.error('Seed fallido:', e.message); process.exit(1); });
