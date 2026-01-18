import { CommandHandler } from "../handler/handlers.js";
import {
  threadsController,
  usersController,
  economyController,
  expController,
  settingsController
} from "../database/controllers/index.js";
import config from "../BeatriceSetUp/config.js";

// أنواع الأحداث التي نسجلها
const TRACKED_EVENTS = new Set([
  "message",
  "message_reply",
  "message_reaction",
  "typ"
]);

export const listen = async ({ api, event, client }) => {
  try {
    if (!event) return;

    const {
      threadID,
      senderID,
      userID,
      from,
      type,
      body,
      isGroup
    } = event;

    // تجاهل رسائل البوت نفسه
    if (senderID === api.getCurrentUserID()) return;

    /* ======================
       ⚙️ Controllers (مرة واحدة)
    ====================== */
    const controllers = {
      Threads: threadsController({ api }),
      Users: usersController({ api }),
      Economy: economyController({ api, event }),
      Exp: expController({ api, event }),
      Settings: settingsController({ api })
    };

    /* ======================
       🧾 تسجيل المستخدم والكروب
    ====================== */
    if (TRACKED_EVENTS.has(type)) {
      if (isGroup && threadID) {
        controllers.Threads.create(threadID).catch(() => {});
      }

      const uid = senderID || userID || from;
      if (uid) controllers.Users.create(uid).catch(() => {});
    }

    const handler = new CommandHandler({
      api,
      event,
      ...controllers
    });

    /* ======================
       😀 Reactions
    ====================== */
    if (type === "message_reaction") {
      await handler.handleReaction();
      return;
    }

    /* ======================
       🌐 Events العامة
    ====================== */
    await handler.handleEvent();

    /* ======================
       💬 الرسائل فقط
    ====================== */
    if (type !== "message" && type !== "message_reply") return;
    if (!body || !body.trim()) return;

    /* ======================
       ⏱️ Rate Limit (مضاد سبام)
    ====================== */
    client.cooldowns ??= new Map();
    const now = Date.now();
    const last = client.cooldowns.get(senderID) || 0;

    // تأخير بسيط جداً لمنع التكرار السريع
    if (now - last < 700) return;
    client.cooldowns.set(senderID, now);

    /* ======================
       ⚡ نظام الردود (Reply)
    ====================== */
    let replyData = null;

    if (type === "message_reply" && event.messageReply) {
      replyData = client.handler?.reply?.get(event.messageReply.messageID);

      // انتهاء صلاحية الرد
      if (replyData && replyData.expireAt && Date.now() > replyData.expireAt) {
        client.handler.reply.delete(event.messageReply.messageID);
        replyData = null;
      }
    }

    // معالجة الردود (بدون التحقق من البادئة)
    if (replyData && replyData.name) {
      const cmd = client.commands?.get(replyData.name);
      if (cmd?.onReply) {
        try {
          await cmd.onReply({
            api,
            event,
            ...controllers,
            reply: replyData
          });
        } catch (err) {
          console.error(`❌ Reply Error [${replyData.name}]:`, err);
        }
      }
      return;
    }

    /* ======================
       ✂️ استخراج الأمر (بدون بادئة)
    ====================== */
    // هنا التغيير الجذري: نعتبر الرسالة كلها هي الأمر والمدخلات مباشرة
    const input = body.trim();
    const args = input.split(/\s+/);
    const commandName = args.shift()?.toLowerCase(); // الكلمة الأولى هي الأمر

    /* ======================
       🔐 Maintenance Mode
    ====================== */
    const globalSettings = controllers.Settings.getGlobalSettings?.();
    const isDeveloper = (config.ADMIN_IDS || []).some(
      id => String(id) === String(senderID)
    );

    if (globalSettings?.botEnabled === false && !isDeveloper) {
      return;
    }

    /* ======================
       🛡️ Admin Only Mode
    ====================== */
    if (isGroup && !isDeveloper) {
      const threadSettings = controllers.Settings.getThreadData?.(threadID);
      if (threadSettings?.adminOnly?.enabled) {
        const info = await api.getThreadInfo(threadID).catch(() => ({}));
        const isAdmin = info?.adminIDs?.some(a => a.id === senderID);
        if (!isAdmin) return;
      }
    }

    /* ======================
       🚀 تنفيذ الأمر
    ====================== */
    // نمرر البيانات للهاندلر ليتحقق هل "commandName" أمر حقيقي أم مجرد كلام
    event.commandName = commandName;
    event.args = args;

    if (config.DEBUG) {
      console.log("[DEBUG]", {
        type,
        senderID,
        commandName,
        args
      });
    }

    await handler.handleCommand();

  } catch (err) {
    console.error("❌ Listen Error:", err);
  }
};