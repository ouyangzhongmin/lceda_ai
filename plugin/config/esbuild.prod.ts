import process from "node:process";
import esbuild from "esbuild";
import fs from "fs-extra";
import path from "node:path";

import common from "./esbuild.common";

function loadEnvFile(envPath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(envPath, "utf8");
    const env: Record<string, string> = {};
    content.split("\n").forEach((line: string) => {
      const normalized = line.trim();
      if (!normalized || normalized.startsWith("#")) {
        return;
      }
      const [key, ...values] = normalized.split("=");
      if (key && values.length > 0) {
        env[key.trim()] = values.join("=").trim();
      }
    });
    return env;
  } catch {
    return {};
  }
}

const nodeEnv = process.env.NODE_ENV || "development";
const envFiles = [path.resolve(`.env.${nodeEnv}`), path.resolve(".env")];

let envVars: Record<string, string> = {};
for (const envFile of envFiles) {
  const loaded = loadEnvFile(envFile);
  if (Object.keys(loaded).length > 0) {
    envVars = loaded;
    console.log(`Loaded environment from: ${envFile}`);
    break;
  }
}

common.define = {
  "process.env.SERVER_BASE_URL": JSON.stringify(
    process.env.SERVER_BASE_URL || envVars.SERVER_BASE_URL || "http://127.0.0.1:8080"
  ),
  "process.env.PLUGIN_CHANNEL": JSON.stringify(
    process.env.PLUGIN_CHANNEL || envVars.PLUGIN_CHANNEL || "standard"
  ),
  "process.env.NODE_ENV": JSON.stringify(
    process.env.NODE_ENV || envVars.NODE_ENV || "development"
  ),
};

(async () => {
  const ctx = await esbuild.context(common);
  if (process.argv.includes("--watch")) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    process.exit();
  }
})();
