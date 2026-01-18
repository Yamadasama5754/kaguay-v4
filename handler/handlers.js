import { log } from "../logger/index.js";

export class CommandHandler {

  constructor({ api, event, Threads, Users, Economy, Exp, Settings }) {
    this.arguments = { api, event, Users, Threads, Economy, Exp, Settings };

    this.client = global.client || {};
    this.config = this.client.config || {};

    this.commands = this.client.commands || new Map();
    this.aliases  = this.client.aliases  || new Map();
    this.events   = this.client.events   || new Map();

    // Cooldowns
    if (!this.client.cooldowns) this.client.cooldowns = new Map();
    this.cooldowns = this.client.cooldowns;

    // Handler memory
    if (!this.client.handler) this.client.handler = {};
    if (!this.client.handler.reply) this.client.handler.reply = new Map();
    if (!this.client.handler.reactions) this.client.handler.reactions = new Map();
    if (!this.client.handler.stats) {
      this.client.handler.stats = { commandsExecuted: 0, eventsProcessed: 0 };
    }

    this.handler = this.client.handler;
  }

  /* ======================
     🕒 Cooldown
  ====================== */
  checkCooldown(commandName, userID, cooldownSeconds) {
    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Map());
    }

    const users = this.cooldowns.get(commandName);
    const now = Date.now();
    const cooldown = cooldownSeconds * 1000;
    const lastUsed = users.get(userID);

    if (lastUsed && now - lastUsed < cooldown) {
      const timeLeft = ((cooldown - (now - lastUsed)) / 1000).toFixed(1);
      return { allowed: false, timeLeft };
    }

    users.set(userID, now);
    return { allowed: true };
  }

  /* ======================
     🚀 handleCommand
  ====================== */
  async handleCommand() {
    const { api, event, Threads } = this.arguments;
    const { threadID, senderID, messageID, body } = event;

    const commandName = event.commandName;
    const args = event.args || [];

    try {
      /* ========= onChat (المهام الخلفية) ========= */
      // يتم تشغيلها مع كل رسالة (مثل نظام الليفل أو الرد التلقائي)
      const onChatTasks = [];
      for (const [name, cmd] of this.commands) {
        if (cmd?.onChat) {
          onChatTasks.push(
            cmd.onChat({ ...this.arguments })
              .catch(err => console.error(`❌ onChat [${name}]`, err.message))
          );
        }
      }
      await Promise.all(onChatTasks);

      /* ========= Reply System ========= */
      // التعامل مع الردود إذا لم يكن هناك أمر صريح
      if (!commandName && event.type === "message_reply") {
        const reply = this.handler.reply.get(event.messageReply?.messageID);
        if (reply?.name) {
          const cmd = this.commands.get(reply.name);
          if (cmd?.onReply) {
            await cmd.onReply({ ...this.arguments, reply });
            return;
          }
        }
      }

      // إذا لم يكن هناك اسم أمر، نتوقف هنا (تجاهل الرسالة)
      if (!commandName) return;

      /* ========= البحث عن الأمر ========= */
      let threadData = null;
      try {
         threadData = await Threads.find(threadID);
      } catch {}

      let command =
        this.commands.get(commandName) ||
        this.commands.get(this.aliases.get(commandName));

      // دعم الأسماء المستعارة الخاصة بالمجموعة (Group Aliases)
      if (!command && threadData?.data?.aliases) {
        for (const mainCmd in threadData.data.aliases) {
          if (threadData.data.aliases[mainCmd]?.includes(commandName)) {
            command = this.commands.get(mainCmd);
            break;
          }
        }
      }

      // 🛑 التغيير الجذري هنا:
      // إذا لم يتم العثور على الأمر، نخرج بصمت (return)
      // لا نرسل "الأمر غير موجود" لأننا في نظام بدون بادئة
      if (!command) {
        return; 
      }

      /* ========= التحقق من الصلاحيات (Permissions) ========= */
      const isDeveloper = (this.config.ADMIN_IDS || []).includes(String(senderID));
      const security = await this.securityPipeline(command, event, isDeveloper);

      if (!security.allowed) {
        return api.sendMessage(security.response, threadID, messageID);
      }

      /* ========= التحقق من التهدئة (Cooldown) ========= */
      if (!isDeveloper) {
        const cd = command.cooldown || command.cooldowns || 5;
        const check = this.checkCooldown(command.name, senderID, cd);
        if (!check.allowed) {
          api.setMessageReaction("⏱️", messageID, () => {}, true);
          return api.sendMessage(
            `⏱️ | اهدأ قليلاً! انتظر ${check.timeLeft} ثانية.`,
            threadID,
            messageID
          );
        }
      }

      /* ========= تنفيذ الأمر (Execute) ========= */
      await command.execute({ ...this.arguments, args });

      this.handler.stats.commandsExecuted++;

    } catch (error) {
      this.handleCommandError(error, commandName);
    }
  }

  /* ======================
     ⚙️ handleEvent
  ====================== */
  async handleEvent() {
    const tasks = [];

    for (const [name, eventObj] of this.events) {
      if (eventObj?.execute) {
        tasks.push(
          eventObj.execute({ ...this.arguments })
            .catch(e => console.error(`❌ Event [${name}]`, e.message))
        );
      }
    }

    for (const [name, cmd] of this.commands) {
      if (cmd?.event) {
        tasks.push(
          cmd.event({ ...this.arguments })
            .catch(e => console.error(`❌ Cmd-Event [${name}]`, e.message))
        );
      }
    }

    await Promise.all(tasks);
    this.handler.stats.eventsProcessed++;
  }

  /* ======================
     🔧 Helpers
  ====================== */
  
  handleCommandError(error, commandName) {
    const { api, event } = this.arguments;
    console.error(`❌ COMMAND CRASH [${commandName}]`, error);
    api.sendMessage(
      `❌ | حدث خطأ أثناء تنفيذ: ${commandName}\n🛑 السبب: ${error.message}`,
      event.threadID,
      event.messageID
    );
  }

  async handleReaction() {
    const { event } = this.arguments;
    const reactionData = this.handler.reactions.get(event.messageID);
    if (!reactionData) return;

    const command = this.commands.get(reactionData.name);
    if (command?.onReaction) {
      await command.onReaction({ ...this.arguments, reaction: reactionData });
    }
  }

  async securityPipeline(command, event, isDeveloper) {
    const { api } = this.arguments;
    const { threadID, senderID, isGroup } = event;

    // Developer only (Role 2)
    if (command.role === 2 && !isDeveloper) {
      return { allowed: false, response: "⛔ | هذا الأمر للمطورين فقط." };
    }

    // Admin only (Role 1)
    if (command.role === 1 && isGroup && !isDeveloper) {
      try {
        const info = await api.getThreadInfo(threadID);
        const isAdmin = info?.adminIDs?.some(a => String(a.id) === String(senderID));
        if (!isAdmin) {
          return { allowed: false, response: "🛡️ | هذا الأمر للمشرفين فقط." };
        }
      } catch {
        return { allowed: false, response: "⚠️ | فشل التحقق من الصلاحيات." };
      }
    }

    return { allowed: true };
  }
}