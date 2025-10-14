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

// ---------------------------
// Registro del comando /graff
// ---------------------------
const commands = [
  new SlashCommandBuilder()
    .setName("graf")
    .setDescription("Crea un reporte de graffiti")
    .addStringOption((option) =>
      option
        .setName("ubicacion")
        .setDescription("Ubicación del graff")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("hora")
        .setDescription("Hora en formato 24h (ej: 20:05)")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("numero")
        .setDescription("Número identificador")
        .setRequired(false)
    ),
].map((command) => command.toJSON());

// Registrar comando en tu servidor 
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
    console.log("✅ Comando /graff actualizado (usa hora con minutos).");
  } catch (err) {
    console.error(err);
  }
})();

// ---------------------------
// Manejo del comando 
// ---------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "graf") {
    const ubicacion = interaction.options.getString("ubicacion");
    const horaStr = interaction.options.getString("hora"); 
    const numero = interaction.options.getInteger("numero");

    // Validar formato HH:MM 
    const match = horaStr.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      return interaction.reply({
        content: "⚠️ Formato de hora inválido. Usa HH:MM (por ejemplo, 20:05)",
        ephemeral: true,
      });
    }

    const hora = parseInt(match[1]);
    const minutos = parseInt(match[2]);

    // Obtener la fecha UTC de hoy para la hora ingresada
    const today = new Date();
    const baseDate = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hora, minutos)
    );
    
    // Función para obtener el timestamp Unix (en segundos)
    const getUnixTimestamp = (date) => Math.floor(date.getTime() / 1000);

    // ------------------------------------------
    // 1. TIMESTAMP BASE (La hora ingresada)
    // ------------------------------------------
    const baseTimestamp = getUnixTimestamp(baseDate);
    const discordTimestampBase = `<t:${baseTimestamp}:F>`;

    // ------------------------------------------
    // 2. CÁLCULO DE HORARIOS POSIBLES
    // ------------------------------------------
    const diffs = [12, 13, 14];
    const horariosPosibles = diffs.map((sum) => {
      // Clona la fecha base y agrega las horas
      const newDate = new Date(baseDate.getTime());
      newDate.setUTCHours(baseDate.getUTCHours() + sum);
      
      // Hora UTC (HUB) formateada (HH:MM)
      const hubHora = String(newDate.getUTCHours()).padStart(2, "0");
      const hubMinutos = String(newDate.getUTCMinutes()).padStart(2, "0");
      const hubStr = `${hubHora}:${hubMinutos}`;
      
      // Hora local (TIMESTAMP)
      const localTimestamp = `<t:${getUnixTimestamp(newDate)}:F>`;
      
      return {
          hub: hubStr,
          local: localTimestamp,
      };
    });

    // ------------------------------------------
    // 3. CONSTRUCCIÓN del EMBED
    // ------------------------------------------
    const embed = new EmbedBuilder()
      .setColor("#9b59b6")
      .setTitle("🎨 Reporte de Graffiti")
      .setDescription(
        `📍 **Ubicación:** ${ubicacion}\n🔢 **Número:** ${numero}\n 🕒 **Hora HUB:** ${horaStr}\n 🕒 **Hora local:** ${discordTimestampBase}\n`
      )
      .addFields(
        {
          name: "⏰ Próximos Posibles Horarios",
          value: horariosPosibles.map((h, index) => 
            `**+${diffs[index]}h**\n> HUB (UTC): \`${h.hub}\`\n> Local (Tu zona): ${h.local}`
          ).join("\n\n"),
          inline: false,
        }
      )
      .setFooter({
        text: "Midnight • Grafitti",
      });

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);

const app = express();

app.get('/', (req, res) => res.send('Bot activo ✅'));
app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor web activo en el puerto ${process.env.PORT || 3000}`);
});