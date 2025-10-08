import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  REST,
  Routes,
} from "discord.js";
import dotenv from "dotenv";
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
        .setRequired(true)
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

    // Calcular horarios posibles (+12h, +13h, +14h)
    const horariosPosibles = [12, 13, 14].map((sum) => {
      const totalMin = hora * 60 + minutos + sum * 60;
      const nuevaHora = Math.floor((totalMin / 60) % 24);
      const nuevosMinutos = totalMin % 60;
      return `${String(nuevaHora).padStart(2, "0")}:${String(
        nuevosMinutos
      ).padStart(2, "0")}`;
    });

    const embed = new EmbedBuilder()
      .setTitle("📍 Reporte de Graffiti")
      .setColor("#2ecc71")
      .addFields(
        { name: "Ubicación", value: ubicacion, inline: true },
        { name: "Hora", value: `${horaStr}`, inline: true },
        { name: "Número", value: numero.toString(), inline: true },
        { name: "Posibles horarios", value: horariosPosibles.join(" | ") }
      )
      .setFooter({ text: "Sistema de reportes - GraffBot" });

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);
