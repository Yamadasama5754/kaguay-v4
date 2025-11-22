class Uptime {
  constructor() {
    this.name = "اوبتايم";
    this.author = "Yamada KJ & Alastor";
    this.cooldowns = 10;
    this.description = "عرض مدة تشغيل البوت";
    this.role = 0;
    this.aliases = ["uptime", "time_u", "upti"];
    
    // تتبع وقت بدء البوت
    if (!global.botStartTime) {
      global.botStartTime = Date.now();
    }
  }

  formatUptime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return `${days} يوم، ${hours} ساعة، ${minutes} دقيقة، ${seconds} ثانية`;
  }

  async execute({ api, event }) {
    try {
      api.setMessageReaction("⏱", event.messageID, (err) => {}, true);
      
      // استخدام global time أو process.uptime كـ fallback
      const uptimeMs = Date.now() - (global.botStartTime || Date.now());
      const uptimeFormatted = this.formatUptime(Math.max(0, uptimeMs));
      
      // معلومات إضافية
      const memoryUsage = process.memoryUsage();
      const heapUsed = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotal = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);
      const rss = (memoryUsage.rss / 1024 / 1024).toFixed(2);

      let message = `⏱ | مدة تشغيل البوت:\n`;
      message += `${uptimeFormatted}\n\n`;
      message += `💾 | استهلاك الذاكرة:\n`;
      message += `Heap: ${heapUsed}MB / ${heapTotal}MB\n`;
      message += `RSS: ${rss}MB\n`;
      message += `Node: ${process.version}`;

      api.setMessageReaction("✅", event.messageID, (err) => {}, true);
      return await api.sendMessage(message, event.threadID, event.messageID);
    } catch (err) {
      console.error("❌ خطأ في اوبتايم:", err);
      return api.sendMessage(`❌ خطأ: ${err.message}`, event.threadID);
    }
  }
}

export default new Uptime();
