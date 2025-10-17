import {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    EmbedBuilder,
    REST,
    Routes,
} from "discord.js";
import dotenv from "dotenv";
import express from 'express';
import mongoose from "mongoose"; 
dotenv.config();

// ----------------------------------------
// CONFIGURACIÓN DE DISCORD
// ----------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ----------------------------------------
// ESQUEMA Y MODELO DE MONGOOSE 
// ----------------------------------------

// Definición de la estructura de un documento Graffiti
const GraffitiSchema = new mongoose.Schema({
    nombre: { 
        type: String, 
        required: true, 
    },
    numero: { 
        type: String, 
        required: true, 
        unique: true 
    },
    lastSpawnTimestamp: { 
        type: Number, 
        required: true 
    },
}, {
    timestamps: false 
});

// Crear el Modelo que usaremos para interactuar con la DB
const Graffiti = mongoose.model('Graffiti', GraffitiSchema);

// ----------------------------------------
// CONEXIÓN A LA BASE DE DATOS
// ----------------------------------------

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Conexión a MongoDB Atlas establecida.");
    } catch (error) {
        console.error("❌ Error al conectar a MongoDB:", error);
        process.exit(1); 
    }
}

// ----------------------------------------
// FUNCIONES DE UTILIDAD
// ----------------------------------------

const getUnixTimestampSec = (date) => Math.floor(date.getTime() / 1000);

/**
* Calcula el tiempo exacto 12 horas después del último registro (el tiempo de desbloqueo teórico).
*/
function calculateNextSpawn(lastTimestampMs) {
    const nextSpawnTimeMs = lastTimestampMs + (11 * 60 * 60 * 1000); 
    return new Date(nextSpawnTimeMs);
}

// ---------------------------
// REGISTRO DE COMANDOS
// ---------------------------
const commands = [
    // 1. Comando /GRAF
    new SlashCommandBuilder()
        .setName("graf")
        .setDescription("Crea un reporte de graffiti (sin persistencia)")
        .addStringOption((option) =>
            option.setName("ubicacion").setDescription("Ubicación del graff").setRequired(true)
        )
        .addStringOption((option) =>
            option.setName("hora").setDescription("Hora en formato 24h (ej: 20:05)").setRequired(true)
        )
        .addStringOption((option) =>
            option.setName("numero").setDescription("Número identificador").setRequired(false)
        ),
        
    // 2. Comando /SETGRAF
    new SlashCommandBuilder()
        .setName("setgraf")
        .setDescription("Registra/Actualiza el spawn de un graffiti usando un número identificador.")
        .addStringOption((option) =>
            option
                .setName("nombre")
                .setDescription("Nombre del graffiti (ej: davis canales mostoles )")
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("numero")
                .setDescription("Número del graf.")
                .setRequired(true) 
        )
        .addIntegerOption((option) => 
            option
                .setName("desfase")
                .setDescription("Minutos transcurridos desde que apareció (ej: 5)")
                .setRequired(false)
        ),
        
    // 3. Comando /NEXTGRAFF
    new SlashCommandBuilder()
        .setName("nextgraff")
        .setDescription("Muestra los grafitis cuyo tiempo de desbloqueo (+12h) ya ha pasado.")
        .addStringOption((option) =>
            option
                .setName("filtro")
                .setDescription("Texto para buscar en el nombre (ej: davis, rancho)")
                .setRequired(true)
        ),
].map((command) => command.toJSON());

// Registro de comandos en Discord (REST API)
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            { body: commands }
        );
        console.log("✅ Comandos de barra actualizados en Discord.");
    } catch (err) {
        console.error("Error al registrar comandos:", err);
    }
})();

