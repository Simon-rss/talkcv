import { execSync } from "node:child_process";
import vinext from "vinext";
import { defineConfig } from "vite";

function resolveBuildSha(): string {
  try {
    const out = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (out) return out;
  } catch {
    // fallback below
  }
  const ciSha = process.env.WORKERS_CI_COMMIT_SHA?.trim();
  if (ciSha) return ciSha.slice(0, 7);
  return "dev";
}

const buildSha = resolveBuildSha();
const buildTime = new Date().toISOString();

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      __BUILD_SHA__: JSON.stringify(buildSha),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
        },
      }),
    ],
  };
});
