const DEFAULT_CENTROS = {
  alfa_prime: { id:'alfa_prime', nombre:'Alfa Prime', orden:1, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
  fantasy: { id:'fantasy', nombre:'Fantasy', orden:2, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
  inacua: { id:'inacua', nombre:'Inacua', orden:3, canonFijo:1200, ptsIncluidos:6, canonPt:200, canonPtReducidoDesde:12, canonPtReducido:60, reglaCanon:'inacua_2026_v1', activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
  lagunillas: { id:'lagunillas', nombre:'Lagunillas', orden:4, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
  // CENTER-CATALOG-CAPUCHINOS: espejo exacto de finanzas.html -- ver ese archivo para el
  // comentario completo. economiaConfigurada:false hasta que existan condiciones económicas
  // reales; el resto de centros no lleva ese campo y su comportamiento no cambia.
  capuchinos: { id:'capuchinos', nombre:'Capuchinos', orden:5, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true, economiaConfigurada:false }
};

function economiaCentroConfigurada(centro) { return centro?.economiaConfigurada !== false; }