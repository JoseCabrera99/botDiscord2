import {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    EmbedBuilder,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder, 
} from "discord.js";
import dotenv from "dotenv";
import express from 'express';
import mongoose from "mongoose"; 
dotenv.config();

// ----------------------------------------
// CONSTANTES Y CONFIGURACIÓN DE TIEMPO 🕒
// ----------------------------------------
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * ONE_HOUR_MS;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;

// Valores para el campo 'rescheduleCount' en la DB
const BASE_12H_START_COUNT = 0;
const BASE_12H_MAX_OFFSET_COUNT = 3; // +15h (12 + 3)

const BASE_24H_START_COUNT = 12; // Valor que indica el inicio del ciclo 24h (+24h)
const BASE_24H_MAX_COUNT = 15; // Valor máximo (+27h)

// Imagenes del graff
const GRAFFITI_IMAGES = {
    "1": "https://i.imgur.com/TnimrdI.png",
    "2": "https://i.imgur.com/opalwbr.png",
    "3": "https://i.imgur.com/VNq4sUg.png", 
    "4": "https://i.imgur.com/XjqBOtk.png",
    "5": "https://i.imgur.com/gO5ogtv.png",
    "6": "https://i.imgur.com/Q9DZpJM.png",
    "7": "https://i.imgur.com/LgDiuJ7.png",
    "8": "https://i.imgur.com/iJMshII.png",
    "9": "https://i.imgur.com/6w0mi27.png",
    "10": "https://i.imgur.com/901NWQo.png",
    "11": "https://i.imgur.com/lHlz1Rx.png",
    "12": "https://i.imgur.com/klhm5Hl.png",
    "13": "https://i.imgur.com/6V9G4S9.png",
    "14": "https://i.imgur.com/zoN5Vxi.png",
    "15": "https://i.imgur.com/meyKYpO.png",
    "16": "https://i.imgur.com/Mknry4G.png",
    "17": "https://i.imgur.com/GVcTfkC.png",
    "18": "https://i.imgur.com/kSf33DM.png",
    "19": "https://i.imgur.com/Wqt75Du.png",
    "20": "https://i.imgur.com/LMIWpfQ.png",
    "21": "https://i.imgur.com/dW9mofV.png",
    "22": "https://i.imgur.com/E1cp8o0.png",
    "23": "https://i.imgur.com/rjaMb5L.png",
    "24": "https://i.imgur.com/PEBaxkl.png",
    "25": "https://i.imgur.com/Qqa9JPa.png",
    "26": "https://i.imgur.com/nCwH0Pf.png",
    "27": "https://i.imgur.com/JPVEfc3.png",
    "28": "https://i.imgur.com/wXdKi68.png",
    "29": "https://i.imgur.com/WUc8A5U.png",
    "30": "https://i.imgur.com/AIG5Qqm.png",
    "31": "https://i.imgur.com/Anh7dgN.png",
    "32": "https://i.imgur.com/POQSKcc.png",
    "33": "https://i.imgur.com/vHLqmAA.png",
    "34": "https://i.imgur.com/ivgcvlw.png",
    "35": "https://i.imgur.com/NUxG3KW.png",
    "36": "https://i.imgur.com/mvNpqfh.png",
    "37": "https://i.imgur.com/04wolq8.png",
    "38": "https://i.imgur.com/wL2w78y.png",
    "39": "https://i.imgur.com/m1rrtMI.png",
    "42": "https://i.imgur.com/uDUhJY4.png",
    "43": "https://i.imgur.com/0OqECoZ.png",
    "44": "https://i.imgur.com/Gw4kX8x.png",
    "45": "https://i.imgur.com/MS9oUOB.png",
    "46": "https://i.imgur.com/Y1ScoSd.png",
    "S/N": "https://i.imgur.com/F94WobP.png",
    "ELYSIAN": "https://i.imgur.com/TSO3RCl.png",
    "AERO": "https://i.imgur.com/FI4ieDo.png",
    "TATAVIAM": "https://i.imgur.com/mL1CYiI.png",
    "PUERTA": "https://i.imgur.com/TKS6mYI.png",
    "MAZE": "https://i.imgur.com/3zB5YSP.png",
    "STRAW": "https://i.imgur.com/3OfFwMw.png",
};

// ----------------------------------------
// CONFIGURACIÓN DE DISCORD
// ----------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] }); 
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID; 

