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
    // CAMBIO CLAVE: El número ahora es String para aceptar letras
    numero: { 
        type: String, 
        required: true, 
        unique: true //  identificador único
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

function calculateNextSpawn(lastTimestampMs) {
    const nextSpawnTimeMs = lastTimestampMs + (12 * 60 * 60 * 1000); 
    const nextSpawnDate = new Date(nextSpawnTimeMs);
    const now = new Date();

    if (nextSpawnDate < now) {
        nextSpawnDate.setTime(nextSpawnDate.getTime() + (24 * 60 * 60 * 1000));
    }
    
    return nextSpawnDate;
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
        .setDescription("Muestra el graffiti cuya reaparición está más cerca de la hora límite.")
        .addStringOption((option) =>
            option
                .setName("filtro")
                .setDescription("Texto con el que inicia el nombre (ej: davis, rancho)")
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("ventana")
                .setDescription("Tiempo en minutos para la ventana de búsqueda (ej: 20)")
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
            // Buscamos y actualizamos por el NUMERO (String)
            await Graffiti.findOneAndUpdate(
                { numero: numero }, 
                { 
                    nombre: nombre, 
                    lastSpawnTimestamp: spawnTimestampMs 
                }, 
                { upsert: true, new: true } 
            );
            
            // ... (Cálculo de la hora HUB)
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

    // --- LÓGICA /NEXTGRAFF ---
    else if (commandName === "nextgraff") {
        await interaction.deferReply(); 
        
        const filtro = interaction.options.getString("filtro").toLowerCase();
        const ventanaMinutos = interaction.options.getInteger("ventana");

        const now = Date.now();
        const futureLimit = now + (ventanaMinutos * 60 * 1000); 

        let bestMatch = null;
        let minDiffToLimit = Infinity; 
        const candidates = []; 
        const PROXIMITY_LIMIT_MS = 2 * 60 * 1000; 

        try {
            // ... (Búsqueda en la DB por nombre que comienza con el filtro)

            const allGraffiti = await Graffiti.find({ 
                nombre: { $regex: '^' + filtro, $options: 'i' } 
            });

            if (allGraffiti.length === 0) {
                return interaction.editReply({ 
                    content: `⚠️ No se encontraron grafitis que comiencen con **${filtro}** en la base de datos.`, 
                });
            }
            
            // 2. Iterar y encontrar todos los candidatos
            for (const item of allGraffiti) {
                const lastTimestampMs = item.lastSpawnTimestamp;

                const nextSpawnDate = calculateNextSpawn(lastTimestampMs);
                const nextSpawnTimeMs = nextSpawnDate.getTime();
                const diffToLimit = futureLimit - nextSpawnTimeMs; 

                if (nextSpawnTimeMs >= now && nextSpawnTimeMs <= futureLimit) {
                    
                    const candidate = {
                        nombre: item.nombre,
                        numero: item.numero,
                        nextTime: nextSpawnDate,
                        nextTimeMs: nextSpawnTimeMs,
                        lastTime: new Date(lastTimestampMs),
                        diffToLimit: diffToLimit
                    };
                    candidates.push(candidate);

                    if (diffToLimit < minDiffToLimit) {
                        minDiffToLimit = diffToLimit;
                        bestMatch = candidate;
                    }
                }
            }
            
            // 3. Procesar resultados
            if (candidates.length > 0) {
                
                const closestCandidates = candidates.filter(c => {
                    const timeDifference = Math.abs(c.nextTimeMs - bestMatch.nextTimeMs);
                    return timeDifference <= PROXIMITY_LIMIT_MS;
                });
                
                closestCandidates.sort((a, b) => a.nextTimeMs - b.nextTimeMs);

                const listItems = closestCandidates.map(c => {
                    const unixTimestampNext = getUnixTimestampSec(c.nextTime);
                    const nextHourUTC = String(c.nextTime.getUTCHours()).padStart(2, '0');
                    const nextMinuteUTC = String(c.nextTime.getUTCMinutes()).padStart(2, '0');
                    const nextTimeStr = `${nextHourUTC}:${nextMinuteUTC}`;

                    return `**Nº ${c.numero} | ${c.nombre.toUpperCase()}** - \`${nextTimeStr} HUB\` (<t:${unixTimestampNext}:R>)`;
                }).join('\n');

                const title = closestCandidates.length > 1 
                    ? `🎯 ${closestCandidates.length} Graffitis Aparecen Muy Cerca`
                    : `➡️ Próximo Spawn cerca de la ventana de ${ventanaMinutos} min`;
                
                const embed = new EmbedBuilder()
                    .setColor("#2ecc71")
                    .setTitle(title)
                    .setDescription(`Estos son los graffitis de **${filtro.toUpperCase()}** que reaparecerán con una diferencia máxima de 2 minutos, dentro de la ventana de ${ventanaMinutos} minutos.`)
                    .addFields(
                        {
                            name: "Lista de Spawns Cercanos",
                            value: listItems,
                            inline: false,
                        },
                        {
                             name: "📅 Último Registro del Primer Match",
                             value: `<t:${getUnixTimestampSec(bestMatch.lastTime)}:F>`,
                             inline: false,
                        }
                    )
                    .setFooter({ text: `Datos persistentes gracias a MongoDB` });

                await interaction.editReply({ embeds: [embed] });

            } else {
                 const startWindow = new Date(now);
                 const endWindow = new Date(futureLimit);

                 await interaction.editReply({ 
                     content: `⚠️ No se encontraron reapariciones para '${filtro}' entre las ${startWindow.toTimeString().substring(0, 5)} y las ${endWindow.toTimeString().substring(0, 5)} (UTC).`, 
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
        const baseTimestamp = getUnixTimestampSec(baseDate);
        const discordTimestampFull = `<t:${baseTimestamp}:F>`;
        
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