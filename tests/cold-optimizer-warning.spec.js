import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForLog(logs, pattern, timeout = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (pattern.test(logs.text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${pattern}.\n\nLogs:\n${logs.text}`);
}

test("cold SSR optimizer reload should not emit React invalid hook warnings", async ({
  request,
}) => {
  await rm("node_modules/.vite", { recursive: true, force: true });

  const reactPath = require.resolve("react");
  const reactDomPath = require.resolve("react-dom/package.json");
  const reactFromReactDomPath = require.resolve("react", {
    paths: [dirname(reactDomPath)],
  });

  expect(reactFromReactDomPath).toBe(reactPath);

  const port = await getFreePort();
  const logs = { text: "" };
  const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;

  const server = spawn(
    "pnpm",
    ["exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port)],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  server.stdout.on("data", (chunk) => {
    logs.text += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    logs.text += chunk.toString();
  });

  try {
    await waitForLog(logs, /ready in/);

    const coldResponse = await request.get(`http://127.0.0.1:${port}/`);
    const coldBody = await coldResponse.text();
    expect(coldResponse.status()).toBe(200);

    await waitForLog(logs, /new dependencies optimized/);
    await waitForLog(logs, /optimized dependencies changed/);

    const metadataText = await readFile(
      "node_modules/.vite/deps_ssr/_metadata.json",
      "utf8",
    );
    const metadata = JSON.parse(metadataText);
    expect(metadata.optimized.react.src).toContain("react@18.3.1");
    expect(metadata.optimized["react-dom/server"].src).toContain(
      "react-dom@18.3.1_react@18.3.1",
    );
    expect(
      metadata.optimized["astro/virtual-modules/transitions.js"],
    ).toBeTruthy();

    const warmResponse = await request.get(`http://127.0.0.1:${port}/`);
    const warmBody = await warmResponse.text();
    expect(warmResponse.status()).toBe(200);
    expect(warmBody).toContain("Server rendered React hook count:");
    expect(warmBody).toContain(">1</p>");

    await new Promise((resolve) => setTimeout(resolve, 1_000));

    test.info().annotations.push({
      type: "cold response bytes",
      description: String(Buffer.byteLength(coldBody)),
    });
    await test.info().attach("deps_ssr-metadata-summary.json", {
      body: JSON.stringify(
        {
          reactPath,
          reactFromReactDomPath,
          optimized: {
            react: metadata.optimized.react,
            "react-dom/server": metadata.optimized["react-dom/server"],
            "astro/virtual-modules/transitions.js":
              metadata.optimized["astro/virtual-modules/transitions.js"],
          },
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.log(logs.text);
    expect(logs.text).not.toContain("Invalid hook call");
    expect(logs.text).not.toContain(
      "Cannot read properties of null (reading 'useContext')",
    );
  } finally {
    await test.info().attach("astro-dev.log", {
      body: logs.text,
      contentType: "text/plain",
    });
    server.kill("SIGINT");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
});
