// src/logger.js
const winston = require("winston");
const config = require("./config");

const { combine, timestamp, printf, colorize, align } = winston.format;

const logger = winston.createLogger({
  level: config.nodeEnv === "development" ? "debug" : "info",
  format: combine(
    colorize({ all: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    align(),
    printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`)
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
