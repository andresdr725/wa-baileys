// import { useMySQLAuthState } from './mysql'
// export { useMySQLAuthState }
// export default useMySQLAuthState

import { initWASocket } from "./conn";

const main = async () => {
    try {
        console.log("Iniciando conexión con WhatsApp...");
        await initWASocket();
        console.log("Proceso de conexión iniciado correctamente.");
    } catch (error) {
        console.error("❌ Error al iniciar la conexión:", error);
    }
};

main();