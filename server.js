// server.js
const express = require("express");
const app = express();

// ✅ استدعاء البوت من index.js
require("./index.js");

app.get("/", (req, res) => {
  res.send("✅ البوت شغال الآن - Uptime OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
