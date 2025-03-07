import { makeWASocket, initAuthCreds, BufferJSON, makeCacheableSignalKeyStore, SignalDataSet } from "@whiskeysockets/baileys";
import mysql from "mysql2/promise";
import pino from "pino";

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
                noise_key LONGTEXT NOT NULL,
                signed_identity_key LONGTEXT NOT NULL,
                signed_pre_key LONGTEXT NOT NULL,
                adv_secret_key VARCHAR(255) NOT NULL,
                keys_ LONGTEXT NULL,
                appStateSyncKeys_ LONGTEXT NULL,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);
        console.log("✅ Base de datos configurada correctamente");
    } catch (error) {
        console.error("❌ Error configurando la base de datos:", error);
    }
}

async function saveCreds(db: DatabaseConnection, sessionId: string, creds: any, keyStore: any, appStateSyncKeys: any) {
    try {
        const keys = await keyStore.storage; // Obtener las claves del KeyStore

        const query = `
            INSERT INTO wa_sessions (id, noise_key, signed_identity_key, signed_pre_key, adv_secret_key, keys_, appStateSyncKeys_, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, TRUE) 
            ON DUPLICATE KEY UPDATE 
                noise_key = VALUES(noise_key),
                signed_identity_key = VALUES(signed_identity_key),
                signed_pre_key = VALUES(signed_pre_key),
                adv_secret_key = VALUES(adv_secret_key),
                keys_ = VALUES(keys_),
                appStateSyncKeys_ = VALUES(appStateSyncKeys_),
                is_active = TRUE;
        `;

        await db.execute(query, [
            sessionId,
            JSON.stringify(creds.noiseKey, BufferJSON.replacer),
            JSON.stringify(creds.signedIdentityKey, BufferJSON.replacer),
            JSON.stringify(creds.signedPreKey, BufferJSON.replacer),
            creds.advSecretKey,
            keys ? JSON.stringify(keys, BufferJSON.replacer) : {},
            appStateSyncKeys ? JSON.stringify(appStateSyncKeys, BufferJSON.replacer) : "{}",
        ]);

        console.log(`✅ Claves guardadas correctamente para la sesión: ${sessionId}`);
    } catch (error) {
        console.error("❌ Error guardando las credenciales:", error);
    }
}

async function getCreds(db: DatabaseConnection, sessionId: string) {
    try {
        const [rows] = await db.execute(
            `SELECT noise_key, signed_identity_key, signed_pre_key, adv_secret_key, keys_, appStateSyncKeys_ FROM wa_sessions WHERE id = ? AND is_active = TRUE`,
            [sessionId]
        );

        if ((rows as any[]).length === 0) return { creds: initAuthCreds(), keys: {}, appStateSyncKeys: {} };

        const row = (rows as any[])[0];
        return {
            creds: {
                noiseKey: JSON.parse(row.noise_key, BufferJSON.reviver),
                signedIdentityKey: JSON.parse(row.signed_identity_key, BufferJSON.reviver),
                signedPreKey: JSON.parse(row.signed_pre_key, BufferJSON.reviver),
                advSecretKey: row.adv_secret_key,
            },
            keys: JSON.parse(row.keys_ || "{}", BufferJSON.reviver),
            appStateSyncKeys: JSON.parse(row.appStateSyncKeys_ || "{}", BufferJSON.reviver),
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

        // const keyStore = makeCacheableSignalKeyStore(sock.authState.keys, logger);

        const keyStore = makeCacheableSignalKeyStore(
            {
                get: async (key) => {
                    console.log("🔍 Buscando clave:", key);
                    const [rows] = await db.execute(
                        `SELECT keys_ FROM wa_sessions WHERE id = ? AND is_active = TRUE`,
                        [sessionId]
                    );

                    if ((rows as any[]).length === 0) {
                        console.log("⚠️ No se encontró la clave en la base de datos.");
                        return undefined;
                    }

                    const row = (rows as any[])[0];
                    const keys = row.keys_ ? JSON.parse(row.keys_, BufferJSON.reviver) : {};
                    return keys[key] || undefined;
                },

                set: async (data) => {
                    console.log("💾 Guardando claves:", data);
                    const [rows] = await db.execute(
                        `SELECT keys_ FROM wa_sessions WHERE id = ? AND is_active = TRUE`,
                        [sessionId]
                    );

                    let existingKeys = {};
                    if ((rows as any[]).length > 0) {
                        const row = (rows as any[])[0];
                        existingKeys = row.keys_ ? JSON.parse(row.keys_, BufferJSON.reviver) : {};
                    }

                    // Combinar claves existentes con las nuevas
                    Object.assign(existingKeys, data);

                    await db.execute(
                        `UPDATE wa_sessions SET keys_ = ? WHERE id = ? AND is_active = TRUE`,
                        [JSON.stringify(existingKeys, BufferJSON.replacer), sessionId]
                    );
                },
            },
            logger
        );



        (async () => {
            const [rows] = await db.execute(
                `SELECT keys_ FROM wa_sessions WHERE id = ? AND is_active = TRUE`,
                [sessionId]
            );

            if ((rows as any[]).length > 0) {
                const row = (rows as any[])[0];
                const allKeys = row.keys_ ? JSON.parse(row.keys_, BufferJSON.reviver) : {};

                // Obtener solo los Pre-Keys y sus IDs
                const preKeysWithIds = Object.entries(allKeys)
                    .filter(([key, _]) => key.includes("pre-key"))
                    .map(([key, value]) => ({ id: key, value }));

                console.log("🔑 Pre-Keys con IDs:", preKeysWithIds);
            } else {
                console.log("⚠️ No se encontraron pre-keys en la base de datos.");
            }
        })();


        // console.log("keyStore:", keyStore.get("app-state-sync-key"))

        sock.ev.on("creds.update", async () => {
            await saveCreds(db, sessionId, sock.authState.creds, keyStore, sock.authState.keys);
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
