import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import mysql from "mysql2/promise";

// 🔌 Conexión a MySQL
async function connectDB() {
    return await mysql.createConnection({
        host: "localhost",
        port: 3306,
        user: "root",
        password: "root",
        database: "whatsapp_db"
    });
}

// 📂 Verificar y crear credenciales en la base de datos
async function getOrCreateCreds(db: any, sessionId: string) {
    const [rows] = await db.execute("SELECT creds, _keys FROM wa_sessions WHERE id = ?", [sessionId]);

    if (rows.length > 0) {
        console.log("✅ Credenciales encontradas en MySQL.");
        return {
            creds: JSON.parse(rows[0].creds),
            keys: JSON.parse(rows[0].keys),
            isNew: false
        };
    } else {
        console.log("🆕 No se encontraron credenciales. Generando nuevas...");

        const { state } = await useMultiFileAuthState(`./sessions/${sessionId}`);
        await db.execute("INSERT INTO wa_sessions (id, creds, _keys) VALUES (?, ?, ?)", [
            sessionId,
            JSON.stringify(state.creds),
            JSON.stringify(state.keys)
        ]);

        return {
            creds: state.creds,
            keys: state.keys,
            isNew: true
        };
    }
}

// 💾 Guardar credenciales y Pre-Keys en MySQL
async function saveCreds(db: any, sessionId: string, creds: any, keys: any) {
    await db.execute(
        "UPDATE wa_sessions SET creds = ?, _keys = ? WHERE id = ?",
        [JSON.stringify(creds), JSON.stringify(keys), sessionId]
    );
}

async function storePreKey(db: any, sessionId: string, preKey: { keyId: number, keyPair: any, signature: any }) {
    await db.execute(
        "INSERT INTO wa_prekeys (session_id, key_id, key_pair, signature) VALUES (?, ?, ?, ?)",
        [sessionId, preKey.keyId, JSON.stringify(preKey.keyPair), JSON.stringify(preKey.signature)]
    );
}

// 🔥 Conectar a WhatsApp y manejar la sesión en MySQL
async function connectToWhatsApp(sessionId: string = "default") {
    try {
        const db = await connectDB();
        const { creds, keys, isNew } = await getOrCreateCreds(db, sessionId);

        const sock = makeWASocket({
            auth: { creds, keys } as any,
            printQRInTerminal: true,
        });

        if (isNew) console.log("🆕 Primera vez conectando: escanea el QR.");

        sock.ev.on("creds.update", async () => {
            await saveCreds(db, sessionId, sock.authState.creds, sock.authState.keys);
        });

        sock.ev.on("connection.update", async (update) => {
            if (update.connection === "open") {
                console.log(`✅ Conectado con sesión: ${sessionId}`);
            }
        });
    } catch (error) {
        console.error("❌ Error conectando a WhatsApp:", error);
    }
}

connectToWhatsApp();
