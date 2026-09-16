function payloadParaUpdateFirestoreFinanzas(payload){
      const args = [];
      Object.keys(payload).forEach(key => {
        const partes = key.split('.');
        if (partes.length > 1) args.push(new firebase.firestore.FieldPath(partes[0], partes.slice(1).join('.')), payload[key]);
        else args.push(key, payload[key]);
      });
      return args;
    }

function guardarCatalogoActividadesNube(payload){
      if (!agendaRef) return;
      // Hallazgo real (confirmado contra el código fuente del SDK de Firestore, mismo bug ya
      // corregido en agenda.html/guardarEstadoNubeAgenda): set(payload,{merge:true}) trata una
      // clave con punto DENTRO del objeto (p.ej. "trainerActividades.veronica") como un nombre
      // de campo LITERAL de nivel superior, nunca como ruta anidada -- por eso el checkbox de
      // actividades autorizadas se marcaba y se desmarcaba enseguida: el campo real
      // trainerActividades.<key> que lee actividadesAutorizadasTrainer() nunca se llegaba a
      // tocar. update() sí interpreta las claves con punto del objeto como ruta anidada real.
      // Mismo payload dirigido de siempre, solo cambia el método de escritura.
      agendaRef.update(...payloadParaUpdateFirestoreFinanzas(payload)).catch(err => { console.error(err); alert('Error guardando el catálogo de actividades. Revisa permisos/reglas.'); });
    }