// ----------------------------------------
// ESQUEMA Y MODELO DE MONGOOSE 
// ----------------------------------------

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
    // 0: +12h, 1: +13h, 2: +14h, 3: +15h
    // 12: +24h, 13: +25h, 14: +26h, 15: +27h (Nuevo Ciclo)
    rescheduleCount: { 
        type: Number,
        default: 0,
    }
}, {
    timestamps: false 
});

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
* Calcula el tiempo exacto de desbloqueo teórico (lastTimestamp + totalHours)
*/
function calculateNextSpawn(lastTimestampMs, totalHours) {
    const nextSpawnTimeMs = lastTimestampMs + (totalHours * 60 * 60 * 1000); 
    return new Date(nextSpawnTimeMs);
}

/**
 * Obtiene el alias del miembro o, si no tiene, su nombre de usuario.
 */
const getDisplayName = (interaction) => {
    if (interaction.member) {
        // Usa el nickname si existe, sino usa el nombre de usuario
        return interaction.member.nickname || interaction.user.username;
    }
    return interaction.user.username;
};

// ----------------------------------------
// TAREA PROGRAMADA DE AVISO (Modificada para 12h/24h)
// ----------------------------------------

async function checkGraffitiAlerts() {
    if (!ALERT_CHANNEL_ID) {
        console.error("❌ ALERT_CHANNEL_ID no está configurado. La tarea de alertas no puede ejecutarse.");
        return;
    }

    const nowMs = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    const elevenMinutesMs = 11 * 60 * 1000;

    let targetChannel;
    try {
        // Se realiza la costosa llamada a la API cada minuto (comportamiento original)
        targetChannel = await client.channels.fetch(ALERT_CHANNEL_ID); 
    } catch (error) {
        console.error(`❌ Error al intentar obtener el canal ${ALERT_CHANNEL_ID}:`, error.message);
        return; 
    }
    
    if (!targetChannel) {
        console.error(`❌ Canal de alertas con ID ${ALERT_CHANNEL_ID} no encontrado después de fetch.`);
        return; 
    }

    try {
        const allGraffiti = await Graffiti.find({});
        const alertsToSend = [];

        for (const item of allGraffiti) {
            const rescheduleCount = item.rescheduleCount || 0;
            let currentBaseHours;
            let extraOffsetHours;

            // Determinar el ciclo actual y el offset (Lógica original inline)
            if (rescheduleCount >= BASE_24H_START_COUNT) {
                // Ciclo de 24 horas (24h a 27h)
                currentBaseHours = 24;
                extraOffsetHours = rescheduleCount - BASE_24H_START_COUNT;
            } else {
                // Ciclo de 12 horas (12h a 15h)
                currentBaseHours = 12;
                extraOffsetHours = rescheduleCount;
            }
            
            const totalHours = currentBaseHours + extraOffsetHours;
            
            // Si el grafiti está en el ciclo 15h, y ya pasó, lo saltamos.
            // La nueva lógica de pospuesto a 24h ya está en el botón 'reschedule'.
            if (totalHours <= 15 && totalHours < 24 && nowMs > (item.lastSpawnTimestamp + (15 * ONE_HOUR_MS) + tenMinutesMs)) {
                // El grafiti superó las 15h, pero no fue pospuesto al ciclo 24h. 
                // No enviamos alerta, espera a que alguien lo timee o use /setgraf.
                continue; 
            }

            const unlockDate = calculateNextSpawn(item.lastSpawnTimestamp, totalHours);
            const unlockTimeMs = unlockDate.getTime(); 

            // Verificar si la hora de desbloqueo está entre 10 y 11 minutos
            if (unlockTimeMs > (nowMs + tenMinutesMs) && unlockTimeMs <= (nowMs + elevenMinutesMs)) {
                
                if (unlockTimeMs <= nowMs) continue; 
                
                const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                
                alertsToSend.push({
                    item: item,
                    offsetHours: totalHours, 
                    currentBaseHours: currentBaseHours,
                    currentRescheduleCount: rescheduleCount,
                    unlockTime: `<t:${unlockTimestampSec}:t>`,
                    unlockRelative: `<t:${unlockTimestampSec}:R>`,
                });
            }
        }

        if (alertsToSend.length > 0) {
            
            for (const alert of alertsToSend) {
                const item = alert.item;
                const rescheduleCount = alert.currentRescheduleCount;
                
                // --- Lógica de Botón para ambos ciclos ---
                const is24hCycle = rescheduleCount >= BASE_24H_START_COUNT;
                const maxCount = BASE_24H_MAX_COUNT; // El máximo es 15 (+27h)
                const isMaxed = rescheduleCount >= maxCount;
                
                // Calculamos el paso actual para el display (0 a 3)
                const currentStep = is24hCycle ? rescheduleCount - BASE_24H_START_COUNT : rescheduleCount;
                const nextCountDisplay = currentStep + 1; // 1/4, 2/4...
                
                // El customId necesita el valor actual para que la lógica de posponer funcione.
                // En el botón, enviaremos el valor actual + 1 (ej: 13, 4)
                const nextDBCount = rescheduleCount + 1; 

                // --- BÚSQUEDA DE LA IMAGEN ---
                const graffitiKey = `${item.numero}`; 
                const imageUrl = GRAFFITI_IMAGES[graffitiKey]; 
                // -----------------------------
                
                const description = 
                    `**Nº ${item.numero} | ${item.nombre.toUpperCase()}**\n` +
                    `> Base: **+${alert.currentBaseHours}h** (Ciclo)\n` +
                    `> Offset: **+${alert.offsetHours}h** (actual)\n` +
                    `> Desbloqueo: ${alert.unlockTime} **(${alert.unlockRelative})**`;

                const embed = new EmbedBuilder()
                    .setColor("#f1c40f")
                    .setTitle(`🚨 ¡AVISO DE DESBLOQUEO DE GRAFFITIS! (+${alert.offsetHours}h) 🚨`)
                    .setDescription(description)
                    .setTimestamp();
                
                // --- AÑADIR LA IMAGEN AL EMBED SI LA ENCUENTRA ---
                if (imageUrl) {
                    embed.setImage(imageUrl); 
                }
                // ------------------------------------------------
                
                // Creación de los botones
                const nextOffsetHours = is24hCycle ? 24 + nextCountDisplay : 12 + nextCountDisplay;

                const oneHourButton = new ButtonBuilder()
                    // Usamos el nextDBCount (ej. 13, 4)
                    .setCustomId(`reschedule_${item.numero}_${nextDBCount}`) 
                    .setLabel(`+1 hora (${nextCountDisplay}/4)`) 
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(isMaxed);

                const timearButton = new ButtonBuilder()
                    .setCustomId(`timear_${item.numero}`)
                    .setLabel('Timear')
                    .setStyle(ButtonStyle.Success);
                
                const row = new ActionRowBuilder().addComponents(oneHourButton, timearButton);

                await targetChannel.send({ 
                    content: `||@here||`, 
                    embeds: [embed],
                    components: [row]
                });
            }
            console.log(`✅ Alerta de ${alertsToSend.length} grafitis enviada con botones.`);
        }

    } catch (error) {
        console.error("❌ Error en la tarea programada de alertas:", error);
    }
}


