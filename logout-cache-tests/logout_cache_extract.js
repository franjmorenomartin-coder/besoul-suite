const BS_CLAVES_SENSIBLES_EXACTAS = [
            'bs_db_clientes_v6', 'bs_db_agenda_v6', 'bs_db_credenciales_v6',
            'bs_db_disponibilidad_reservas_v6', 'bs_db_historico_clientes_v6',
            'bs_db_leads_pruebas_crm_v6', 'bs_db_notas_v6', 'bs_db_pruebas_crm_v6',
        ];

const BS_PREFIJOS_SENSIBLES = ['bs_backup_semana_'];

function limpiarCacheSensibleBesoul() {
            try {
                const claves = Object.keys(localStorage);
                claves.forEach(clave => {
                    const esSensible = BS_CLAVES_SENSIBLES_EXACTAS.includes(clave)
                        || BS_PREFIJOS_SENSIBLES.some(prefijo => clave.startsWith(prefijo));
                    if (esSensible) localStorage.removeItem(clave);
                });
            } catch (e) { /* localStorage no disponible (modo privado, etc.) -- nada que limpiar */ }
        }