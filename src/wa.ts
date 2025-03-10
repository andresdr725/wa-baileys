import {
    AuthenticationCreds,
    AuthenticationState,
    BufferJSON,
    initAuthCreds,
    proto,
    SignalDataTypeMap
} from "@whiskeysockets/baileys";
import mysql from "mysql2/promise";

export interface DatabaseConnection {
    execute: (query: string, values?: any[]) => Promise<[any, any]>;
}

export interface SessionInterface {
    id: string;
    creds: string;
    keys_: string;
    is_active: boolean;
}

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
    "pre-key": "preKeys",
    session: "sessions",
    "sender-key": "senderKeys",
    "app-state-sync-key": "appStateSyncKeys",
    "app-state-sync-version": "appStateVersions",
    "sender-key-memory": "senderKeyMemory"
};

// Conectar a la base de datos
export const connectDB = async (): Promise<DatabaseConnection> => {
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

// Configurar la base de datos si no existe la tabla
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

// Función para obtener datos de la sesión
export const session_data = async (db: DatabaseConnection, id_session: string): Promise<SessionInterface | null> => {
    const [rows] = await db.execute(`SELECT * FROM wa_sessions WHERE id = ? AND is_active = TRUE`, [id_session]);
    const session = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return session ? (session as SessionInterface) : null;
};

// Función para guardar el estado de la sesión
const saveState = async (db: DatabaseConnection, id_session: string, creds: AuthenticationCreds, keys: any) => {
    try {
        await db.execute(`
            INSERT INTO wa_sessions (id, creds, keys_, is_active)
            VALUES (?, ?, ?, TRUE)
            ON DUPLICATE KEY UPDATE creds = VALUES(creds), keys_ = VALUES(keys_), is_active = TRUE
        `, [
            id_session,
            JSON.stringify(creds, BufferJSON.replacer),
            JSON.stringify(keys, BufferJSON.replacer)
        ]);
    } catch (error) {
        console.error("❌ Error guardando el estado de la sesión:", error);
    }
};

// Estado de autenticación
const authState = async (): Promise<{ state: AuthenticationState; saveState: () => void }> => {
    const db = await connectDB();
    await setupDatabase(db);

    let creds: AuthenticationCreds;
    let keys: any = {};

    // Obtener sesión
    const wa_session = await session_data(db, 'mi_session');

    if (wa_session && wa_session.creds && wa_session.keys_) {
        try {
            creds = JSON.parse(wa_session.creds, BufferJSON.reviver);
            keys = JSON.parse(wa_session.keys_, BufferJSON.reviver);
        } catch (error) {
            console.error("❌ Error al parsear la sesión:", error);
            creds = initAuthCreds();
            keys = {};
        }
    } else {
        creds = initAuthCreds();
        keys = {};
    }

    // Retornar estado de autenticación
    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const key = KEY_MAP[type];
                    return ids.reduce((dict: any, id) => {
                        let value = keys[key]?.[id];
                        if (value) {
                            if (type === "app-state-sync-key") {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            dict[id] = value;
                        }
                        return dict;
                    }, {});
                },
                set: (data: any) => {
                    for (const i in data) {
                        const key = KEY_MAP[i as keyof SignalDataTypeMap];
                        keys[key] = keys[key] || {};
                        Object.assign(keys[key], data[i]);
                    }
                    saveState(db, 'mi_session', creds, keys);
                }
            }
        },
        saveState: () => saveState(db, 'mi_session', creds, keys)
    };
};

export { authState };