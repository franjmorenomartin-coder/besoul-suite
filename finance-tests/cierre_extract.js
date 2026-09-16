let dbFinanzas = { centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {} };

let mesCerradoEditando = null;

let mesSeleccionadoFinanzas = mesActualKey();

function mesActualKey(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function mesTrabajoKey(){ return mesSeleccionadoFinanzas || mesActualKey(); }

function mesEstaCerrado(key = mesTrabajoKey()){ return !!(dbFinanzas.historico && dbFinanzas.historico[key]); }

function mesEnEdicion(key = mesTrabajoKey()){ return mesCerradoEditando === key; }

function puedeEditarMes(key = mesTrabajoKey(), concepto = 'este registro'){
      if (!mesEstaCerrado(key)) return true;
      if (mesEnEdicion(key)) return true;
      alert(`El mes ${etiquetaMes(key)} está cerrado y bloqueado. Para modificar ${concepto}, pulsa primero “Reabrir edición”. Después recalcula/cierra de nuevo el mes.`);
      return false;
    }

function obtenerMesGastos(){ return mesTrabajoKey(); }

function obtenerMesIngresos(){ return mesTrabajoKey(); }

function asegurarGastosMes(){ const m=obtenerMesGastos(); if(!puedeEditarMes(m,'gastos')) return null; if(!dbFinanzas.gastos) dbFinanzas.gastos={}; if(!Array.isArray(dbFinanzas.gastos[m])) dbFinanzas.gastos[m]=[]; return dbFinanzas.gastos[m]; }

function agregarGasto(){ const lista=asegurarGastosMes(); if(!lista) return; lista.push({categoria:'Otros', concepto:'Nuevo gasto', tipo:'variable', importe:0, creadoEn:new Date().toISOString(), creadoPor:usuarioFinanzasEmail, mes:obtenerMesGastos()}); guardarConfigFinanzas(); }

function editarGasto(idx,campo,valor){ const lista=asegurarGastosMes(); if(!lista || !lista[idx]) return; lista[idx][campo]=campo==='importe'?parseNum(valor):valor; lista[idx].actualizadoEn=new Date().toISOString(); lista[idx].actualizadoPor=usuarioFinanzasEmail; guardarConfigFinanzas(); }

function borrarGasto(idx){ if(!confirm('¿Borrar este gasto?')) return; const lista=asegurarGastosMes(); if(!lista) return; lista.splice(idx,1); guardarConfigFinanzas(); }

function asegurarOtrosIngresosMes(){ const m=obtenerMesIngresos(); if(!puedeEditarMes(m,'otros ingresos')) return null; if(!dbFinanzas.otrosIngresos) dbFinanzas.otrosIngresos={}; if(!Array.isArray(dbFinanzas.otrosIngresos[m])) dbFinanzas.otrosIngresos[m]=[]; return dbFinanzas.otrosIngresos[m]; }

function agregarOtroIngreso(){ const lista=asegurarOtrosIngresosMes(); if(!lista) return; lista.push({fecha:`${obtenerMesIngresos()}-01`, categoria:'Otros', concepto:'Nuevo ingreso', importe:0, centroId:'', notas:'', creadoEn:new Date().toISOString(), creadoPor:usuarioFinanzasEmail, mes:obtenerMesIngresos()}); guardarConfigFinanzas(); }