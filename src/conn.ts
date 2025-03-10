import { Browsers, DisconnectReason, makeWASocket, WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import { authState, session_data } from './wa';
import { Boom } from "@hapi/boom";

const logger = pino({ level: "trace" });

type Session = WASocket & {
    id?: string;
}

const sessions: Session[] = [];
// let initialQR = true;
/**
 * Obtiene una sesión de WhatsApp por su ID.
 */
export const getWbot = (whatsappId: string): Session => {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

    if (sessionIndex === -1) {
        console.log('ERR_WAPP_NOT_INITIALIZED');
        throw new Error('ERR_WAPP_NOT_INITIALIZED');
    }
    return sessions[sessionIndex];
};

/**
 * Elimina una sesión de WhatsApp.
 */
export const removeWbot = async (whatsappId: string, isLogout = true): Promise<void> => {
    try {
        const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
        if (sessionIndex !== -1) {
            if (isLogout) {
                await sessions[sessionIndex].logout();
                sessions[sessionIndex].ws.close();
            }
            sessions.splice(sessionIndex, 1);
        }
    } catch (err) {
        logger.error(err);
    }
};

/**
 * Inicializa la conexión de WhatsApp.
 */
export const initWASocket = async () => {
    try {
        const { state, saveState } = await authState();

        // Crear la sesión de WhatsApp
        const wsocket = makeWASocket({
            printQRInTerminal: true,
            browser: Browsers.appropriate("Desktop"),
            auth: state
        });

        // initialQR = false

        // Manejar eventos de conexión
        wsocket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
            logger.info(`Connection Update: ${connection || ""}`);

            if (connection === "close") {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    logger.info("Reconectando...");
                    await initWASocket(); // Reconectar
                } else {
                    logger.info("Sesión cerrada. No se reconectará.");
                    await removeWbot('mi_session', true);
                }
            }

            if (qr) {
                logger.info('Escanea el código QR para conectar:');
                console.log(qr); // Mostrar el código QR en la consola
            }

            if (connection === "open") {
                logger.info("✅ Conexión exitosa.");
                sessions.push({ ...wsocket, id: 'mi_session' }); // Guardar la sesión
                const phoneNumber = "573245639070@s.whatsapp.net"; // Reemplaza con el número de destino
                const message = "¡Hola! Este es un mensaje de prueba desde Baileys.";
                await wsocket.sendMessage(phoneNumber, { text: message });
                logger.info(`Mensaje enviado a ${phoneNumber}: ${message}`);
            }
        });

        // Guardar credenciales cuando se actualicen
        wsocket.ev.on("creds.update", saveState);

    } catch (error) {
        logger.error('Error al iniciar la sesión:', error);
    }
};