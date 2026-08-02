const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Database = require('better-sqlite3');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = new Database('database.sqlite');

// إنشاء جدول البيانات تلقائيًا إذا لم يكن موجودًا
db.prepare(`
    CREATE TABLE IF NOT EXISTS role_mappings (
        userId TEXT PRIMARY KEY,
        roleId TEXT UNIQUE,
        assignedAt TEXT,
        lastUpdated TEXT
    )
`).run();

console.log('متصل بقاعدة البيانات المحلية (SQLite) بنجاح.');

// تعريف الأوامر بالكامل مع إضافة الأيقونة والإيموجي
const commands = [
    new SlashCommandBuilder()
        .setName('giverole')
        .setDescription('ربط رتبة مخصصة بعضو محدد')
        .addUserOption(opt => opt.setName('user').setDescription('العضو المراد ربطه').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('الرتبة المخصصة').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('removerole')
        .setDescription('إلغاء ربط الرتبة المخصصة من عضو')
        .addUserOption(opt => opt.setName('user').setDescription('العضو المراد سحب الرتبة منه').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('roleowner')
        .setDescription('معرفة مالك رتبة معينة')
        .addRoleOption(opt => opt.setName('role').setDescription('الرتبة للاستعلام عنها').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('role')
        .setDescription('إدارة رتبتك المخصصة')
        .addSubcommand(sub => sub.setName('name').setDescription('تغيير اسم الرتبة').addStringOption(opt => opt.setName('new_name').setDescription('الاسم الجديد').setRequired(true)))
        .addSubcommand(sub => sub.setName('color').setDescription('تغيير لون الرتبة (Hex)').addStringOption(opt => opt.setName('hex').setDescription('كود اللون مثل #FF0000').setRequired(true)))
        .addSubcommand(sub => sub.setName('resetcolor').setDescription('إعادة اللون الافتراضي للرتبة'))
        .addSubcommand(sub => sub.setName('icon').setDescription('تغيير أيقونة الرتبة بصورة (يتطلب سيرفر Boost Tier 2)').addAttachmentOption(opt => opt.setName('image').setDescription('الصورة الجديدة للرتبة (اتركها فارغة للإزالة)')))
        .addSubcommand(sub => sub.setName('emoji').setDescription('تغيير إيموجي الرتبة الموحد (يتطلب سيرفر Boost Tier 2)').addStringOption(opt => opt.setName('emoji_char').setDescription('ضع إيموجي أساسي واحد فقط').setRequired(true)))
        .addSubcommand(sub => sub.setName('info').setDescription('عرض معلومات رتبتك المخصصة'))
].map(command => command.toJSON());

// دالة فحص وتحديث الأوامر في جميع السيرفرات المتواجد بها البوت
async function deployCommandsToAllGuilds() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('جاري إعادة تسجيل وتحديث الأوامر في السيرفرات...');
        const guilds = await client.guilds.fetch();
        
        for (const [guildId, guild] of guilds) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
            console.log(`تم تحديث الأوامر بنجاح في سيرفر: ${guild.name}`);
        }
    } catch (error) {
        console.error('حدث خطأ أثناء تسجيل الأوامر تلقائيًا:', error);
    }
}

client.once('ready', async () => {
    console.log(`تم تشغيل البوت بنجاح باسم: ${client.user.tag}`);
    await deployCommandsToAllGuilds();
});