// ---------------------------
// REGISTRO DE COMANDOS 
// ---------------------------
const commands = [
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
        
    new SlashCommandBuilder()
        .setName("nextgraff")
        .setDescription("Muestra grafitis cerca de desbloquear, simulando una hora futura.")
        .addStringOption((option) =>
            option
                .setName("filtro")
                .setDescription("Texto para buscar en el nombre (ej: davis, rancho)")
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("minutos")
                .setDescription("Minutos a añadir a la hora actual (ej: 8)")
                .setRequired(true) 
        ),
].map((command) => command.toJSON());

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
// MANEJO DE INTERACCIONES (Modificado para paginación de /nextgraff)
// ---------------------------
client.on("interactionCreate", async (interaction) => {
    
    // Obtener el nombre a mostrar (alias o username)
    const displayName = getDisplayName(interaction).toUpperCase();

    if (interaction.isChatInputCommand()) {
        const commandName = interaction.commandName;
        const horaStr = interaction.options.getString("hora"); 

        // --- LÓGICA /SETGRAF ---
        if (commandName === "setgraf") {
            await interaction.deferReply(); 
            
            const nombre = interaction.options.getString("nombre");
            const numero = interaction.options.getString("numero"); 
            const desfase = interaction.options.getInteger("desfase") || 0; 

            const desfaseMs = desfase * 60 * 1000;
            const actualTimestampMs = Date.now();
            const spawnTimestampMs = actualTimestampMs - desfaseMs;
            
            try {
                // Se resetea rescheduleCount a 0 al registrar un nuevo spawn
                await Graffiti.findOneAndUpdate(
                    { numero: numero }, 
                    { 
                        nombre: nombre, 
                        lastSpawnTimestamp: spawnTimestampMs,
                        rescheduleCount: 0, 
                    }, 
                    { upsert: true, new: true } 
                );
                
                const date = new Date(spawnTimestampMs);
                const hubHour = String(date.getUTCHours()).padStart(2, '0');
                const hubMinute = String(date.getUTCMinutes()).padStart(2, '0'); // ✅ CORREGIDO
                const hubTimeStr = `${hubHour}:${hubMinute}`;

                let replyContent = `✅ Graffiti **${nombre.toUpperCase()} (Nº ${numero})** registrado por **${displayName}**.\n`;
                
                if (desfase > 0) {
                    replyContent += `*(${desfase} min de desfase aplicados).* \n`;
                }

                replyContent += `Último spawn registrado: **${hubTimeStr} HUB**. (Próximo aviso en ~12h)`;

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
        // --- LÓGICA /NEXTGRAFF (Ahora con Paginación) ---
        else if (commandName === "nextgraff") {
            await interaction.deferReply(); 
            
            const filtro = interaction.options.getString("filtro");
            const minutesToAdd = interaction.options.getInteger("minutos"); 
            
            const nowMs = Date.now();
            
            const futureDateMs = nowMs + (minutesToAdd * 60 * 1000);
            const futureDate = new Date(futureDateMs);
            const targetMinutes = futureDate.getUTCMinutes(); 
            const targetHours = futureDate.getUTCHours(); 

            const targetTimeStr = `${String(targetHours).padStart(2, '0')}:${String(targetMinutes).padStart(2, '0')}`;
            
            const elevenHoursMs = 11 * 60 * 60 * 1000;
            const fiveMinutesBefore = 5; 
            const CHUNK_SIZE = 5; // El tamaño de cada lote de grafitis
            
            const filteredAndPreparedGraffiti = []; // Array para almacenar los datos listos

            try {
                const allGraffiti = await Graffiti.find({ 
                    nombre: { $regex: filtro, $options: 'i' } 
                }).sort({ numero: 1 }); 

                if (allGraffiti.length === 0) {
                    return interaction.editReply({ 
                        content: `⚠️ No se encontraron grafitis que contengan el nombre: **${filtro.toUpperCase()}** en la base de datos.`, 
                    });
                }
                
                // 1. Preparar y filtrar todos los resultados
                for (const item of allGraffiti) {
                    
                    const lastSpawnTimestampMs = item.lastSpawnTimestamp;
                    
                    // Si no ha pasado el umbral de 11h, lo saltamos
                    if (nowMs < (lastSpawnTimestampMs + elevenHoursMs)) {
                        continue; 
                    }
                    
                    // Usamos 12h de base para la simulación
                    const unlockDate = calculateNextSpawn(lastSpawnTimestampMs, 12); 
                    const unlockMinutes = unlockDate.getUTCMinutes(); 
                    
                    let isVeryClose = false;
                    
                    // Diferencia de minutos entre el tiempo simulado y el tiempo real de unlock a 12h
                    let difference = (targetMinutes - unlockMinutes + 60) % 60;
                
                    // Está muy cerca si la diferencia es 0, 1, 2, 3, 4, o 5 minutos.
                    if (difference >= 0 && difference <= fiveMinutesBefore) {
                        isVeryClose = true;
                    }
                    
                    const highlightEmoji = isVeryClose ? "🚨 " : "";
                    const highlightText = isVeryClose ? "**" : "";

                    const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                    const lastSpawnDate = new Date(lastSpawnTimestampMs);
                    const registrationTimestampSec = getUnixTimestampSec(lastSpawnDate);
                    
                    const hubHour = String(lastSpawnDate.getUTCHours()).padStart(2, '0');
                    const hubMinute = String(lastSpawnDate.getUTCMinutes()).padStart(2, '0');
                    const hubTimeStr = `${hubHour}:${hubMinute}`;
                    
                    const itemMessage = 
                        `${highlightEmoji}${highlightText}Nº ${item.numero} | ${item.nombre.toUpperCase()}${highlightText}\n` +
                        `> Registrado: <t:${registrationTimestampSec}:F> (\`${hubTimeStr}\` HUB)\n` +
                        `> Desbloqueo (12h): <t:${unlockTimestampSec}:t> **(<t:${unlockTimestampSec}:R>)**`;

                    filteredAndPreparedGraffiti.push({
                         item: item,
                         message: itemMessage,
                         isAlarm: isVeryClose,
                    });
                }
                
                if (filteredAndPreparedGraffiti.length === 0) {
                      await interaction.editReply({ 
                           content: `⚠️ No se encontraron grafitis para **${filtro.toUpperCase()}** que hayan pasado el umbral de 11 horas desde su registro.`, 
                         });
                          return;
                }
                
                let replySent = false;
                
                // 2. Iterar sobre los resultados en lotes (chunks) de 5
                for (let i = 0; i < filteredAndPreparedGraffiti.length; i += CHUNK_SIZE) {
                    const chunk = filteredAndPreparedGraffiti.slice(i, i + CHUNK_SIZE);
                    
                    let chunkMessages = [];
                    let chunkButtons = [];
                    
                    chunk.forEach(data => {
                        chunkMessages.push(data.message);
                        
                        // Si el grafiti tiene alarma (está en los 5m), el botón la lleva
                        const highlightEmoji = data.isAlarm ? "🚨 " : "";
                        const buttonLabel = `${highlightEmoji}Timear N° ${data.item.numero}`;
                        
                        chunkButtons.push(
                            new ButtonBuilder()
                                .setCustomId(`timear_nextgraff_${data.item.numero}`)
                                .setLabel(buttonLabel)
                                .setStyle(ButtonStyle.Primary)
                        );
                    });
                    
                    // 3. Construir el Embed
                    const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
                    const totalChunks = Math.ceil(filteredAndPreparedGraffiti.length / CHUNK_SIZE);
                    
                    const embed = new EmbedBuilder()
                        .setColor("#3498db")
                        .setTitle(`⏳ Grafitis Cerca de Desbloqueo | Lote ${chunkNumber} de ${totalChunks}`)
                        .setDescription(chunkMessages.join('\n\n').trim())
                        .setTimestamp()
                        .setFooter({ text: `Simulando hora: ${targetTimeStr} HUB. Filtro: ${filtro.toUpperCase()}` });
                    
                    // 4. Construir la Fila de Botones
                    const buttonRow = new ActionRowBuilder().addComponents(chunkButtons);
                    
                    const messagePayload = { 
                        embeds: [embed], 
                        components: [buttonRow] 
                    };
                    
                    // 5. Enviar el mensaje
                    if (!replySent) {
                        // El primer lote usa editReply para responder la interacción inicial
                        await interaction.editReply(messagePayload);
                        replySent = true;
                    } else {
                        // Los lotes subsecuentes usan followUp
                        await interaction.followUp(messagePayload);
                    }
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
            
            // Rango de desbloqueo: 12h a 15h
            const diffs = [12, 13, 14, 15]; 
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
                        name: "⏰ Próximos Posibles Horarios (12h a 15h)",
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
        return;
    } 
    
    // Manejar interacciones de botones
    if (interaction.isButton()) {
        const customId = interaction.customId;
        const parts = customId.split('_');
        const action = parts[0];
        
        // Determinar el número de graffiti y la acción específica
        let numero;
        let isNextGraffAction = false;
        
        if (action === 'timear' && parts.length === 2) {
            // Acción 'timear' proveniente de la alerta (timear_[numero])
            numero = parts[1];
        } else if (action === 'timear' && parts[1] === 'nextgraff') {
            // Acción 'timear' proveniente de /nextgraff (timear_nextgraff_[numero])
            numero = parts[2];
            isNextGraffAction = true;
        } else if (action === 'reschedule') {
            // Acción 'reschedule' (reschedule_[numero]_[count])
            numero = parts[1];
        } else {
            // No es una acción conocida
            return;
        }
        
        await interaction.deferUpdate();

        try {
            // ------------------------------------
            // LÓGICA BOTÓN "1 hora +" (Desplazar Offset)
            // ------------------------------------
            if (action === 'reschedule') {
                const countStr = parts[2];
                const currentDBCount = parseInt(countStr) - 1; 
                
                let newRescheduleCount;
                
                // LÓGICA DE CICLO: Si es el último pospuesto del ciclo actual, salta al siguiente ciclo.
                if (currentDBCount === BASE_12H_MAX_OFFSET_COUNT) { 
                    // Si viene de +15h (count 3), el nuevo ciclo es +24h (count 12)
                    newRescheduleCount = BASE_24H_START_COUNT; 
                } else if (currentDBCount === BASE_24H_MAX_COUNT) {
                    // Si ya está en +27h (count 15), no puede posponerse más
                    newRescheduleCount = BASE_24H_MAX_COUNT; 
                }
                else {
                    newRescheduleCount = currentDBCount + 1; // Incremento normal
                }
                
                // 1. Actualizar la BD
                const updatedGraffiti = await Graffiti.findOneAndUpdate(
                    { numero: numero },
                    { $set: { rescheduleCount: newRescheduleCount } }, 
                    { new: true } 
                );

                if (updatedGraffiti) {
                    // Recalculamos el total de horas basado en el nuevo count
                    const is24hCycle = newRescheduleCount >= BASE_24H_START_COUNT;
                    const currentBaseHours = is24hCycle ? 24 : 12;
                    const extraOffsetHours = is24hCycle ? newRescheduleCount - BASE_24H_START_COUNT : newRescheduleCount;
                    const offsetHours = currentBaseHours + extraOffsetHours;
                    
                    const maxCount = BASE_24H_MAX_COUNT; // Límite final es 15
                    const isMaxed = newRescheduleCount >= maxCount; 

                    // Usamos la función calculateNextSpawn con el offset total
                    const newUnlockDate = calculateNextSpawn(updatedGraffiti.lastSpawnTimestamp, offsetHours); 
                    const newUnlockTimestampSec = getUnixTimestampSec(newUnlockDate);
                    
                    // --- 2. DESHABILITAR BOTONES EN EL MENSAJE ORIGINAL Y CONFIRMAR ---
                    
                    const maxedMessage = isMaxed ? `\n\n**⚠️ Límite de pospuestos (+27h) alcanzado. La próxima alerta será la última.**` : '';
                    
                    // Prepara la nueva descripción de confirmación
                    const newDescription = 
                        `**Nº ${numero} | ${updatedGraffiti.nombre.toUpperCase()}**\n` +
                        `> **Ciclo de ${currentBaseHours}h**\n` +
                        `> Offset: **+${offsetHours}h** (nuevo)\n` +
                        `> Próximo Aviso Programado: <t:${newUnlockTimestampSec}:t> **(<t:${newUnlockTimestampSec}:R>)**` +
                        maxedMessage;

                    const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setTitle(`✅ POSPUESTO a +${offsetHours}h por ${displayName}`) 
                        .setDescription(newDescription)
                        .setColor("#1abc9c"); // Verde
                        
                    // Creamos una nueva fila de botones deshabilitados
                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('disabled_reschedule_old')
                            .setLabel(`Pospuesto a +${offsetHours}h`) 
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled_timear_old')
                            .setLabel('Timear')
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true)
                    );

                    // Editamos el mensaje original para deshabilitar los botones.
                    await interaction.message.edit({ 
                        embeds: [originalEmbed], 
                        components: [disabledRow] 
                    });

                } else {
                    await interaction.followUp({ content: '❌ Error: Graffiti no encontrado o ya eliminado.', ephemeral: true });
                }
            } 
            
            // ------------------------------------
            // LÓGICA BOTÓN "Timear" (desde Alerta y /nextgraff)
            // ------------------------------------
            else if (action === 'timear') {
                const nowTimestampMs = Date.now();

                // 1. Actualizar la BD (se actualiza el spawn y se resetea el contador a 0)
                const updatedGraffiti = await Graffiti.findOneAndUpdate(
                    { numero: numero },
                    { 
                        $set: { 
                            lastSpawnTimestamp: nowTimestampMs,
                            rescheduleCount: 0, 
                        }
                    },
                    { new: true }
                );

                if (updatedGraffiti) {
                    // El nuevo desbloqueo es +12h desde ahora
                    const unlockDate = calculateNextSpawn(updatedGraffiti.lastSpawnTimestamp, 12); 
                    const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                    
                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

                    if (isNextGraffAction) {
                        // --- LÓGICA PARA BOTÓN /NEXTGRAFF ---
                        
                        // 2. Modificar el mensaje/Embed
                        let newDescription = newEmbed.data.description;
                        
                        const timearConfirmation = `**✅ TIMEADO POR ${displayName}**\n> Nuevo Desbloqueo (12h): <t:${unlockTimestampSec}:t> (<t:${unlockTimestampSec}:R>)`;
                        
                        // Reemplazar la línea del graffiti timeado con el estado de timeado
                        if (newDescription) {
                            const lines = newDescription.split('\n');
                            let found = false;
                            for (let i = 0; i < lines.length; i++) {
                                // Buscar la línea que contiene el número del grafiti
                                if (lines[i].includes(`Nº ${numero}`)) {
                                    lines[i] = timearConfirmation; 
                                    found = true;
                                    
                                    // Eliminar líneas subsecuentes (Registrado, Desbloqueo)
                                    // Aseguramos que solo borramos las líneas de detalles (que empiezan con '>')
                                    let deleteCount = 0;
                                    for(let j = i + 1; j < lines.length && deleteCount < 2; j++) {
                                        if (lines[j].startsWith('>')) {
                                            lines[j] = '---LINE_TO_REMOVE---';
                                            deleteCount++;
                                        }
                                    }
                                    if (found) break; 
                                }
                            }
                            
                            // Recomponer la descripción, quitando las líneas de borrado
                            newDescription = lines.filter(line => line !== '---LINE_TO_REMOVE---').join('\n').trim();
                            
                            // Actualizar Título y Descripción del Embed
                            newEmbed.setTitle(`✅ Graffiti N°${numero} TIMEADO | Los botones de este mensaje han sido desactivados.`)
                                         .setDescription(newDescription)
                                         .setColor("#2ecc71"); 
                        }
                        
                        // 3. Deshabilitar todos los botones en el mensaje (y cambiar el label del pulsado)
                        const disabledComponents = interaction.message.components.map(row => {
                            const newRow = ActionRowBuilder.from(row);
                            newRow.components.forEach(button => {
                                if (button.data.custom_id === customId) {
                                    button.setLabel(`Timeado por ${displayName}`)
                                          .setStyle(ButtonStyle.Success);
                                }
                                button.setDisabled(true);
                            });
                            return newRow;
                        });

                        await interaction.message.edit({ 
                            embeds: [newEmbed], 
                            components: disabledComponents
                        });
                        
                    } else {
                        // --- LÓGICA PARA BOTÓN DE ALERTA ---
                        
                        // 2. Modificar el mensaje
                        newEmbed
                            .setTitle(`✅ GRAFFITI TIMEADO POR ${displayName}`)
                            .setDescription(
                                `**Nº ${numero} | ${updatedGraffiti.nombre.toUpperCase()}**\n` +
                                `> Registrado: <t:${getUnixTimestampSec(new Date(nowTimestampMs))}:F> (Reinicia el ciclo +12h)\n` +
                                `> Próximo Desbloqueo: <t:${unlockTimestampSec}:t> **(<t:${unlockTimestampSec}:R>)**`
                            )
                            .setColor("#2ecc71"); 

                        // 3. Deshabilitar todos los botones
                        const disabledRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('disabled_reschedule')
                                .setLabel('Ciclo Reiniciado')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('disabled_timear')
                                .setLabel('Timeado')
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(true)
                        );

                        await interaction.message.edit({ 
                            embeds: [newEmbed], 
                            components: [disabledRow] 
                        });
                    }
                    
                } else {
                    await interaction.followUp({ content: '❌ Error: Graffiti no encontrado o ya eliminado.', ephemeral: true });
                }
            }

        } catch (error) {
            console.error("Error al manejar interacción de botón:", error);
            await interaction.followUp({ content: '❌ Ocurrió un error al procesar el botón.', ephemeral: true });
        }
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
    
    // Iniciar el temporizador SÓLO cuando el cliente esté listo
    client.once('ready', () => {
        console.log(`✅ Bot ${client.user.tag} está listo y en línea.`);
        
        checkGraffitiAlerts();
        setInterval(checkGraffitiAlerts, 60 * 1000); 
        console.log(`✅ Tarea de verificación de alertas iniciada (cada 1 minuto).`);
    });

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
