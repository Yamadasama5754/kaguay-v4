import express from "express";
import fs from "fs";
import login from "@xaviabot/fca-unofficial";

const app = express();

// ✅ صفحة تأكيد التشغيل
app.get("/", (req, res) => {
  res.send("✅ السيرفر والبوت شغالين الآن");
});

// ✅ تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);

  // ✅ بعد تشغيل السيرفر، شغّل البوت
  startBot();
});

// ✅ دالة تشغيل البوت
function startBot() {
  console.log("🚀 بدء تشغيل البوت...");

  try {
    const appState = JSON.parse(fs.readFileSync("appstate.json", "utf-8"));

    login({ appState })
      .then(api => {
        console.log("✅ تم تسجيل الدخول بنجاح");

        api.listenMqtt(event => {
          console.log("📥 حدث جديد:", event);
          // هنا منطق التعامل مع الرسائل
        });
      })
      .catch(err => {
        console.error("❌ فشل تسجيل الدخول:", err);
      });
  } catch (err) {
    console.error("❌ خطأ في قراءة appstate.json:", err);
  }
}
