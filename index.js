require("dotenv").config();
const { start } = require("./src/app");

start().catch((err) => {
  console.error("Failed to start app:", err);
  process.exit(1);
});
