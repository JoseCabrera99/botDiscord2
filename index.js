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
    ComponentType,
} from "discord.js";
import dotenv from "dotenv";
import express from 'express';
import mongoose from "mongoose"; 
dotenv.config();

// ----------------------------------------
// CONFIGURACIÓN DE DISCORD
// ----------------------------------------

// Se añade GuildMessages para interactividad de botones
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] }); 
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID; 

// ----------------------------------------
// ESQUEMA Y MODELO DE MONGOOSE 
// ----------------------------------------

// rescheduleCount (0, 1, 2, 3 -> para +12h, +13h, +14h, +15h)
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
const getDisplayName = (interaction) => {
    if (interaction.member) {
        return interaction.member.nickname || interaction.user.username;
    }
    return interaction.user.username;
};
/**
* Calcula el tiempo exacto de desbloqueo teórico (12h + offset)
*/
function calculateNextSpawn(lastTimestampMs, offsetHours = 12) {
    const nextSpawnTimeMs = lastTimestampMs + (offsetHours * 60 * 60 * 1000); 
    return new Date(nextSpawnTimeMs);
}

// ----------------------------------------
// TAREA PROGRAMADA DE AVISO (CORREGIDA PARA CACHÉ)
// ----------------------------------------

async function checkGraffitiAlerts() {
    if (!ALERT_CHANNEL_ID) {
        console.error("❌ ALERT_CHANNEL_ID no está configurado. La tarea de alertas no puede ejecutarse.");
        return;
    }

    const nowMs = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    const elevenMinutesMs = 11 * 60 * 1000;
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;

    let targetChannel;
    try {
        // CORRECCIÓN DE CACHÉ: Usamos fetch() para asegurar que obtenemos el canal
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
            
            // Calculamos el tiempo de desbloqueo usando el offset
            const offsetMs = rescheduleCount * oneHourMs;
            const unlockTimeMs = item.lastSpawnTimestamp + twelveHoursMs + offsetMs; 
            const offsetHours = 12 + rescheduleCount;

            // Condición de aviso: El desbloqueo ocurre en el rango [Ahora + 10m, Ahora + 11m]
            if (unlockTimeMs > (nowMs + tenMinutesMs) && unlockTimeMs <= (nowMs + elevenMinutesMs)) {
                
                if (unlockTimeMs <= nowMs) continue; 
                
                const unlockDate = new Date(unlockTimeMs);
                const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                
                alertsToSend.push({
                    item: item,
                    offsetHours: offsetHours, 
                    unlockTime: `<t:${unlockTimestampSec}:t>`,
                    unlockRelative: `<t:${unlockTimestampSec}:R>`,
                });
            }
        }

        if (alertsToSend.length > 0) {
            
            for (const alert of alertsToSend) {
                const item = alert.item;
                const rescheduleCount = item.rescheduleCount || 0;
                // El límite para el contador es 3, que corresponde a +15h
                const isMaxed = rescheduleCount >= 3; 
                
                const description = 
                    `**Nº ${item.numero} | ${item.nombre.toUpperCase()}**\n` +
                    `> Offset: **+${alert.offsetHours}h** (actual)\n` +
                    `> Desbloqueo: ${alert.unlockTime} **(${alert.unlockRelative})**`;

                const embed = new EmbedBuilder()
                    .setColor("#f1c40f")
                    .setTitle(`🚨 ¡AVISO DE DESBLOQUEO DE GRAFFITIS! (+${alert.offsetHours}h) 🚨`)
                    .setDescription(description)
                    .setTimestamp();
                
                // Creación de los botones
                const nextCountDisplay = rescheduleCount + 1;
                const oneHourButton = new ButtonBuilder()
                    // Custom ID: 'reschedule_numeroDelGraf_rescheduleCount'
                    .setCustomId(`reschedule_${item.numero}_${rescheduleCount}`)
                    // Muestra el progreso (1/4 es para +13h, 4/4 es para +15h)
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
// MANEJO DE INTERACCIONES
// ---------------------------
client.on("interactionCreate", async (interaction) => {
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
                const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
                const hubTimeStr = `${hubHour}:${hubMinute}`;

                let replyContent = `✅ Graffiti **${nombre.toUpperCase()} (Nº ${numero})** registrado por ${displayName}.\n`;
                
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
            const allFilteredMessages = [];
            const nowMs = Date.now();
            
            const futureDateMs = nowMs + (minutesToAdd * 60 * 1000);
            const futureDate = new Date(futureDateMs);
            const targetMinutes = futureDate.getUTCMinutes(); 
            const targetHours = futureDate.getUTCHours(); 

            const targetTimeStr = `${String(targetHours).padStart(2, '0')}:${String(targetMinutes).padStart(2, '0')}`;
            
            const elevenHoursMs = 11 * 60 * 60 * 1000;
            const fiveMinutesBefore = 5; 
            const RESULTS_PER_FIELD = 5; 

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
                    
                    const unlockDate = calculateNextSpawn(lastSpawnTimestampMs, 12); // Usar 12h para simulación
                    
                    if (nowMs < (lastSpawnTimestampMs + elevenHoursMs)) {
                        continue; 
                    }
                    
                    const unlockMinutes = unlockDate.getUTCMinutes(); 
                    
                    let isVeryClose = false;
                    let difference = (targetMinutes - unlockMinutes + 60) % 60;
                
                    if (difference >= 0 && difference <= fiveMinutesBefore) {
                        isVeryClose = true;
                    }
                    
                    const highlightEmoji = isVeryClose ? "🚨 " : "";
                    const highlightText = isVeryClose ? "**" : "";

                    const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                    const registrationTimestampSec = getUnixTimestampSec(new Date(lastSpawnTimestampMs));
                    
                    const hubHour = String(new Date(lastSpawnTimestampMs).getUTCHours()).padStart(2, '0');
                    const hubMinute = String(new Date(lastSpawnTimestampMs).getUTCMinutes()).padStart(2, '0');
                    const hubTimeStr = `${hubHour}:${hubMinute}`;
                    
                    const itemMessage = 
                        `${highlightEmoji}${highlightText}Nº ${item.numero} | ${item.nombre.toUpperCase()}${highlightText}\n` +
                        `> Registrado: <t:${registrationTimestampSec}:F> (\`${hubTimeStr}\` HUB)\n` +
                        `> Desbloqueo (12h): <t:${unlockTimestampSec}:t> **(<t:${unlockTimestampSec}:R>)**`;

                    allFilteredMessages.push(itemMessage);
                }
                
                if (allFilteredMessages.length === 0) {
                     await interaction.editReply({ 
                         content: `⚠️ No se encontraron grafitis para **${filtro.toUpperCase()}** que hayan pasado el umbral de 11 horas desde su registro.`, 
                       });
                       return;
                }
                
                const totalMatches = allFilteredMessages.length;
                const embedsToSend = [];
                
                for (let i = 0; i < totalMatches; i += RESULTS_PER_FIELD) {
                    const chunk = allFilteredMessages.slice(i, i + RESULTS_PER_FIELD);
                    const isFirstEmbed = i === 0;
                    
                    const embed = new EmbedBuilder()
                        .setColor("#3498db")
                        .setDescription(chunk.join('\n\n').trim());
                    
                    if (isFirstEmbed) {
                        embed.setTitle(`⏳ Grafitis Cerca del Desbloqueo para "${filtro.toUpperCase()}" | Objetivo: ${targetTimeStr} HUB`)
                             .setTimestamp()
                    } 
                    
                    embedsToSend.push(embed);
                }

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
            
            const diffs = [12, 13, 14, 15]; // Rango de desbloqueo completo
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
        const [action, numero, countStr] = interaction.customId.split('_');
        
        await interaction.deferUpdate();

        try {
            // ------------------------------------
            // LÓGICA BOTÓN "1 hora +" (Desplazar Offset)
            // ------------------------------------
            if (action === 'reschedule') {
                const currentCount = parseInt(countStr);
                const newCount = currentCount + 1;
                // El límite de 3 (para llegar a +15h)
                const isMaxed = newCount >= 3; 
                
                // 1. Actualizar la BD (solo incrementamos el contador)
                const updatedGraffiti = await Graffiti.findOneAndUpdate(
                    { numero: numero },
                    { $inc: { rescheduleCount: 1 } },
                    { new: true } 
                );

                if (updatedGraffiti) {
                    const offsetHours = 12 + newCount;
                    // El nuevo desbloqueo se calcula con el offset actualizado
                    const newUnlockDate = calculateNextSpawn(updatedGraffiti.lastSpawnTimestamp, offsetHours); 
                    const newUnlockTimestampSec = getUnixTimestampSec(newUnlockDate);
                    
                    // 2. Modificar el mensaje (Embed y Botones)
                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setTitle(`🚨 AVISO DESPLAZADO POR ${interaction.user.tag.toUpperCase()} (+${offsetHours}h) 🚨`)
                        .setDescription(
                            `**Nº ${numero} | ${updatedGraffiti.nombre.toUpperCase()}**\n` +
                            `> Offset: **+${offsetHours}h** (actual)\n` +
                            `> Nuevo Desbloqueo: <t:${newUnlockTimestampSec}:t> **(<t:${newUnlockTimestampSec}:R>)**` +
                            (isMaxed ? '\n\n**⚠️ Límite de pospuestos (+15h) alcanzado.**' : '')
                        )
                        .setColor("#e67e22"); 

                    // 3. Modificar la fila de botones
                    const nextCountDisplay = newCount + 1;
                    const newOneHourButton = new ButtonBuilder()
                        .setCustomId(`reschedule_${numero}_${newCount}`)
                        .setLabel(`+1 hora (${nextCountDisplay}/4)`) 
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(isMaxed);

                    const newTimearButton = new ButtonBuilder()
                        .setCustomId(`timear_${numero}`)
                        .setLabel('Timear')
                        .setStyle(ButtonStyle.Success);

                    const newRow = new ActionRowBuilder().addComponents(newOneHourButton, newTimearButton);

                    await interaction.message.edit({ 
                        embeds: [newEmbed], 
                        components: [newRow] 
                    });
                } else {
                    await interaction.followUp({ content: '❌ Error: Graffiti no encontrado o ya eliminado.', ephemeral: true });
                }
            } 
            
            // ------------------------------------
            // LÓGICA BOTÓN "Timear" (Reinicia el ciclo)
            // ------------------------------------
            else if (action === 'timear') {
                const nowTimestampMs = Date.now();

                // 1. Actualizar la BD (se actualiza el spawn y se resetea el contador)
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
                    
                    // 2. Modificar el mensaje
                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
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
    
    // CORRECCIÓN: Iniciar el temporizador SÓLO cuando el cliente esté listo (evita errores de caché)
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