// ---------------------------
// MANEJO DE INTERACCIONES
// ---------------------------
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const commandName = interaction.commandName;
    const horaStr = interaction.options.getString("hora"); 

    // --- LÓGICA /SETGRAF ---
    if (commandName === "setgraf") {
        await interaction.deferReply(); 
        
        const nombre = interaction.options.getString("nombre");
        const numero = interaction.options.getString("numero"); 
        const desfase = interaction.options.getInteger("desfase") || 0; 

        // Cálculo del tiempo de aparición real
        const desfaseMs = desfase * 60 * 1000;
        const actualTimestampMs = Date.now();
        const spawnTimestampMs = actualTimestampMs - desfaseMs;
        
        try {
            await Graffiti.findOneAndUpdate(
                { numero: numero }, 
                { 
                    nombre: nombre, 
                    lastSpawnTimestamp: spawnTimestampMs 
                }, 
                { upsert: true, new: true } 
            );
            
            const date = new Date(spawnTimestampMs);
            const hubHour = String(date.getUTCHours()).padStart(2, '0');
            const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
            const hubTimeStr = `${hubHour}:${hubMinute}`;

            let replyContent = `✅ Graffiti **${nombre.toUpperCase()} (Nº ${numero})** registrado por ${interaction.user.tag}.\n`;
            
            if (desfase > 0) {
                replyContent += `*(${desfase} min de desfase aplicados).* \n`;
            }

            replyContent += `Último spawn registrado: **${hubTimeStr} HUB**`;

            await interaction.editReply({ 
                content: replyContent
            });

        } catch (error) {
            console.error("Error al registrar graffiti:", error);
            await interaction.editReply({ 
                content: `❌ Error al guardar el spawn de ${nombre}. Inténtalo de nuevo.`, 
            });
        }
    }

    // ----------------------------------------------------
    // --- LÓGICA /NEXTGRAFF ---
    // ----------------------------------------------------
    else if (commandName === "nextgraff") {
        await interaction.deferReply(); 
        
        const filtro = interaction.options.getString("filtro");
        const unlockedGraffitiMessages = [];
        const nowMs = Date.now();

        try {
            // 1. Obtener grafitis que contienen el filtro
            const allGraffiti = await Graffiti.find({ 
                nombre: { $regex: filtro, $options: 'i' } 
            }).sort({ numero: 1 }); 

            if (allGraffiti.length === 0) {
                return interaction.editReply({ 
                    content: `⚠️ No se encontraron grafitis que contengan el nombre: **${filtro.toUpperCase()}** en la base de datos.`, 
                });
            }
            
            // 2. Iterar, calcular el desbloqueo y aplicar el filtro
            for (const item of allGraffiti) {
                const lastSpawnTimestampMs = item.lastSpawnTimestamp;
                
                // Cálculo del tiempo de desbloqueo (+12 horas)
                const unlockDate = calculateNextSpawn(lastSpawnTimestampMs);
                const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                
                // ⚠️ FILTRO CLAVE: Solo si el tiempo de desbloqueo ya pasó
                if (unlockDate.getTime() >= nowMs) {
                    continue; 
                }

                // Conversión a segundos para Discord Timestamps
                const registrationTimestampSec = getUnixTimestampSec(new Date(lastSpawnTimestampMs));
                
                // Hora UTC de Registro (para el texto plano)
                const hubHour = String(new Date(lastSpawnTimestampMs).getUTCHours()).padStart(2, '0');
                const hubMinute = String(new Date(lastSpawnTimestampMs).getUTCMinutes()).padStart(2, '0');
                const hubTimeStr = `${hubHour}:${hubMinute}`;
                
                // Construcción del mensaje para un solo graffiti
                const itemMessage = 
                    `**Nº ${item.numero} | ${item.nombre.toUpperCase()}**\n` +
                    `> Registrado: <t:${registrationTimestampSec}:F> (\`${hubTimeStr}\` HUB)\n` +
                    `> Se desbloqueó: <t:${unlockTimestampSec}:t> **(<t:${unlockTimestampSec}:R>)**`;

                unlockedGraffitiMessages.push(itemMessage);
            }
            
            // 3. Enviar la respuesta usando un Embed
            if (unlockedGraffitiMessages.length > 0) {
                
                const embed = new EmbedBuilder()
                    .setColor("#2ecc71")
                    .setTitle(`🔓 Grafitis Desbloqueados para "${filtro.toUpperCase()}"`)
                    .setDescription(`Se encontraron **${unlockedGraffitiMessages.length}** grafitis cuyo tiempo de desbloqueo (+12h) ya ha pasado y están listos.`)
                    .addFields({
                        name: "Detalle de Grafitis Desbloqueados",
                        value: unlockedGraffitiMessages.join('\n\n').trim(),
                        inline: false,
                    })
                    .setFooter({ text: `El tiempo relativo (ej: hace 2 horas) indica hace cuánto se desbloqueó.` });

                await interaction.editReply({ embeds: [embed] });

            } else {
                 await interaction.editReply({ 
                     content: `⚠️ No se encontraron grafitis que contengan el nombre **${filtro.toUpperCase()}** cuyo tiempo de desbloqueo (+12h) ya haya pasado. Todos están en cooldown.`, 
                 });
            }

        } catch (error) {
            console.error("Error en /nextgraff:", error);
            await interaction.editReply("❌ Ocurrió un error al consultar la base de datos.");
        }
    }

    // --- LÓGICA /GRAF ---
    else if (commandName === "graf") {
        
        if (!horaStr) { 
            return interaction.reply({ content: "Error: Falta la hora.", ephemeral: true });
        }
        const match = horaStr.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (!match) {
            return interaction.reply({
                content: "⚠️ Formato de hora inválido. Usa HH:MM (por ejemplo, 20:05)",
                ephemeral: true,
            });
        }
        
        const ubicacion = interaction.options.getString("ubicacion");
        const numero = interaction.options.getString("numero"); 
        const hora = parseInt(match[1]);
        const minutos = parseInt(match[2]);
        
        const today = new Date();
        const baseDate = new Date(
            Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hora, minutos)
        );
        
        const diffs = [12, 13, 14];
        const horariosPosibles = diffs.map((sum) => {
            const newDate = new Date(baseDate.getTime());
            newDate.setUTCHours(baseDate.getUTCHours() + sum);
            
            const hubHora = String(newDate.getUTCHours()).padStart(2, "0");
            const hubMinutos = String(newDate.getUTCMinutes()).padStart(2, "0");
            const hubStr = `${hubHora}:${hubMinutos}`;
            
            const relativeTimestamp = `<t:${getUnixTimestampSec(newDate)}:R>`;
            
            return { hub: hubStr, relative: relativeTimestamp, sum: sum };
        });

        const embed = new EmbedBuilder()
            .setColor("#9b59b6")
            .setTitle("🎨 Reporte de Graffiti")
            .setDescription(
                `📍 **Ubicación:** ${ubicacion}\n🔢 **Número:** ${numero || 'N/A'}\n 🕒 HUB: ${horaStr}`
            )
            .addFields(
                {
                    name: "⏰ Próximos Posibles Horarios",
                    value: horariosPosibles.map((h) => 
                        `**+${h.sum}h**\n> HUB (UTC): \`${h.hub}\` (${h.relative})`
                    ).join("\n\n"),
                    inline: false,
                },
            )
            .setFooter({
                text: "Midnight • Grafitti",
            });

        await interaction.reply({ embeds: [embed] });
    }
});

// ----------------------------------------
// INICIO PRINCIPAL DE LA APLICACIÓN 
// ----------------------------------------

async function main() {
    console.log("Iniciando Bot y Conexión...");

    await connectDB();
    
    await client.login(process.env.TOKEN);
    console.log(`✅ Conectado como ${client.user.tag}`);

    const app = express();
    app.get('/', (req, res) => res.send('Bot activo ✅'));
    
    const port = process.env.PORT || 3000; 

    app.listen(port, () => {
        console.log(`Servidor web Express activo en el puerto ${port}`);
    });
}

main().catch(error => {
    console.error("Error fatal al iniciar la aplicación:", error);
    process.exit(1);
});