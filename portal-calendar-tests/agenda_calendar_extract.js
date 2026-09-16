function calendarioSesionesClienteParaPortal(trainerKey, clientId) {
            const hoy = new Date();
            const desdeISO = formatoFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 4, 1));
            const hastaISO = formatoFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() + 4, 1));
            const items = [];
            Object.keys(dbAgenda[trainerKey] || {}).forEach(clave => {
                const obj = dbAgenda[trainerKey][clave];
                if (!obj || obj.id !== clientId) return;
                const [fechaISO, hora] = clave.split('_');
                if (fechaISO < desdeISO || fechaISO > hastaISO) return;
                items.push({ fechaISO, hora, estadoCancelacion: obj.estadoCancelacion || '', modalidad: obj.modalidad || '' });
            });
            items.sort((a, b) => a.fechaISO.localeCompare(b.fechaISO) || a.hora.localeCompare(b.hora));
            return items;
        }

function formatoFechaLocal(fecha) {

            const y = fecha.getFullYear();

            const m = String(fecha.getMonth() + 1).padStart(2, '0');

            const d = String(fecha.getDate()).padStart(2, '0');

            return `${y}-${m}-${d}`;

        }