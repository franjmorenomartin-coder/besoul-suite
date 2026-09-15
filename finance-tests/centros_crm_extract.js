const CENTROS_FALLBACK = {
  'alfa_prime': { id:'alfa_prime', nombre:'Alfa Prime', orden:1, activo:true, visibleCRM:true },
  'fantasy': { id:'fantasy', nombre:'Fantasy', orden:2, activo:true, visibleCRM:true },
  'inacua': { id:'inacua', nombre:'Inacua', orden:3, activo:true, visibleCRM:true },
  'lagunillas': { id:'lagunillas', nombre:'Lagunillas', orden:4, activo:true, visibleCRM:true },
  // CENTER-CATALOG-CAPUCHINOS: mismo centro nuevo que en finanzas.html/dashboard.html (espejo,
  // mismo patrón ya usado para TARIFAS_2026/DEFAULT_CENTROS entre estos archivos). El CRM no
  // gestiona economía, solo necesita que exista como centro seleccionable para leads.
  'capuchinos': { id:'capuchinos', nombre:'Capuchinos', orden:5, activo:true, visibleCRM:true },
  'sin-centro': { id:'sin-centro', nombre:'Sin centro asignado', orden:999, activo:true, visibleCRM:true }
};