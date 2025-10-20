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
    // CLAVE: número es String y es el identificador único
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
    const nextSpawnTimeMs = lastTimestampMs + (12 * 60 * 60 * 1000); 
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
        .setDescription("Muestra grafitis con 11+ horas desde el registro (cerca de desbloquear).")
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
    // --- LÓGICA /NEXTGRAFF (CORREGIDA Y MEJORADA) ---
    // ----------------------------------------------------
    else if (commandName === "nextgraff") {
        await interaction.deferReply(); 
        
        const filtro = interaction.options.getString("filtro");
        const allFilteredMessages = [];
        const nowMs = Date.now();
        
        // Constante para el filtro mínimo de 11 horas (para listar)
        const elevenHoursMs = 11 * 60 * 60 * 1000;
        // Constante para el filtro de menos de 5 minutos (para resaltar)
        const fiveMinutesMs = 5 * 60 * 1000; // 300,000 milisegundos
        const RESULTS_PER_FIELD = 5; 

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
            
            // 2. Iterar, calcular el desbloqueo y aplicar el filtro de 11h
            for (const item of allGraffiti) {
                const lastSpawnTimestampMs = item.lastSpawnTimestamp;
                
                // Tiempo de desbloqueo teórico (12 horas después)
                const unlockDate = calculateNextSpawn(lastSpawnTimestampMs);
                const unlockTimestampMs = unlockDate.getTime();
                
                // Tiempo mínimo de registro necesario para ser listado (11 horas después)
                const minimumListTimeMs = lastSpawnTimestampMs + elevenHoursMs;

                // FILTRO CLAVE: Solo si han pasado al menos 11 horas (o más)
                if (nowMs < minimumListTimeMs) {
                    continue; 
                }
                
                // CÁLCULO PARA RESALTAR
                const timeRemainingMs = unlockTimestampMs - nowMs;
                const isVeryClose = timeRemainingMs <= fiveMinutesMs && timeRemainingMs > 0;
                
                // Formato de resaltado
                const highlightEmoji = isVeryClose ? "🚨 " : "";
                const highlightText = isVeryClose ? "**" : "";

                // Conversión a segundos para Discord Timestamps
                const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                const registrationTimestampSec = getUnixTimestampSec(new Date(lastSpawnTimestampMs));
                
                // Hora UTC de Registro (para el texto plano)
                const hubHour = String(new Date(lastSpawnTimestampMs).getUTCHours()).padStart(2, '0');
                const hubMinute = String(new Date(lastSpawnTimestampMs).getUTCMinutes()).padStart(2, '0');
                const hubTimeStr = `${hubHour}:${hubMinute}`;
                
                // Construcción del mensaje para un solo graffiti
                const itemMessage = 
                    `${highlightEmoji}${highlightText}Nº ${item.numero} | ${item.nombre.toUpperCase()}${highlightText}\n` +
                    `> Registrado: <t:${registrationTimestampSec}:F> (\`${hubTimeStr}\` HUB)\n` +
                    `> Desbloqueo (12h): <t:${unlockTimestampSec}:t> **(<t:${unlockTimestampSec}:R>)**`;

                allFilteredMessages.push(itemMessage);
            }
            
            // 3. Procesar resultados y crear múltiples embeds
            if (allFilteredMessages.length === 0) {
                 await interaction.editReply({ 
                     content: `⚠️ No se encontraron grafitis para **${filtro.toUpperCase()}** que hayan pasado el umbral de 11 horas desde su registro.`, 
                 });
                 return;
            }
            
            const totalMatches = allFilteredMessages.length;
            const embedsToSend = [];
            
            // Dividir la lista de mensajes en bloques
            for (let i = 0; i < totalMatches; i += RESULTS_PER_FIELD) {
                const chunk = allFilteredMessages.slice(i, i + RESULTS_PER_FIELD);
                const isFirstEmbed = i === 0;
                
                const embed = new EmbedBuilder()
                    .setColor("#3498db")
                    .setDescription(chunk.join('\n\n').trim());
                
                if (isFirstEmbed) {
                    // Solo el primer embed lleva el título y el resumen
                    embed.setTitle(`⏳ Grafitis Cerca del Desbloqueo para "${filtro.toUpperCase()}"`)
                         .setTimestamp()
                         .setFooter({ text: `Mostrando ${totalMatches} resultados en total. Desbloqueo: +12h. 🚨: < 5 mins.` }); // Se añade la leyenda
                } else {
                    embed.setTitle(`(Continuación) Resultados para "${filtro.toUpperCase()}"`);
                }
                
                embedsToSend.push(embed);
            }

            // 4. Enviar los embeds
            await interaction.editReply({ embeds: embedsToSend.slice(0, 10) });
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