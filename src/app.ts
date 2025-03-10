import { makeWASocket, initAuthCreds, BufferJSON, makeCacheableSignalKeyStore, SignalDataSet, SignalDataTypeMap } from "@whiskeysockets/baileys";
import mysql from "mysql2/promise";
import pino from "pino";
import { IAppStateSyncKeyData } from "./types/baileys";

const logger = pino({ level: "trace" });

interface DatabaseConnection {
    execute: (query: string, values?: any[]) => Promise<[any, any]>;
}

const connectDB = async (): Promise<DatabaseConnection> => {
    try {
        return await mysql.createConnection({
            host: "localhost",
            port: 3306,
            user: "root",
            password: "root",
            database: "baileys",
        });
    } catch (error) {
        console.error("❌ Error conectando a MySQL:", error);
        process.exit(1);
    }
};

async function setupDatabase(db: DatabaseConnection) {
    try {
        await db.execute(`
             CREATE TABLE IF NOT EXISTS wa_sessions (
                id VARCHAR(100) PRIMARY KEY,
                creds LONGTEXT NULL,
                keys_ LONGTEXT NULL,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);
        console.log("✅ Base de datos configurada correctamente");
    } catch (error) {
        console.error("❌ Error configurando la base de datos:", error);
    }
}

async function saveCreds(db: DatabaseConnection, sessionId: string, creds: any, keyStore: any) {
    try {
        const keys = await keyStore.storage; // Obtener las claves del KeyStore

        const query = `
            INSERT INTO wa_sessions (id, creds, keys_, is_active) 
            VALUES (?, ?, ?, TRUE) 
            ON DUPLICATE KEY UPDATE 
            creds = VALUES(creds),
            keys_ = VALUES(keys_),
            is_active = TRUE;
        `;

        await db.execute(query, [
            sessionId,
            creds,
            keys ? JSON.stringify(keys, BufferJSON.replacer) : {},
        ]);

        console.log(`✅ Claves guardadas correctamente para la sesión: ${sessionId}`);
    } catch (error) {
        console.error("❌ Error guardando las credenciales:", error);
    }
}

async function getCreds(db: DatabaseConnection, sessionId: string) {
    try {
        const [rows] = await db.execute(
            `SELECT creds, keys_ FROM wa_sessions WHERE id = ? AND is_active = TRUE`,
            [sessionId]
        );

        if ((rows as any[]).length === 0) return { creds: initAuthCreds(), keys: {}, appStateSyncKeys: {} };

        const row = (rows as any[])[0];
        return {
            creds: JSON.parse(row.creds, BufferJSON.reviver),
            keys: JSON.parse(row.keys_ || "{}", BufferJSON.reviver),
        };
    } catch (error) {
        console.error("❌ Error obteniendo credenciales:", error);
        return { creds: initAuthCreds(), keys: {}, appStateSyncKeys: {} };
    }
}

async function connectToWhatsApp(sessionId: string = "default") {
    try {
        const db = await connectDB();
        await setupDatabase(db);
        const { creds, keys, appStateSyncKeys } = await getCreds(db, sessionId);

        const sock = makeWASocket({
            auth: { creds, keys } as any,
            logger,
            printQRInTerminal: true,
        });

        sock.ev.on("creds.update", async () => {

            const _keys_ = {
                keys: {
                    async get<T extends keyof SignalDataTypeMap>(
                        type: T,
                        ids
                    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {

                        let appStateSyncKeyData: IAppStateSyncKeyData = {};

                        let data: { [id: string]: SignalDataTypeMap[T] } = {};

                        if (type === "app-state-sync-key" && appStateSyncKeyData.keyData) {
                        }

                        return data;
                    }

                }
            }

            console.log("KEYS:", _keys_)

            const keysSession = await sock.authState.keys
            await saveCreds(db, sessionId, sock.authState.creds, keysSession);
        });

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "close") {
                const shouldReconnect = lastDisconnect?.error && "output" in lastDisconnect.error && (lastDisconnect.error as any).output?.statusCode !== 401;

                if (shouldReconnect) {
                    console.log("⚠️ Conexión cerrada. Intentando reconectar...");
                    setTimeout(() => connectToWhatsApp(sessionId), 5000);
                } else {
                    console.log("❌ Sesión cerrada por problema de autenticación.");
                    await db.execute("UPDATE wa_sessions SET is_active = FALSE WHERE id = ?", [sessionId]);
                }
            } else if (connection === "open") {
                console.log(`✅ Conectado exitosamente a WhatsApp con la sesión: ${sessionId}`);
            }
        });

        return sock;
    } catch (error) {
        console.error("❌ Error conectando a WhatsApp:", error);
        return null;
    }
}

async function startSession(sessionId: string = "default") {
    console.log(`🚀 Iniciando sesión de WhatsApp: ${sessionId}`);
    return await connectToWhatsApp(sessionId);
}

startSession("mi_sesion");
