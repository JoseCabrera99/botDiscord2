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
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ----------------------------------------
// DATOS EN MEMORIA (AHORA ALMACENA TIMESTAMPS)
// ----------------------------------------

// Almacena: { "nombre_completo": timestamp_unix_ms }
// Comienza vacío, como solicitaste.
const graffitiData = {}; 

/**
* Función de utilidad para obtener el timestamp Unix (en segundos)
* @param {Date} date - Objeto Date.
* @returns {number} Timestamp Unix en segundos.
*/
const getUnixTimestampSec = (date) => Math.floor(date.getTime() / 1000);

/**
* Calcula el próximo momento de aparición (en Date) para un punto.
* Regla: Último registro + 12 horas, asegurando que el momento esté en el futuro.
* @param {number} lastTimestampMs - Timestamp Unix en milisegundos del último registro.
* @returns {Date} - Próxima fecha y hora de spawn (mínimo +12h).
*/
function calculateNextSpawn(lastTimestampMs) {
  const nextSpawnTimeMs = lastTimestampMs + (12 * 60 * 60 * 1000); // Sumar 12 horas en milisegundos
  const nextSpawnDate = new Date(nextSpawnTimeMs);
  const now = new Date();

  // Si la hora de reaparición base ya pasó (nextSpawnDate < now), 
  // significa que el próximo spawn es 24 horas después (sumar 24 horas)
  if (nextSpawnDate < now) {
      nextSpawnDate.setTime(nextSpawnDate.getTime() + (24 * 60 * 60 * 1000));
  }
  
  return nextSpawnDate;
}


// ---------------------------
// Registro de Comandos (ACTUALIZADO)
// ---------------------------
const commands = [
  // 1. Comando /GRAF (Reporte original - SIN MODIFICACIONES AQUÍ)
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
      
  // 2. Comando /SETGRAF (SÓLO NOMBRE - AÑADIDO)
  new SlashCommandBuilder()
      .setName("setgraf")
      .setDescription("Registra el spawn de un graffiti en el momento actual (UTC).")
      .addStringOption((option) =>
          option
              .setName("nombre")
              .setDescription("Nombre completo del punto de graffiti (ej: davis canales)")
              .setRequired(true)
      ),
      
  // 3. Comando /NEXTGRAFF (CON FILTRO Y VENTANA - AÑADIDO)
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

// Registrar comandos
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
      console.log("✅ Comandos actualizados (incluyendo /setgraf y /nextgraff).");
  } catch (err) {
      console.error(err);
  }
})();

// ---------------------------
// Manejo del comando (MODIFICADO /setgraf)
// ---------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const commandName = interaction.commandName;
  const horaStr = interaction.options.getString("hora"); 

  // --- LÓGICA /SETGRAF (MUESTRA HORA HUB HH:MM) ---
  if (commandName === "setgraf") {
      const nombre = interaction.options.getString("nombre").toLowerCase();
      
      // 1. Tomar el tiempo actual (UTC en milisegundos)
      const currentTimestampMs = Date.now();
      graffitiData[nombre] = currentTimestampMs;
      
      // 2. EXTRAER LA HORA Y MINUTOS UTC (HH:MM)
      const date = new Date(currentTimestampMs);
      const hubHour = String(date.getUTCHours()).padStart(2, '0');
      const hubMinute = String(date.getUTCMinutes()).padStart(2, '0');
      const hubTimeStr = `${hubHour}:${hubMinute}`;
      
      // 3. Formato para la respuesta (Solicitado: ultimo spawn 03:09 HUB)
      return interaction.reply({ 
          content: `✅ Graffiti **${nombre.toUpperCase()}** registrado.\nÚltimo spawn **${hubTimeStr} HUB**`, 
          ephemeral: true 
      });
  }

  // --- LÓGICA /NEXTGRAFF (Filtro y Ventana) ---
  else if (commandName === "nextgraff") {
      const filtro = interaction.options.getString("filtro").toLowerCase();
      const ventanaMinutos = interaction.options.getInteger("ventana");

      const now = Date.now();
      const futureLimit = now + (ventanaMinutos * 60 * 1000); // Límite de la ventana

      let bestMatch = null;
      let minDiffToLimit = Infinity; // Buscamos el más cercano al LÍMITE (por debajo)

      const filteredEntries = Object.entries(graffitiData).filter(([nombre]) => 
          nombre.startsWith(filtro)
      );

      if (filteredEntries.length === 0) {
          return interaction.reply({ 
              content: `⚠️ No se encontraron grafitis que comiencen con **${filtro}**.`, 
              ephemeral: true 
          });
      }
      
      // 1. Iterar sobre los grafitis filtrados
      for (const [nombre, lastTimestampMs] of filteredEntries) {
          const nextSpawnDate = calculateNextSpawn(lastTimestampMs);
          const nextSpawnTimeMs = nextSpawnDate.getTime();

          // 2. Verificar la condición: ¿Está dentro de la ventana de búsqueda?
          if (nextSpawnTimeMs >= now && nextSpawnTimeMs <= futureLimit) {
              
              // 3. Encontrar el más cercano al LÍMITE (por debajo)
              const diffToLimit = futureLimit - nextSpawnTimeMs; 
              
              if (diffToLimit < minDiffToLimit) {
                  minDiffToLimit = diffToLimit;
                  bestMatch = {
                      nombre: nombre,
                      nextTime: nextSpawnDate,
                      lastTime: new Date(lastTimestampMs)
                  };
              }
          }
      }
      
      // 4. Responder
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
              .setFooter({ text: `Ventana de búsqueda: ${new Date(now).toUTCString()} -> ${new Date(futureLimit).toUTCString()}` });

          await interaction.reply({ embeds: [embed] });

      } else {
           // 5. Caso si no hay coincidencias
           const startWindow = new Date(now);
           const endWindow = new Date(futureLimit);

           await interaction.reply({ 
               content: `⚠️ No se encontraron reapariciones para '${filtro}' entre las ${startWindow.toTimeString().substring(0, 5)} y las ${endWindow.toTimeString().substring(0, 5)} (UTC).`, 
               ephemeral: true 
           });
      }
  }

  // --- LÓGICA /GRAF (TU CÓDIGO ORIGINAL SIN MODIFICACIONES) ---
  else if (commandName === "graf") {
      
      // **TU LÓGICA DE VALIDACIÓN DE HORA ORIGINAL (RESTAURADA)**
      if (!horaStr) { // Necesitas esta validación ya que 'hora' es requerida para /graf
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
                      `${h.sum}h\n> HUB (UTC): \`${h.hub}\` (${h.relative})`
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
// WEB SERVER (Para UptimeRobot y Render)
// ----------------------------------------

client.login(process.env.TOKEN);

const app = express();

app.get('/', (req, res) => res.send('Bot activo ✅'));
app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor web activo en el puerto ${process.env.PORT || 3000}`);
});