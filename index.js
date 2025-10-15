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
import mongoose from "mongoose"; // <-- Importar Mongoose
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
      unique: true, 
      lowercase: true 
  },
  // Almacenamos el timestamp Unix en milisegundos
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
      // Si la conexión falla, se termina la aplicación.
      process.exit(1); 
  }
}

// ----------------------------------------
// FUNCIONES DE UTILIDAD
// ----------------------------------------

/**
* Función de utilidad para obtener el timestamp Unix (en segundos)
*/
const getUnixTimestampSec = (date) => Math.floor(date.getTime() / 1000);

/**
* Calcula el próximo momento de aparición (+12h, ajustando si ya pasó).
*/
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
      .addIntegerOption((option) =>
          option.setName("numero").setDescription("Número identificador").setRequired(false)
      ),
      
  // 2. Comando /SETGRAF (AÑADE/ACTUALIZA LA HORA UTC EN LA DB)
  new SlashCommandBuilder()
      .setName("setgraf")
      .setDescription("Registra el spawn de un graffiti en el momento actual (UTC).")
      .addStringOption((option) =>
          option
              .setName("nombre")
              .setDescription("Nombre completo del punto de graffiti (ej: davis canales)")
              .setRequired(true)
      ),
      
  // 3. Comando /NEXTGRAFF (BUSCA EN LA DB)
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
      // ID de Guild Hardcodeado (asegúrate de que este es el ID de tu servidor de prueba)
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
      const nombre = interaction.options.getString("nombre").toLowerCase();
      const currentTimestampMs = Date.now();
      
      try {
          // 1. Guardar/Actualizar el documento en la DB (Persistencia)
          await Graffiti.findOneAndUpdate(
              { nombre: nombre },
              { lastSpawnTimestamp: currentTimestampMs },
              { upsert: true, new: true } 
          );
          
          // 2. EXTRAER LA HORA Y MINUTOS UTC (HH:MM) para la respuesta
          const date = new Date(currentTimestampMs);
          const hubHour = String(date.getUTCHours()).padStart(2, '0');
          const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
          const hubTimeStr = `${hubHour}:${hubMinute}`;

          await interaction.editReply({ 
              content: `✅ Graffiti **${nombre.toUpperCase()}** registrado.\nÚltimo spawn **${hubTimeStr} HUB**`
          });

      } catch (error) {
          console.error("Error al registrar graffiti:", error);
          await interaction.editReply({ 
              content: `❌ Error al guardar el spawn de ${nombre}. Inténtalo de nuevo.`, 
          });
      }
  }

  // --- LÓGICA /NEXTGRAFF (LEE DE LA DB) ---
  else if (commandName === "nextgraff") {
      await interaction.deferReply(); 
      
      const filtro = interaction.options.getString("filtro").toLowerCase();
      const ventanaMinutos = interaction.options.getInteger("ventana");

      const now = Date.now();
      const futureLimit = now + (ventanaMinutos * 60 * 1000); 

      let bestMatch = null;
      let minDiffToLimit = Infinity; 
      
      try {
          // 1. Obtener grafitis desde la DB
          const allGraffiti = await Graffiti.find({ 
              nombre: { $regex: '^' + filtro, $options: 'i' } 
          });

          if (allGraffiti.length === 0) {
              return interaction.editReply({ 
                  content: `⚠️ No se encontraron grafitis que comiencen con **${filtro}** en la base de datos.`, 
              });
          }
          
          // 2. Iterar y encontrar el mejor match
          for (const item of allGraffiti) {
              const lastTimestampMs = item.lastSpawnTimestamp;

              const nextSpawnDate = calculateNextSpawn(lastTimestampMs);
              const nextSpawnTimeMs = nextSpawnDate.getTime();

              if (nextSpawnTimeMs >= now && nextSpawnTimeMs <= futureLimit) {
                  
                  const diffToLimit = futureLimit - nextSpawnTimeMs; 
                  
                  if (diffToLimit < minDiffToLimit) {
                      minDiffToLimit = diffToLimit;
                      bestMatch = {
                          nombre: item.nombre,
                          nextTime: nextSpawnDate,
                          lastTime: new Date(lastTimestampMs)
                      };
                  }
              }
          }
          
          // 3. Responder
          if (bestMatch) {
              const unixTimestampNext = getUnixTimestampSec(bestMatch.nextTime);
              const unixTimestampLast = getUnixTimestampSec(bestMatch.lastTime);

              const nextHourUTC = String(bestMatch.nextTime.getUTCHours()).padStart(2, '0');
              const nextMinuteUTC = String(bestMatch.nextTime.getUTCMinutes()).padStart(2, '0');
              const nextTimeStr = `${nextHourUTC}:${nextMinuteUTC}`;
              
              const embed = new EmbedBuilder()
                  .setColor("#2ecc71")
                  .setTitle(`➡️ El graffiti **${bestMatch.nombre.toUpperCase()}** está más cerca de reaparecer dentro de ${ventanaMinutos}min `)
                  .addFields(
                    {
                        name: "🕒 Aparece",
                        value: `**${nextTimeStr} HUB** (<t:${unixTimestampNext}:R>)`,
                        inline: false,
                    },
                    {
                        name: "📅 Último Registro",
                        value: `<t:${unixTimestampLast}:F>`,
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
      const numero = interaction.options.getInteger("numero");
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
              {
                  name: "🕐 Hora del Evento",
                  value: `HUB: \`${horaStr}\` (${discordTimestampFull})`,
                  inline: false,
              }
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

  // 1. Conectar a la base de datos
  await connectDB();
  
  // 2. Iniciar sesión en Discord
  await client.login(process.env.TOKEN);
  console.log(`✅ Conectado como ${client.user.tag}`);

  // 3. Iniciar el servidor Express (para el monitoreo 24/7)
  const app = express();
  app.get('/', (req, res) => res.send('Bot activo ✅'));
  
  const port = process.env.PORT || 3000; 

  app.listen(port, () => {
      console.log(`Servidor web Express activo en el puerto ${port}`);
  });
}

// Ejecutar la función principal para iniciar la aplicación.
main().catch(error => {
  console.error("Error fatal al iniciar la aplicación:", error);
  process.exit(1);
});