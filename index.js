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
// CONSTANTES Y CONFIGURACIÓN
// ----------------------------------------
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * ONE_HOUR_MS;

// Imagenes del graff (LISTA COMPLETA)
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
    lastUserRegistered: { 
        type: String,
        default: 'Desconocido',
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
        return interaction.member.nickname || interaction.user.username;
    }
    return interaction.user.username;
};

// ----------------------------------------
// FUNCIÓN DE REPORTE INDIVIDUAL (Un mensaje por Grafiti) 🚀
// ----------------------------------------

async function checkGraffitiAlerts() {
    if (!ALERT_CHANNEL_ID) {
        console.error("❌ ALERT_CHANNEL_ID no está configurado.");
        return;
    }

    let targetChannel;
    try {
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
        const allGraffiti = await Graffiti.find({}).sort({ numero: 1 });
        
        console.log(`💬 Generando reporte individual para ${allGraffiti.length} grafitis...`);

        if (allGraffiti.length === 0) {
            return targetChannel.send(`⚠️ No hay grafitis registrados en la base de datos.`);
        }
        
        await targetChannel.send(`--- 📋 **INICIO DEL REPORTE (${new Date().toUTCString()})** ---`);
        
        for (const item of allGraffiti) {
            
            const lastSpawnTimestampMs = item.lastSpawnTimestamp;
            const lastSpawnDate = new Date(lastSpawnTimestampMs);
            
            // Calculamos el tiempo de desbloqueo a +12h 
            const unlockDate = calculateNextSpawn(lastSpawnTimestampMs, 12);
            const unlockTimestampSec = getUnixTimestampSec(unlockDate);
            const lastSpawnTimestampSec = getUnixTimestampSec(lastSpawnDate);
            
            // Hora HUB
            const hubHour = String(lastSpawnDate.getUTCHours()).padStart(2, '0');
            const hubMinute = String(lastSpawnDate.getUTCMinutes()).padStart(2, '0');
            const hubTimeStr = `${hubHour}:${hubMinute}`;
            
            // --- BÚSQUEDA DE LA IMAGEN ---
            const graffitiKey = `${item.numero}`; 
            const imageUrl = GRAFFITI_IMAGES[graffitiKey]; 
            // -----------------------------
            
            const description = 
                `⏰ **Hora registro:** <t:${lastSpawnTimestampSec}:F> (Timestamp)\n` +
                `> **HUB:** \`${hubTimeStr}\`\n` +
                `👤 **Registrado por:** ${item.lastUserRegistered || 'Desconocido'}\n` +
                `🔓 **Desbloqueo (+12h):** <t:${unlockTimestampSec}:F> **(<t:${unlockTimestampSec}:R>)**`;

            const embed = new EmbedBuilder()
                .setColor("#f1c40f")
                .setTitle(`🎨 N° ${item.numero} | ${item.nombre.toUpperCase()}`)
                .setDescription(description)
                .setTimestamp(lastSpawnDate);

            if (imageUrl) {
                embed.setImage(imageUrl); 
            }
            
            // Botón "Timear"
            const timearButton = new ButtonBuilder()
                // El customId necesita el número para la lógica de timear
                .setCustomId(`timear_${item.numero}`)
                .setLabel('Timear')
                .setStyle(ButtonStyle.Success);
            
            const row = new ActionRowBuilder().addComponents(timearButton);

            // Se envía UN MENSAJE por cada grafiti
            await targetChannel.send({ 
                embeds: [embed],
                components: [row]
            });
        }
        
        await targetChannel.send(`--- ✅ **FIN DEL REPORTE (${allGraffiti.length} grafitis)** ---`);
        console.log(`✅ Reporte individual de ${allGraffiti.length} grafitis enviado.`);

    } catch (error) {
        console.error("❌ Error en la tarea de reporte:", error);
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
        .setName("reportgraff")
        .setDescription("Manda un reporte completo de todos los grafitis en la base de datos.")
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
                        lastUserRegistered: displayName, 
                        $unset: { rescheduleCount: "" } 
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

                replyContent += `Último spawn registrado: **${hubTimeStr} HUB**. (Base de desbloqueo en 12h)`;

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
        
        // --- COMANDO /REPORTGRAFF (Llama a la función de reporte individual) ---
        else if (commandName === "reportgraff") {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                await checkGraffitiAlerts();
                await interaction.editReply({ content: "✅ Reporte individual de grafitis enviado al canal de alertas.", ephemeral: true });
            } catch (error) {
                console.error("Error al ejecutar /reportgraff:", error);
                await interaction.editReply({ content: "❌ Ocurrió un error al generar el reporte.", ephemeral: true });
            }
        }
        
        // --- LÓGICA /GRAF (Se mantiene sin cambios) ---
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
        const [action, numero] = interaction.customId.split('_');
        
        await interaction.deferUpdate();

        try {
            // ------------------------------------
            // LÓGICA BOTÓN "Timear"
            // ------------------------------------
            if (action === 'timear') {
                const nowTimestampMs = Date.now();

                // 1. Actualizar la BD: Nuevo timestamp, nuevo usuario registrado.
                const updatedGraffiti = await Graffiti.findOneAndUpdate(
                    { numero: numero },
                    { 
                        $set: { 
                            lastSpawnTimestamp: nowTimestampMs,
                            lastUserRegistered: displayName, 
                            $unset: { rescheduleCount: "" } 
                        }
                    },
                    { new: true }
                );

                if (updatedGraffiti) {
                    // El nuevo desbloqueo es +12h desde ahora
                    const unlockDate = calculateNextSpawn(updatedGraffiti.lastSpawnTimestamp, 12); 
                    const unlockTimestampSec = getUnixTimestampSec(unlockDate);
                    const lastSpawnTimestampSec = getUnixTimestampSec(new Date(nowTimestampMs));
                    
                    // Hora HUB
                    const lastSpawnDate = new Date(nowTimestampMs);
                    const hubHour = String(lastSpawnDate.getUTCHours()).padStart(2, '0');
                    const hubMinute = String(lastSpawnDate.getUTCMinutes()).padStart(2, '0');
                    const hubTimeStr = `${hubHour}:${hubMinute}`;
                    
                    // 2. Modificar el mensaje (ACTUALIZADO: Usamos EmbedBuilder.from para preservar la estética original)
                    
                    // Nueva descripción con los datos actualizados
                    const newDescription = 
                        `⏰ **Hora registro:** <t:${lastSpawnTimestampSec}:F> (Timestamp)\n` +
                        `> **HUB:** \`${hubTimeStr}\`\n` +
                        `👤 **Registrado por:** ${displayName}\n` + 
                        `🔓 **Desbloqueo (+12h):** <t:${unlockTimestampSec}:F> **(<t:${unlockTimestampSec}:R>)**`;
                    
                    const originalEmbed = interaction.message.embeds[0];
    
                    const newEmbed = EmbedBuilder.from(originalEmbed)
                        // SOLO CAMBIAMOS EL COLOR Y LA DESCRIPCIÓN. Título y Imagen se conservan.
                        .setDescription(newDescription)
                        .setTimestamp(lastSpawnDate); 
    
                    await interaction.message.edit({ 
                        embeds: [newEmbed], 
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
    
    client.once('ready', () => {
        console.log(`✅ Bot ${client.user.tag} está listo y en línea.`);
        console.log(`✅ El bot ahora opera bajo el comando /reportgraff para enviar un mensaje individual por cada grafiti.`);
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