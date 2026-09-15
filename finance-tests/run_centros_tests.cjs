// CENTER-CATALOG-CAPUCHINOS: Capuchinos debe aparecer como centro operativo real en
// finanzas.html/dashboard.html/crm.html SIN alterar ni un valor de los centros existentes
// (Alfa Prime, Inacua, Fantasy, Lagunillas), y SIN inventar economia -- economiaConfigurada
// debe ser false para Capuchinos y "true" (por ausencia del campo) para todos los demas.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(desc, ok, detalle) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${detalle ? ' :: ' + detalle : ''}`);
}

function cargar(nombreArchivo, nombresExport) {
  const codigo = fs.readFileSync(path.join(__dirname, nombreArchivo), 'utf8');
  const fn = new Function(codigo + `\nreturn { ${nombresExport.join(', ')} };`);
  return fn();
}

// Valores EXACTOS de los centros existentes antes de Capuchinos (copiados literalmente del
// commit anterior a CENTER-CATALOG-CAPUCHINOS) -- si cualquiera cambia, esto debe fallar.
const ALFA_PRIME_ESPERADO = { id:'alfa_prime', nombre:'Alfa Prime', orden:1, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true };
const INACUA_ESPERADO = { id:'inacua', nombre:'Inacua', orden:3, canonFijo:1200, ptsIncluidos:6, canonPt:200, canonPtReducidoDesde:12, canonPtReducido:60, reglaCanon:'inacua_2026_v1', activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true };
const FANTASY_ESPERADO = { id:'fantasy', nombre:'Fantasy', orden:2, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true };
const LAGUNILLAS_ESPERADO = { id:'lagunillas', nombre:'Lagunillas', orden:4, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true };

['finanzas', 'dashboard'].forEach(origen => {
  console.log(`\n=== DEFAULT_CENTROS en ${origen}.html ===`);
  const { DEFAULT_CENTROS, economiaCentroConfigurada } = cargar(`centros_${origen}_extract.js`, ['DEFAULT_CENTROS', 'economiaCentroConfigurada']);

  check(`${origen}: Alfa Prime EXACTAMENTE igual que antes`, JSON.stringify(DEFAULT_CENTROS.alfa_prime) === JSON.stringify(ALFA_PRIME_ESPERADO));
  check(`${origen}: Inacua EXACTAMENTE igual que antes (canon real 1200/6/200/12/60)`, JSON.stringify(DEFAULT_CENTROS.inacua) === JSON.stringify(INACUA_ESPERADO));
  check(`${origen}: Fantasy EXACTAMENTE igual que antes`, JSON.stringify(DEFAULT_CENTROS.fantasy) === JSON.stringify(FANTASY_ESPERADO));
  check(`${origen}: Lagunillas EXACTAMENTE igual que antes`, JSON.stringify(DEFAULT_CENTROS.lagunillas) === JSON.stringify(LAGUNILLAS_ESPERADO));

  check(`${origen}: Capuchinos existe`, !!DEFAULT_CENTROS.capuchinos);
  check(`${origen}: Capuchinos activo y visible (operativo)`, DEFAULT_CENTROS.capuchinos.activo === true && DEFAULT_CENTROS.capuchinos.visibleCRM === true && DEFAULT_CENTROS.capuchinos.visibleAgenda === true && DEFAULT_CENTROS.capuchinos.visibleReservas === true);
  check(`${origen}: Capuchinos marcado economiaConfigurada=false`, DEFAULT_CENTROS.capuchinos.economiaConfigurada === false);
  check(`${origen}: Capuchinos NO copia canon de Inacua ni de ningun otro centro (todo a 0, no inventado)`, DEFAULT_CENTROS.capuchinos.canonFijo === 0 && DEFAULT_CENTROS.capuchinos.ptsIncluidos === 0 && DEFAULT_CENTROS.capuchinos.canonPt === 0 && !DEFAULT_CENTROS.capuchinos.reglaCanon);

  check(`${origen}: economiaCentroConfigurada(alfa_prime) = true (sin el campo, comportamiento igual que siempre)`, economiaCentroConfigurada(DEFAULT_CENTROS.alfa_prime) === true);
  check(`${origen}: economiaCentroConfigurada(inacua) = true`, economiaCentroConfigurada(DEFAULT_CENTROS.inacua) === true);
  check(`${origen}: economiaCentroConfigurada(capuchinos) = false`, economiaCentroConfigurada(DEFAULT_CENTROS.capuchinos) === false);
  check(`${origen}: economiaCentroConfigurada(undefined) no revienta -> true por defecto`, economiaCentroConfigurada(undefined) === true);
});

console.log('\n=== CENTROS_FALLBACK en crm.html ===');
{
  const { CENTROS_FALLBACK } = cargar('centros_crm_extract.js', ['CENTROS_FALLBACK']);
  check('crm: Capuchinos existe y es seleccionable para leads', !!CENTROS_FALLBACK.capuchinos && CENTROS_FALLBACK.capuchinos.activo === true && CENTROS_FALLBACK.capuchinos.visibleCRM === true);
  check('crm: resto de centros sin cambios (alfa_prime)', JSON.stringify(CENTROS_FALLBACK.alfa_prime) === JSON.stringify({ id:'alfa_prime', nombre:'Alfa Prime', orden:1, activo:true, visibleCRM:true }));
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) process.exitCode = 1;
