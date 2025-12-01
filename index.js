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
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalBuilder,
} from "discord.js";
import dotenv from "dotenv";
import express from 'express';
import mongoose from "mongoose";
dotenv.config();

// Ciclo de alerta fijo (12h, 13h, 14h, 15h)
const ALERT_HOURS_CYCLE = [12, 13, 14, 15];

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
    "S/N": "https://i.imgur.com/F94WobV.png",
    "ELYSIAN": "https://i.imgur.com/TSO3RCl.png",
    "AERO": "https://i.imgur.com/FI4ieDo.png",
    "TATAVIAM": "https://i.imgur.com/mL1CYiI.png",
    "PUERTA": "https://i.imgur.com/TKS6mYI.png",
    "MAZE": "https://i.imgur.com/3zB5YSP.png",
    "STRAW": "https://i.imgur.com/3OfFmXw.png",
};

// ----------------------------------------
// CONFIGURACIÓN DE DISCORD
// ----------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;

// --- VARIABLE GLOBAL PARA CACHÉ DEL CANAL ---
let alertChannelCache = null;

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

function calculateNextSpawn(lastTimestampMs, totalHours) {
    const nextSpawnTimeMs = lastTimestampMs + (totalHours * 60 * 60 * 1000);
    return new Date(nextSpawnTimeMs);
}

const getDisplayName = (interaction) => {
    if (interaction.member) {
        return interaction.member.nickname || interaction.user.username;
    }
    return interaction.user.username;
};

// ----------------------------------------
// TAREA PROGRAMADA DE AVISO 
// ----------------------------------------

