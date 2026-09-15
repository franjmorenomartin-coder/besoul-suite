const DEFAULT_CENTROS = {
      alfa_prime: { id:'alfa_prime', nombre:'Alfa Prime', orden:1, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
      // Inacua: 1.200 € fijos incluyendo hasta 6 entrenadores; del 7º al 11º son 200 €/PT; desde el 12º son 60 €/PT.
      inacua: { id:'inacua', nombre:'Inacua', orden:3, canonFijo:1200, ptsIncluidos:6, canonPt:200, canonPtReducidoDesde:12, canonPtReducido:60, reglaCanon:'inacua_2026_v1', activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
      fantasy: { id:'fantasy', nombre:'Fantasy', orden:2, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
      lagunillas: { id:'lagunillas', nombre:'Lagunillas', orden:4, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true },
      // CENTER-CATALOG-CAPUCHINOS (2026-09-15): centro nuevo, operativo desde ya (clientes/leads/
      // agenda pueden asociarse), pero SIN condiciones económicas reales todavía -- no existen en
      // ningún sitio del repo/datos/documentación, y NO se inventan ni se copian las de otro
      // centro. `economiaConfigurada:false` es el ÚNICO campo nuevo del modelo (el resto de
      // centros no lo tiene, por lo que su comportamiento no cambia -- ver economiaCentroConfigurada()
      // más abajo, que trata la ausencia de este campo como "true", igual que siempre). Mientras
      // esté así, Finanzas debe mostrar "Economía pendiente de configurar" en vez de una cifra --
      // los campos canon* quedan en 0 solo como placeholder de forma (nunca se leen como € reales
      // para este centro mientras economiaConfigurada sea false).
      capuchinos: { id:'capuchinos', nombre:'Capuchinos', orden:5, canonFijo:0, ptsIncluidos:0, canonPt:0, canonPtReducidoDesde:0, canonPtReducido:0, activo:true, visibleCRM:true, visibleAgenda:true, visibleReservas:true, visibleQR:true, economiaConfigurada:false }
    };

function economiaCentroConfigurada(centro) { return centro?.economiaConfigurada !== false; }