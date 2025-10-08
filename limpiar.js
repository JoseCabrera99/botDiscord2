import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        "983070967385423922"
      ),
      { body: [] }
    );
    console.log("🧹 Todos los comandos del servidor han sido eliminados.");
  } catch (err) {
    console.error(err);
  }
})();
