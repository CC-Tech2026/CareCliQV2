/**
 * Preload for Docker Expo: auto "Proceed anonymously" when Expo asks to log in.
 * Without a TTY, @expo/cli throws NON_INTERACTIVE instead of continuing.
 */
"use strict";

const Module = require("module");
const path = require("path");

const originalRequire = Module.prototype.require;

function isExpoPromptsModule(resolved) {
  const normalized = resolved.replace(/\\/g, "/");
  return (
    normalized.includes("/@expo/cli/") &&
    normalized.endsWith("/utils/prompts.js")
  );
}

function shouldProceedAnonymously(message) {
  const msg = String(message || "");
  return /log in with your Expo account|proceed anonymously|unverified-app/i.test(
    msg,
  );
}

Module.prototype.require = function dockerExpoRequire(id) {
  const exported = originalRequire.apply(this, arguments);

  let resolved;
  try {
    resolved = Module._resolveFilename(id, this);
  } catch {
    return exported;
  }

  if (!isExpoPromptsModule(resolved)) {
    return exported;
  }

  const cached = require.cache[resolved];
  if (!cached || cached.__carecliqDockerPatched) {
    return cached ? cached.exports : exported;
  }

  cached.__carecliqDockerPatched = true;
  const original = cached.exports;

  cached.exports = new Proxy(original, {
    get(target, prop, receiver) {
      if (prop === "selectAsync") {
        return async function selectAsyncDocker(message, choices, options) {
          if (shouldProceedAnonymously(message)) {
            process.stdout.write(
              "› Expo: proceeding anonymously (Docker non-interactive)\n",
            );
            return false;
          }
          return target.selectAsync(message, choices, options);
        };
      }
      if (prop === "default" || prop === "promptAsync") {
        const promptFn = target[prop] || target.default;
        return async function promptAsyncDocker(questions, options) {
          const list = Array.isArray(questions) ? questions : [questions];
          const first = list[0];
          const message = first && first.message;
          if (shouldProceedAnonymously(message)) {
            process.stdout.write(
              "› Expo: proceeding anonymously (Docker non-interactive)\n",
            );
            return { value: false };
          }
          return promptFn.call(target, questions, options);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return cached.exports;
};

// Keep path import referenced so bundlers/linters don't drop the file as unused.
void path;
