const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    PermissionFlagsBits
} = require("discord.js");
const fs = require("fs");
const fetch = require("node-fetch");

// ==========================
// CONFIGURATION & IDS
// ==========================

// IMPORTANT: Railway uses environment variables.
// Set TOKEN in Railway → Variables
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // Add this in Railway too

const ADMIN_ROLE_ID = "1515058338340278342";
const PREMIUM_ROLE_ID = "1517742225998614599";
const BYPASS_ROLE_ID = "1515058327845867581";

const STOCK_UPLOAD_CHANNEL_ID = "1535058513410265198";
const STOCK_UPDATE_CHANNEL_ID = "1535058625624670259";

// Data file
const DATA_FILE = "./data.json";

let data = {
    stock: [],
    cooldowns: {}
};

if (fs.existsSync(DATA_FILE)) {
    try {
        data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } catch (err) {
        console.error("Error reading data file:", err);
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function claimStockItem(client) {
    if (data.stock.length === 0) return null;

    const item = data.stock.shift();
    saveData();

    try {
        const updateChannel = await client.channels.fetch(STOCK_UPDATE_CHANNEL_ID);
        if (updateChannel) {
            const fileContent = data.stock.join("\n");
            const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), {
                name: "updated_stock.txt"
            });

            await updateChannel.send({
                content: `📦 **Stock Updated!** Remaining items: **${data.stock.length}**`,
                files: [attachment]
            });
        }
    } catch (err) {
        console.error("Failed to post stock update:", err);
    }

    return item;
}

// ==========================
// CLIENT
// ==========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================
// REGISTER SLASH COMMANDS
// ==========================
const commands = [
    new SlashCommandBuilder()
        .setName("sendpanel")
        .setDescription("Sends the Control Panel")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName("forcegenerate")
        .setDescription("Force generate an item")
        .addUserOption(option =>
            option.setName("target").setDescription("User").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName("resetcooldown")
        .setDescription("Reset cooldown")
        .addUserOption(option =>
            option.setName("target").setDescription("User").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log("Slash commands registered.");
    } catch (err) {
        console.error("Failed to register commands:", err);
    }
})();

// ==========================
// INTERACTIONS
// ==========================
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const member = interaction.member;
    const hasAdmin = member.roles.cache.has(ADMIN_ROLE_ID);

    if (interaction.commandName === "sendpanel") {
        if (!hasAdmin)
            return interaction.reply({ content: "❌ Admin only.", ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle("🎛️ Control Panel")
            .setDescription("Choose an option below.")
            .setColor(0x0099FF);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("btn_generate")
                .setLabel("🎁 Generate")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("btn_stock")
                .setLabel("📦 Stock")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: "Panel sent!", ephemeral: true });
    }

    if (interaction.commandName === "forcegenerate") {
        if (!hasAdmin)
            return interaction.reply({ content: "❌ Admin only.", ephemeral: true });

        const target = interaction.options.getUser("target");
        const item = await claimStockItem(client);

        if (!item)
            return interaction.reply({ content: "❌ Stock empty!", ephemeral: true });

        try {
            await target.send(`🎁 Admin generated:\n\`${item}\``);
            return interaction.reply({ content: `Sent to ${target.tag}`, ephemeral: true });
        } catch {
            return interaction.reply({
                content: `DM failed. Item: \`${item}\``,
                ephemeral: true
            });
        }
    }

    if (interaction.commandName === "resetcooldown") {
        if (!hasAdmin)
            return interaction.reply({ content: "❌ Admin only.", ephemeral: true });

        const target = interaction.options.getUser("target");
        delete data.cooldowns[target.id];
        saveData();

        return interaction.reply({ content: `Cooldown reset for ${target.tag}`, ephemeral: true });
    }
});

// ==========================
// BUTTON HANDLER
// ==========================
client.on("interactionCreate", async interaction => {
    if (!interaction.isButton()) return;

    const { customId, member, user } = interaction;

    if (customId === "btn_stock") {
        return interaction.reply({
            content: `📦 Stock: **${data.stock.length}**`,
            ephemeral: true
        });
    }

    if (customId === "btn_generate") {
        const hasBypass = member.roles.cache.has(BYPASS_ROLE_ID);
        const hasPremium = member.roles.cache.has(PREMIUM_ROLE_ID);

        let cooldownTime = 6 * 60 * 60 * 1000;
        if (hasBypass) cooldownTime = 0;
        else if (hasPremium) cooldownTime = 1 * 60 * 60 * 1000;

        const lastUsed = data.cooldowns[user.id] || 0;
        const now = Date.now();

        if (!hasBypass && now - lastUsed < cooldownTime) {
            const remaining = cooldownTime - (now - lastUsed);
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);

            return interaction.reply({
                content: `⏳ Cooldown: **${hours}h ${minutes}m ${seconds}s**`,
                ephemeral: true
            });
        }

        const item = await claimStockItem(client);
        if (!item)
            return interaction.reply({ content: "❌ Stock empty!", ephemeral: true });

        data.cooldowns[user.id] = now;
        saveData();

        try {
            await user.send(`🎉 Your account:\n\`${item}\``);
            return interaction.reply({ content: "Sent to DMs!", ephemeral: true });
        } catch {
            return interaction.reply({ content: "Open your DMs!", ephemeral: true });
        }
    }
});

// ==========================
// STOCK UPLOAD
// ==========================
client.on("messageCreate", async message => {
    if (message.channelId !== STOCK_UPLOAD_CHANNEL_ID || message.author.bot) return;

    const attachment = message.attachments.first();
    if (!attachment || !attachment.name.endsWith(".txt")) return;

    try {
        const response = await fetch(attachment.url);
        const text = await response.text();

        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        data.stock.push(...lines);
        saveData();

        await message.channel.send(`Added **${lines.length}** items. Total: **${data.stock.length}**`);
    } catch (err) {
        console.error(err);
        await message.channel.send("❌ Failed to process file.");
    }
});

// ==========================
// READY
// ==========================
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
