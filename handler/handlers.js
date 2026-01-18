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
      /* ========= Prefix ========= */
      let prefix = this.config.prefix || ".";
      let threadData = null;

      try {
        threadData = await Threads.find(threadID);
        if (threadData?.data?.prefix) prefix = threadData.data.prefix;
      } catch (e) {
        console.warn("⚠️ Thread DB error:", e.message);
      }

      /* ========= onChat ========= */
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

      /* ========= Reply ========= */
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

      if (!commandName) return;

      /* ========= Command Resolve ========= */
      let command =
        this.commands.get(commandName) ||
        this.commands.get(this.aliases.get(commandName));

      // Group aliases
      if (!command && threadData?.data?.aliases) {
        for (const mainCmd in threadData.data.aliases) {
          if (threadData.data.aliases[mainCmd]?.includes(commandName)) {
            command = this.commands.get(mainCmd);
            break;
          }
        }
      }

      if (!command) {
        if (body?.startsWith(prefix)) {
          return this.handleCommandNotFound(api, threadID, messageID, prefix);
        }
        return;
      }

      /* ========= Permissions ========= */
      const isDeveloper = (this.config.ADMIN_IDS || []).includes(String(senderID));
      const security = await this.securityPipeline(command, event, isDeveloper);

      if (!security.allowed) {
        return api.sendMessage(security.response, threadID, messageID);
      }

      /* ========= Cooldown ========= */
      if (!isDeveloper) {
        const cd = command.cooldown || command.cooldowns || 5;
        const check = this.checkCooldown(command.name, senderID, cd);
        if (!check.allowed) {
          api.setMessageReaction("⏱️", messageID, () => {}, true);
          return api.sendMessage(
            `⏱️ | انتظر ${check.timeLeft} ثانية.`,
            threadID,
            messageID
          );
        }
      }

      /* ========= Execute ========= */
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
  async handleCommandNotFound(api, threadID, messageID, prefix) {
    api.setMessageReaction("❌", messageID, () => {}, true);
    return api.sendMessage(
      `❌ | الأمر غير موجود. اكتب ${prefix}مساعدة`,
      threadID,
      messageID
    );
  }

  handleCommandError(error, commandName) {
    const { api, event } = this.arguments;
    console.error(`❌ COMMAND CRASH [${commandName}]`, error);
    api.sendMessage(
      `❌ | حدث خطأ في الأمر: ${commandName}\n🛑 السبب: ${error.message}`,
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

    // Developer only
    if (command.role === 2 && !isDeveloper) {
      return { allowed: false, response: "⛔ | للمطور فقط." };
    }

    // Admin only
    if (command.role === 1 && isGroup && !isDeveloper) {
      try {
        const info = await api.getThreadInfo(threadID);
        const isAdmin = info?.adminIDs?.some(a => String(a.id) === String(senderID));
        if (!isAdmin) {
          return { allowed: false, response: "🛡️ | للمشرفين فقط." };
        }
      } catch {
        return { allowed: false, response: "⚠️ | فشل التحقق من الصلاحيات." };
      }
    }

    return { allowed: true };
  }
}