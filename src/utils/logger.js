// src/utils/logger.js
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: 'info', // Log 'info' level and above (info, warn, error)
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }), // Log stack traces for errors
    format.splat(),
    format.json() // Log as JSON for easy parsing by log management systems
  ),
  defaultMeta: { service: 'g2a-cws-middleware' },
  transports: [
    // In production (like on Render), we want structured JSON logs.
    // In development, we want easy-to-read, colorful logs.
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ level, message, timestamp, stack }) => {
          if (stack) {
            // Print stack for errors
            return `${timestamp} ${level}: ${message}\n${stack}`;
          }
          return `${timestamp} ${level}: ${message}`;
        })
      ),
    }),
  ],
});

const requestLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.json()
  ),
  defaultMeta: { service: 'g2a-cws-middleware-request' },
  transports: [
    new transports.File({ filename: 'requests.log' })
  ],
});

module.exports = logger;
module.exports.requestLogger = requestLogger;