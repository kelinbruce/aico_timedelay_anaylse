'use strict';

function logInfo(...args) {
  console.log(...args);
}

function logWarning(...args) {
  console.warn(...args);
}

function logError(...args) {
  console.error(...args);
}

module.exports = {
  logInfo,
  logWarning,
  logError,
};
