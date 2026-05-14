#!/usr/bin/env node

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const profileArgIndex = args.indexOf("--profile");
const profile =
  profileArgIndex >= 0 && args[profileArgIndex + 1]
    ? args[profileArgIndex + 1]
    : process.env.OPENCLAW_PROFILE;

if (profileArgIndex >= 0) {
  args.splice(profileArgIndex, 2);
}

const topic = args.join(" ").trim();

if (!topic) {
  console.error("Usage: npm run party -- [--profile <profile>] <meeting topic>");
  process.exit(1);
}

const command = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
const openclawArgs = [
  ...(profile ? ["--profile", profile] : []),
  "agent",
  "--agent",
  "main",
  "--message",
  `/skill party_prompt ${topic}`,
];

const child = spawn(command, openclawArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`Failed to start OpenClaw CLI: ${error.message}`);
  console.error("Run `npm install` or install OpenClaw globally, then try again.");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
