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
import mongoose from "mongoose"; // <-- AÑADIDO: Importar Mongoose
dotenv.config();

// ----------------------------------------
// ESQUEMA Y MODELO DE MONGOOSE (NUEVO)
// ----------------------------------------

// Definición de la estructura de un documento Graffiti
const GraffitiSchema = new mongoose.Schema({
  nombre: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true 
  },
  // Almacenamos el timestamp Unix en milisegundos de la última vez que apareció.
  lastSpawnTimestamp: { 
      type: Number, 
      required: true 
  },
}, {
  // Opción para no incluir campos de fecha de creación/actualización automáticas
  timestamps: false 
});

// Crear el Modelo que usaremos para interactuar con la DB
const Graffiti = mongoose.model('Graffiti', GraffitiSchema);

// ----------------------------------------
// CONEXIÓN A LA BASE DE DATOS (MODIFICADO)
// ----------------------------------------

async function connectDB() {
  try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("✅ Conexión a MongoDB Atlas establecida.");
  } catch (error) {
      console.error("❌ Error al conectar a MongoDB:", error);
      // El bot no debería iniciar si la DB falla.
      process.exit(1); 
  }
}

// ----------------------------------------
// FUNCIONES DE UTILIDAD (MODIFICADO)
// ----------------------------------------

/**
* Función de utilidad para obtener el timestamp Unix (en segundos)
* @param {Date} date - Objeto Date.
* @returns {number} Timestamp Unix en segundos.
*/
const getUnixTimestampSec = (date) => Math.floor(date.getTime() / 1000);

/**
* Calcula el próximo momento de aparición (en Date) para un punto.
* (La lógica de cálculo sigue siendo la misma)
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
// Registro de Comandos (SIN CAMBIOS)
// ---------------------------
const commands = [
  // 1. Comando /GRAF (Reporte original)
  new SlashCommandBuilder()
      .setName("graf")
      .setDescription("Crea un reporte de graffiti")
      .addStringOption((option) =>
          option.setName("ubicacion").setDescription("Ubicación del graff").setRequired(true)
      )
      .addStringOption((option) =>
          option.setName("hora").setDescription("Hora en formato 24h (ej: 20:05)").setRequired(true)
      )
      .addIntegerOption((option) =>
          option.setName("numero").setDescription("Número identificador").setRequired(false)
      ),
      
  // 2. Comando /SETGRAF
  new SlashCommandBuilder()
      .setName("setgraf")
      .setDescription("Registra el spawn de un graffiti en el momento actual (UTC).")
      .addStringOption((option) =>
          option
              .setName("nombre")
              .setDescription("Nombre completo del punto de graffiti (ej: davis canales)")
              .setRequired(true)
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

// Registrar comandos (SIN CAMBIOS)
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
      await rest.put(
          Routes.applicationGuildCommands(
              process.env.CLIENT_ID,
              "983070967385423922"
          ),
          { body: commands }
      );
      console.log("✅ Comandos actualizados.");
  } catch (err) {
      console.error(err);
  }
})();

// ---------------------------
// Manejo de Interacciones (MODIFICADO)
// ---------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const commandName = interaction.commandName;
  const horaStr = interaction.options.getString("hora"); 

  // --- LÓGICA /SETGRAF (MODIFICADA PARA USAR DB) ---
  if (commandName === "setgraf") {
      await interaction.deferReply({ ephemeral: true }); // Deferir respuesta ya que la DB es lenta
      
      const nombre = interaction.options.getString("nombre").toLowerCase();
      const currentTimestampMs = Date.now();
      
      try {
          // 1. Guardar/Actualizar el documento en la DB
          await Graffiti.findOneAndUpdate(
              { nombre: nombre },
              { lastSpawnTimestamp: currentTimestampMs },
              { upsert: true, new: true } // upsert: si no existe lo crea; new: devuelve el documento actualizado
          );
          
          // 2. EXTRAER LA HORA Y MINUTOS UTC (HH:MM) para la respuesta
          const date = new Date(currentTimestampMs);
          const hubHour = String(date.getUTCHours()).padStart(2, '0');
          const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
          const hubTimeStr = `${hubHour}:${hubMinute}`;

          await interaction.editReply({ 
              content: `✅ Graffiti **${nombre.toUpperCase()}** registrado.\nÚltimo spawn **${hubTimeStr} HUB**`, 
          });

      } catch (error) {
          console.error("Error al registrar graffiti:", error);
          await interaction.editReply({ 
              content: `❌ Error al guardar el spawn de ${nombre}. Inténtalo de nuevo.`, 
          });
      }
  }

  // --- LÓGICA /NEXTGRAFF (MODIFICADA PARA USAR DB) ---
  else if (commandName === "nextgraff") {
      await interaction.deferReply(); // Deferir respuesta
      
      const filtro = interaction.options.getString("filtro").toLowerCase();
      const ventanaMinutos = interaction.options.getInteger("ventana");

      const now = Date.now();
      const futureLimit = now + (ventanaMinutos * 60 * 1000); 

      let bestMatch = null;
      let minDiffToLimit = Infinity; 
      
      try {
          // 1. Obtener todos los grafitis que cumplen el filtro desde la DB
          const allGraffiti = await Graffiti.find({ 
              nombre: { $regex: '^' + filtro, $options: 'i' } // Busca que el nombre empiece con el filtro
          });

          if (allGraffiti.length === 0) {
              return interaction.editReply({ 
                  content: `⚠️ No se encontraron grafitis que comiencen con **${filtro}** en la base de datos.`, 
              });
          }
          
          // 2. Iterar y encontrar el mejor match
          for (const item of allGraffiti) {
              const lastTimestampMs = item.lastSpawnTimestamp;

              // Calcular la próxima hora de reaparición
              const nextSpawnDate = calculateNextSpawn(lastTimestampMs);
              const nextSpawnTimeMs = nextSpawnDate.getTime();

              // Verificar si está dentro de la ventana de búsqueda
              if (nextSpawnTimeMs >= now && nextSpawnTimeMs <= futureLimit) {
                  
                  // Encontrar el más cercano al LÍMITE (por debajo)
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
              
              const embed = new EmbedBuilder()
                  .setColor("#2ecc71")
                  .setTitle(`➡️ Próximo Spawn cerca de la ventana de ${ventanaMinutos} min`)
                  .setDescription(`El graffiti **${bestMatch.nombre.toUpperCase()}** está más cerca de reaparecer en la ventana de búsqueda.`)
                  .addFields(
                      {
                          name: "🕒 Aparece",
                          value: `HUB (UTC): <t:${unixTimestampNext}:T> (<t:${unixTimestampNext}:R>)`,
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

  // --- LÓGICA /GRAF (TU CÓDIGO ORIGINAL SIN MODIFICACIONES) ---
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
// INICIO DEL BOT (MODIFICADO para conectar DB primero)
// ----------------------------------------

connectDB().then(() => {
  client.login(process.env.TOKEN);
});

const app = express();

app.get('/', (req, res) => res.send('Bot activo ✅'));
app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor web activo en el puerto ${process.env.PORT || 3000}`);
});