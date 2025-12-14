// ================== Imports ==================
import fs from "fs";
import http from "http";
import login from "./logins/fcax/fb-chat-api/index.js";
import { listen } from "./listen/listen.js";
import { commandMiddleware, eventMiddleware } from "./middleware/index.js";
import { log, notifer } from "./logger/index.js";
import gradient from "gradient-string";
import config from "./BeatriceSetUp/config.js";
import EventEmitter from "events";
import axios from "axios";
import semver from "semver";

// ================== Globals ==================
global.botActive = true;
global.instanceID = process.env.INSTANCE_ID || Date.now().toString();

// ================== HTTP Keep Alive ==================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is alive!");
}).listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// ================== Utils ==================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ================== Core Class ==================
class Beatrice extends EventEmitter {
  constructor() {
    super();

    this.on("system:error", (err) => {
      log([
        { message: "[ ERROR ]: ", color: "red" },
        { message: err?.stack || err?.message || String(err), color: "white" }
      ]);
    });

    this.currentConfig = config;
    this.credentials = fs.readFileSync(
      "./BeatriceSetUp/BeatriceState.json",
      "utf8"
    );
    this.package = JSON.parse(fs.readFileSync("./package.json", "utf8"));

    this.checkCredentials();
  }

  // ================== Credentials ==================
  checkCredentials() {
    try {
      const parsed = JSON.parse(this.credentials);
      if (!Array.isArray(parsed) || !parsed.length) {
        throw new Error("AppState فارغ");
      }
    } catch {
      this.emit(
        "system:error",
        "❌ فشل قراءة BeatriceState.json (AppState غير صالح)"
      );
      process.exit(1);
    }
  }

  // ================== Version Check ==================
  async checkVersion() {
    try {
      console.log(
        gradient(["#ff00ff", "#ff99ff"])(`
█▀█ █▀█ █▀▀ █▀▀ █▀█ █ █▀█ █▀▀
█▄█ █▀▄ ██▄ █▄█ █▄█ █ █▄█ ██▄
`)
      );

      console.log(
        gradient(["#00ffff", "#ff00ff"])("✨ Developed by: Yamada KJ ✨")
      );

      try {
        const { data } = await axios.get(
          "https://raw.githubusercontent.com/Tshukie/Beatrice-Pr0ject/master/package.json",
          { timeout: 5000 }
        );
        if (semver.lt(this.package.version, data.version)) {
          log([
            { message: "[ SYSTEM ]: ", color: "yellow" },
            { message: "New update available", color: "white" }
          ]);
        }
      } catch {
        // تجاهل فشل الفحص
      }

      this.emit("system:run");
    } catch (err) {
      this.emit("system:error", err);
    }
  }

  // ================== Load Commands & Events ==================
  async loadComponents() {
    let failed = 0;

    try {
      await commandMiddleware();
      console.log(`✔ Commands loaded: ${global.client.commands.size}`);
    } catch (e) {
      failed++;
      console.error("❌ Commands load failed:", e.message);
    }

    try {
      await eventMiddleware();
      console.log(`✔ Events loaded: ${global.client.events.size}`);
    } catch (e) {
      failed++;
      console.error("❌ Events load failed:", e.message);
    }

    console.log("=".repeat(40));
    console.log(`✔ Commands: ${global.client.commands.size}`);
    console.log(`✔ Events: ${global.client.events.size}`);
    console.log(failed ? `❌ Failed: ${failed}` : "✔ All loaded successfully");
    console.log("=".repeat(40));
  }

  // ================== Start ==================
  start() {
    // ===== Process Title =====
    setInterval(() => {
      const t = process.uptime();
      const h = String(Math.floor(t / 3600)).padStart(2, "0");
      const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
      const s = String(Math.floor(t % 60)).padStart(2, "0");
      process.title = `Beatrice | ${h}:${m}:${s}`;
    }, 1000);

    (async () => {
      // ===== Global Client =====
      global.client = {
        commands: new Map(),
        events: new Map(),
        cooldowns: new Map(),
        aliases: new Map(),
        handler: {
          reply: new Map(),
          reactions: new Map()
        },
        config: this.currentConfig
      };

      await this.loadComponents();
      await this.checkVersion();

      // ===== On Run =====
      this.on("system:run", () => {
        login(
          { appState: JSON.parse(this.credentials) },
          async (err, api) => {
            if (err) {
              this.emit("system:error", err);
              return;
            }

            api.setOptions(this.currentConfig.options);

            // ✅ طباعة ID الحساب
            try {
              const user = await api.getCurrentUserID();
              console.log(`🤖 Bot logged in as ID: ${user}`);
            } catch {}

            // ===== MQTT Loop =====
            while (global.botActive) {
              try {
                const mqtt = await api.listenMqtt(async (err, event) => {
                  if (err) return;
                  if (!global.botActive) return;
                  await listen({ api, event, client: global.client });
                });

                await delay(this.currentConfig.mqtt_refresh || 600000);
                mqtt.stopListening();
                await delay(5000);
              } catch (e) {
                this.emit("system:error", e);
                await delay(10000);
              }
            }
          }
        );
      });
    })();
  }
}

// ================== Boot ==================
const BeatriceInstance = new Beatrice();
BeatriceInstance.start();