async function checkGraffitiAlerts() {
    if (!ALERT_CHANNEL_ID) {
        console.error("❌ ALERT_CHANNEL_ID no está configurado.");
        return;
    }

    // Usar la caché si está disponible
    if (!alertChannelCache) {
        try {
            console.log("⚠️ Cache de canal vacío. Intentando recuperar...");
            alertChannelCache = await client.channels.fetch(ALERT_CHANNEL_ID);
        } catch (error) {
            console.error(`❌ Error crítico: No se puede obtener el canal ${ALERT_CHANNEL_ID}.`, error.message);
            return;
        }
    }
    
    const targetChannel = alertChannelCache;
    if (!targetChannel) return;

    const nowMs = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    const elevenMinutesMs = 11 * 60 * 1000;

    try {
        const allGraffiti = await Graffiti.find({});
        const alertsToSend = [];

        for (const item of allGraffiti) {
            for (const totalHours of ALERT_HOURS_CYCLE) {

                const unlockDate = calculateNextSpawn(item.lastSpawnTimestamp, totalHours);
                const unlockTimeMs = unlockDate.getTime();

                // Si el spawn de 15h ya pasó hace más de 11 minutos, ventana expirada.
                if (totalHours === 15 && unlockTimeMs < (nowMs - elevenMinutesMs)) {
                     break;
                }

                // Verificar si la hora de desbloqueo está entre 10 y 11 minutos
                if (unlockTimeMs > (nowMs + tenMinutesMs) && unlockTimeMs <= (nowMs + elevenMinutesMs)) {

                    const unlockTimestampSec = getUnixTimestampSec(unlockDate);

                    alertsToSend.push({
                        item: item,
                        offsetHours: totalHours,
                        unlockTime: `<t:${unlockTimestampSec}:t>`,
                        unlockRelative: `<t:${unlockTimestampSec}:R>`,
                    });
                    break;
                }
            }
        }

        if (alertsToSend.length > 0) {
            for (const alert of alertsToSend) {
                const item = alert.item;
                const graffitiKey = `${item.numero}`;
                const imageUrl = GRAFFITI_IMAGES[graffitiKey]; 

                const description =
                    `**Nº ${item.numero} | ${item.nombre.toUpperCase()}**\n` +
                    `> Offset: **+${alert.offsetHours}h** (Ciclo)\n` +
                    `> Desbloqueo: ${alert.unlockTime} **(${alert.unlockRelative})**`;

                const embed = new EmbedBuilder()
                    .setColor("#f1c40f")
                    .setTitle(`🚨 ¡AVISO DE DESBLOQUEO DE GRAFFITIS! (+${alert.offsetHours}h) 🚨`)
                    .setDescription(description)
                    .setTimestamp();

                if (imageUrl) {
                    embed.setImage(imageUrl);
                }

                await targetChannel.send({
                    content: `||@here||`,
                    embeds: [embed],
                });
            }
            console.log(`✅ Alerta de ${alertsToSend.length} grafitis enviada.`);
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
        .setName("timear")
        .setDescription("Abre un menú para timear grafitis que coincidan con un filtro.")
        .addStringOption(option =>
            option.setName("filtro")
                .setDescription("Texto para buscar en el nombre (ej: davis, rancho)")
                .setRequired(true) 
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
// MANEJO DE INTERACCIONES
// ---------------------------
client.on("interactionCreate", async (interaction) => {

    const displayName = getDisplayName(interaction).toUpperCase();

    // --- MANEJO DE COMANDOS DE BARRA ---
    if (interaction.isChatInputCommand()) {
        const commandName = interaction.commandName;

        // --- LÓGICA /TIMEAR  ---
        if (commandName === "timear") {
            await interaction.deferReply({ ephemeral: true });
            const filtro = interaction.options.getString("filtro");
            const MAX_OPTIONS = 25;
            const filteredGraffiti = await Graffiti.find({
                nombre: { $regex: filtro, $options: 'i' }
            }).sort({ numero: 1 }).limit(MAX_OPTIONS);

            if (filteredGraffiti.length === 0) {
                return interaction.editReply({ 
                    content: `⚠️ No se encontraron grafitis que coincidan con el filtro: **${filtro.toUpperCase()}**.`, 
                    ephemeral: true 
                });
            }

            const options = filteredGraffiti.map(g => ({
                label: `Nº ${g.numero} | ${g.nombre.toUpperCase()}`,
                value: g.numero, 
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('grafitti_selector')
                .setPlaceholder('Selecciona el graffiti a timear...')
                .addOptions(options);

            const desfaseInput = new TextInputBuilder()
                .setCustomId('desfase_input')
                .setLabel("Desfase (Minutos - Opcional)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder('Ej: 5 (Minutos transcurridos desde que apareció)');

            const modal = new ModalBuilder()
                .setCustomId('modal_timear_grafitti')
                .setTitle('⏱️ Timear Graffiti Rápido');

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);
            const desfaseRow = new ActionRowBuilder().addComponents(desfaseInput);

            modal.addComponents(selectRow, desfaseRow);
            try {
                await interaction.showModal(modal);
            } catch (error) {
                console.error("❌ ERROR CRÍTICO al mostrar el Modal:", error.message);
                
                // Enviamos un mensaje de error visible al usuario
                await interaction.editReply({ 
                    content: `❌ Error interno: No se pudo abrir el formulario. Revisa la consola del bot.`, 
                    ephemeral: true 
                });
            }
            return;
        }
        
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
                await Graffiti.findOneAndUpdate(
                    { numero: numero },
                    {
                        nombre: nombre,
                        lastSpawnTimestamp: spawnTimestampMs,
                    },
                    { upsert: true, new: true }
                );

                const date = new Date(spawnTimestampMs);
                const hubHour = String(date.getUTCHours()).padStart(2, '0');
                const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
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
        // --- LÓGICA /NEXTGRAFF ---
        else if (commandName === "nextgraff") {
            await interaction.deferReply();

            const filtro = interaction.options.getString("filtro");
            const minutesToAdd = interaction.options.getInteger("minutos");

            const nowMs = Date.now();
            const futureDateMs = nowMs + (minutesToAdd * 60 * 1000);

            const elevenHoursMs = 11 * 60 * 60 * 1000;
            const fiveMinutesBefore = 5;
            const CHUNK_SIZE = 5;

            const filteredAndPreparedGraffiti = [];

            try {
                const allGraffiti = await Graffiti.find({
                    nombre: { $regex: filtro, $options: 'i' }
                }).sort({ numero: 1 });

                if (allGraffiti.length === 0) {
                    return interaction.editReply({
                        content: `⚠️ No se encontraron grafitis que contengan el nombre: **${filtro.toUpperCase()}** en la base de datos.`,
                    });
                }

                for (const item of allGraffiti) {
                    const lastSpawnTimestampMs = item.lastSpawnTimestamp;

                    if (nowMs < (lastSpawnTimestampMs + elevenHoursMs)) {
                        continue;
                    }

                    const unlockDate = calculateNextSpawn(lastSpawnTimestampMs, 12);
                    const unlockMinutes = unlockDate.getUTCMinutes();
                    const targetMinutes = new Date(futureDateMs).getUTCMinutes();
                    
                    let isVeryClose = false;
                    let difference = (targetMinutes - unlockMinutes + 60) % 60;

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

                for (let i = 0; i < filteredAndPreparedGraffiti.length; i += CHUNK_SIZE) {
                    const chunk = filteredAndPreparedGraffiti.slice(i, i + CHUNK_SIZE);
                    let chunkMessages = [];
                    let chunkButtons = [];

                    chunk.forEach(data => {
                        chunkMessages.push(data.message);
                        if (data.isAlarm) {
                            chunkButtons.push(
                                new ButtonBuilder()
                                    .setCustomId(`timear_nextgraff_${data.item.numero}`)
                                    .setLabel(`🚨 Timear N° ${data.item.numero}`)
                                    .setStyle(ButtonStyle.Primary)
                            );
                        }
                    });

                    const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
                    const totalChunks = Math.ceil(filteredAndPreparedGraffiti.length / CHUNK_SIZE);

                    const embed = new EmbedBuilder()
                        .setColor("#3498db")
                        .setTitle(`⏳ Grafitis Cerca de Desbloqueo a las ${targetTimeStr} HUB`)
                        .setDescription(chunkMessages.join('\n\n').trim())
                        .setTimestamp()
                        .setFooter({ text: `Filtro: ${filtro.toUpperCase()} | Lote ${chunkNumber} de ${totalChunks}` });

                    const messagePayload = { embeds: [embed] };
                    
                    if (chunkButtons.length > 0) {
                        const buttonRow = new ActionRowBuilder().addComponents(chunkButtons);
                        messagePayload.components = [buttonRow];
                    }

                    if (!replySent) {
                        await interaction.editReply(messagePayload);
                        replySent = true;
                    } else {
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
            const horaStr = interaction.options.getString("hora");
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
                .addFields({
                    name: "⏰ Próximos Posibles Horarios (12h a 15h)",
                    value: horariosPosibles.map((h) =>
                        `**+${h.sum}h**\n> HUB (UTC): \`${h.hub}\` (${h.relative})`
                    ).join("\n\n"),
                    inline: false,
                })
                .setFooter({ text: "Midnight • Grafitti" });

            await interaction.reply({ embeds: [embed] });
        }
        return;
    }

    // --- MANEJO DE SUMISIÓN DEL MODAL  ---
    if (interaction.isModalSubmit() && interaction.customId === 'modal_timear_grafitti') {
        await interaction.deferReply();

        const selectedGraffitiNumber = interaction.fields.getString('grafitti_selector');
        const desfaseText = interaction.fields.getString('desfase_input');
        
        const desfase = parseInt(desfaseText) || 0;
        
        // CÁLCULO DEL NUEVO SPAWN
        const desfaseMs = desfase * 60 * 1000;
        const actualTimestampMs = Date.now();
        const spawnTimestampMs = actualTimestampMs - desfaseMs;
        
        try {
            const updatedGraffiti = await Graffiti.findOneAndUpdate(
                { numero: selectedGraffitiNumber },
                { lastSpawnTimestamp: spawnTimestampMs },
                { new: true }
            );

            if (!updatedGraffiti) {
                 return interaction.editReply(`❌ Error: No se encontró el graffiti con número **${selectedGraffitiNumber}**.`);
            }

            const date = new Date(spawnTimestampMs);
            const hubHour = String(date.getUTCHours()).padStart(2, '0');
            const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
            const hubTimeStr = `${hubHour}:${hubMinute}`;

            let replyContent = `✅ Graffiti **${updatedGraffiti.nombre.toUpperCase()} (Nº ${updatedGraffiti.numero})** timeado por **${displayName}**.\n`;

            if (desfase > 0) {
                replyContent += `*(${desfase} min de desfase aplicados).* \n`;
            }

            replyContent += `Último spawn registrado: **${hubTimeStr} HUB**. (Próximo aviso en ~12h)`;

            await interaction.editReply({ content: replyContent });
            
        } catch (error) {
            console.error("Error al timear graffiti desde el modal:", error);
            await interaction.editReply({
                content: `❌ Error al timear el graffiti **Nº ${selectedGraffitiNumber}**. Inténtalo de nuevo.`,
            });
        }
        return;
    }
    
    // --- MANEJO DE BOTONES ---
    if (interaction.isButton()) {
        const customId = interaction.customId;
        const parts = customId.split('_');
        const action = parts[0];

        let numero;
        let isNextGraffAction = false;

        if (action === 'timear' && parts[1] === 'nextgraff') {
            numero = parts[2];
            isNextGraffAction = true;
        } else {
             await interaction.deferUpdate();
             await interaction.followUp({ 
                 content: '⚠️ Interacción no válida o desactualizada.', 
                 ephemeral: true 
             });
            return;
        }

        try {
            await interaction.deferUpdate();
        } catch (error) {
            if (error.code === 10062) {
                console.log(`⚠️ Interacción expirada (Graffiti N°${numero}).`);
                try {
                    await interaction.followUp({
                        content: '⚠️ Esta interacción ha expirado (más de 15 minutos). Por favor, ejecuta **/nextgraff** de nuevo.',
                        ephemeral: true
                    });
                } catch (followUpError) {
                }                return; 
            }
            throw error;
        }

        try {
            if (action === 'timear' && isNextGraffAction) {
                const nowTimestampMs = Date.now();

                const updatedGraffiti = await Graffiti.findOneAndUpdate(
                    { numero: numero },
                    { $set: { lastSpawnTimestamp: nowTimestampMs } },
                    { new: true }
                );

                if (updatedGraffiti) {
                    const unlockDate = calculateNextSpawn(updatedGraffiti.lastSpawnTimestamp, 12);
                    const unlockTimestampSec = getUnixTimestampSec(unlockDate);

                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
                    let newDescription = newEmbed.data.description;

                    const timearConfirmation = `**✅ TIMEADO POR ${displayName}**\n> Nuevo Desbloqueo (12h): <t:${unlockTimestampSec}:t> (<t:${unlockTimestampSec}:R>)`;

                    if (newDescription) {
                        const lines = newDescription.split('\n');
                        let found = false;
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].includes(`Nº ${numero}`)) {
                                lines[i] = timearConfirmation;
                                found = true;
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
                        newDescription = lines.filter(line => line !== '---LINE_TO_REMOVE---').join('\n').trim();

                        newEmbed.setTitle(`✅ Graffiti N°${numero} - ${updatedGraffiti.nombre.toUpperCase()} TIMEADO`)
                                .setDescription(newDescription)
                                .setColor("#2ecc71");
                    }

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
                    await interaction.followUp({ content: '❌ Error: Graffiti no encontrado.', ephemeral: true });
                }
            }
        } catch (error) {
            console.error("Error al manejar interacción de botón:", error);
            await interaction.followUp({ content: '❌ Error al procesar el botón.', ephemeral: true });
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

    // Carga la caché e inicia el intervalo
    client.once('ready', async () => {
        console.log(`✅ Bot ${client.user.tag} está listo y en línea.`);

        try {
            if (ALERT_CHANNEL_ID) {
                alertChannelCache = await client.channels.fetch(ALERT_CHANNEL_ID);
                console.log(`✅ Canal de alertas (${ALERT_CHANNEL_ID}) cargado en memoria.`);
            } else {
                console.warn("⚠️ ALERT_CHANNEL_ID no definido en .env");
            }
        } catch (error) {
            console.error("❌ Error al cargar el canal de alertas inicial:", error);
        }

        checkGraffitiAlerts();
        setInterval(checkGraffitiAlerts, 60 * 1000);
        console.log(`✅ Tarea de verificación de alertas iniciada (cada 1 minuto).`);
    });

    // Inicia el servidor Express para mantener la conexión
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