client.on('guildCreate', async (guild) => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: commands }
        );
        console.log(`دخل البوت سيرفر جديد وتم تسجيل الأوامر تلقائيًا في: ${guild.name}`);
    } catch (error) {
        console.error(`فشل تسجيل الأوامر في السيرفر الجديد ${guild.name}:`, error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, guild, user } = interaction;

    const replyEmbed = (title, description, color = 0x0099ff) => {
        return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
    };

    // ==========================================
    // أوامر الإدارة (ADMINISTRATOR)
    // ==========================================
    if (commandName === 'giverole') {
        const targetUser = options.getUser('user');
        const targetRole = options.getRole('role');

        if (targetRole.position >= guild.members.me.roles.highest.position) {
            return interaction.reply({ embeds: [replyEmbed('خطأ في الصلاحيات', 'هذه الرتبة أعلى من رتبة البوت أو مساوية لها. يرجى رفع رتبة البوت في إعدادات السيرفر.', 0xff0000)], ephemeral: true });
        }

        const existingRole = db.prepare('SELECT * FROM role_mappings WHERE roleId = ?').get(targetRole.id);
        if (existingRole && existingRole.userId !== targetUser.id) {
            return interaction.reply({ embeds: [replyEmbed('الرتبة مشغولة', `هذه الرتبة مملوكة بالفعل لعضو آخر حالياً.`, 0xff0000)], ephemeral: true });
        }

        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO role_mappings (userId, roleId, assignedAt, lastUpdated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(userId) DO UPDATE SET roleId = excluded.roleId, lastUpdated = excluded.lastUpdated
        `).run(targetUser.id, targetRole.id, now, now);

        return interaction.reply({ embeds: [replyEmbed('تم الربط بنجاح', `تم تعيين رتبة ${targetRole} لتكون الرتبة المخصصة للعضو <@${targetUser.id}>.`, 0x00ff00)] });
    }

    if (commandName === 'removerole') {
        const targetUser = options.getUser('user');
        const result = db.prepare('DELETE FROM role_mappings WHERE userId = ?').run(targetUser.id);

        if (result.changes === 0) {
            return interaction.reply({ embeds: [replyEmbed('خطأ', 'هذا العضو لا يملك رتبة مخصصة مسجلة بالنظام.', 0xff0000)], ephemeral: true });
        }

        return interaction.reply({ embeds: [replyEmbed('تم إلغاء الربط', `تم سحب ملكية الرتبة المخصصة من <@${targetUser.id}>.`, 0x00ff00)] });
    }

    if (commandName === 'roleowner') {
        const targetRole = options.getRole('role');
        const mapping = db.prepare('SELECT * FROM role_mappings WHERE roleId = ?').get(targetRole.id);

        if (!mapping) {
            return interaction.reply({ embeds: [replyEmbed('معلومات الرتبة', 'هذه الرتبة غير مربوطة بأي عضو.', 0x333333)] });
        }

        return interaction.reply({ embeds: [replyEmbed('مالك الرتبة', `المالك الحالي لهذه الرتبة هو: <@${mapping.userId}>`, 0x0099ff)] });
    }

    // ==========================================
    // أوامر الأعضاء المخصصة (/role)
    // ==========================================
    if (commandName === 'role') {
        const subcommand = options.getSubcommand();
        
        const mapping = db.prepare('SELECT * FROM role_mappings WHERE userId = ?').get(user.id);
        if (!mapping) {
            return interaction.reply({ embeds: [replyEmbed('تنبيه', 'أنت لا تملك رتبة مخصصة في النظام. يرجى التواصل مع الإدارة.', 0xff0000)], ephemeral: true });
        }

        const userRole = guild.roles.cache.get(mapping.roleId);
        if (!userRole) {
            return interaction.reply({ embeds: [replyEmbed('خطأ', 'الرتبة المربوطة بحسابك لم تعد موجودة بالسيرفر.', 0xff0000)], ephemeral: true });
        }

        if (userRole.position >= guild.members.me.roles.highest.position) {
            return interaction.reply({ embeds: [replyEmbed('خطأ في صلاحيات البوت', 'رتبتك المخصصة أعلى من رتبة البوت الحالية، لا يمكنني تعديلها.', 0xff0000)], ephemeral: true });
        }

        try {
            const now = new Date().toISOString();

            if (subcommand === 'name') {
                const newName = options.getString('new_name');
                await userRole.setName(newName);
                db.prepare('UPDATE role_mappings SET lastUpdated = ? WHERE userId = ?').run(now, user.id);
                return interaction.reply({ embeds: [replyEmbed('تم التحديث', `تم تغيير اسم رتبتك بنجاح إلى: **${newName}**`, 0x00ff00)] });
            }

            if (subcommand === 'color') {
                const hexColor = options.getString('hex');
                if (!/^#?[0-9A-F]{6}$/i.test(hexColor)) {
                    return interaction.reply({ embeds: [replyEmbed('خطأ في اللون', 'يرجى إدخال كود اللون بشكل صحيح (مثال: #FF0000)', 0xff0000)], ephemeral: true });
                }
                await userRole.setColor(hexColor);
                db.prepare('UPDATE role_mappings SET lastUpdated = ? WHERE userId = ?').run(now, user.id);
                return interaction.reply({ embeds: [replyEmbed('تم التحديث', `تم تغيير لون رتبتك بنجاح إلى: **${hexColor}**`, 0x00ff00)] });
            }

            if (subcommand === 'resetcolor') {
                await userRole.setColor(0);
                db.prepare('UPDATE role_mappings SET lastUpdated = ? WHERE userId = ?').run(now, user.id);
                return interaction.reply({ embeds: [replyEmbed('تم إعادة تعيين اللون', 'تم إرجاع لون الرتبة إلى الافتراضي.', 0x00ff00)] });
            }

            if (subcommand === 'icon') {
                const attachment = options.getAttachment('image');
                
                if (!attachment) {
                    await userRole.setIcon(null);
                    db.prepare('UPDATE role_mappings SET lastUpdated = ? WHERE userId = ?').run(now, user.id);
                    return interaction.reply({ embeds: [replyEmbed('تم تحديث الأيقونة', 'تم إزالة أيقونة الرتبة بنجاح.', 0x00ff00)] });
                }

                await userRole.setIcon(attachment.url);
                db.prepare('UPDATE role_mappings SET lastUpdated = ? WHERE userId = ?').run(now, user.id);
                return interaction.reply({ embeds: [replyEmbed('تم تحديث الأيقونة', 'تم تعيين الصورة كأيقونة لرتبتك بنجاح.', 0x00ff00)] });
            }

            if (subcommand === 'emoji') {
                const emojiChar = options.getString('emoji_char');
                await userRole.setUnicodeEmoji(emojiChar);
                db.prepare('UPDATE role_mappings SET lastUpdated = ? WHERE userId = ?').run(now, user.id);
                return interaction.reply({ embeds: [replyEmbed('تم تحديث الرمز', `تم تعيين الرمز ${emojiChar} لرتبتك المخصصة.`, 0x00ff00)] });
            }

            if (subcommand === 'info') {
                const assignedTimestamp = Math.floor(new Date(mapping.assignedAt).getTime() / 1000);
                const updatedTimestamp = Math.floor(new Date(mapping.lastUpdated).getTime() / 1000);

                const infoEmbed = new EmbedBuilder()
                    .setTitle('معلومات رتبتك المخصصة')
                    .setColor(userRole.color || 0x0099ff)
                    .addFields(
                        { name: 'اسم الرتبة الحالي', value: `${userRole.name}`, inline: true },
                        { name: 'المنشن الخاص بها', value: `${userRole}`, inline: true },
                        { name: 'تاريخ إنشاء الربط', value: `<t:${assignedTimestamp}:R>`, inline: false },
                        { name: 'آخر تعديل بالنظام', value: `<t:${updatedTimestamp}:R>`, inline: false }
                    );
                return interaction.reply({ embeds: [infoEmbed] });
            }

        } catch (error) {
            // مسك الأخطاء الشائعة مثل عدم دعم السيرفر لخاصية الأيقونات (بدون Boost كافٍ)
            if (error.code === 50035 || error.message.includes('Boost')) {
                return interaction.reply({ embeds: [replyEmbed('ميزة غير مدعومة', 'فشل تعديل الأيقونة/الإيموجي. السيرفر الحالي لا يملك مستوى تعزيز (Server Boost Tier 2) لتفعيل هذه الخاصية للرتب.', 0xff0000)], ephemeral: true });
            }
            console.error(error);
            return interaction.reply({ embeds: [replyEmbed('فشل في التعديل', 'حدث خطأ غير متوقع أثناء محاولة التعديل، يرجى مراجعة الإدارة والتأكد من رتبة البوت.', 0xff0000)], ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
