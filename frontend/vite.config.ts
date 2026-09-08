import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import releaseDetails from "./src/pwa/release.json";

const builtAt = new Date().toISOString();
const release = { ...releaseDetails, builtAt,
  buildId: createHash("sha256").update(builtAt).update(JSON.stringify(releaseDetails)).digest("hex").slice(0, 20),
};

const PUBLIC_ASSETS = [
  "/manifest.webmanifest", "/offline.html", "/favicon.svg",
  "/icons/puls-light.svg", "/icons/puls-dark.svg", "/icons/puls-192.png",
  "/icons/puls-512.png", "/icons/puls-maskable-512.png", "/icons/apple-touch-icon.png",
];

/** The worker changes whenever shipped content changes, including public files. */
function pulsPwa(): Plugin {
  return {
    name: "puls-pwa",
    apply: "build",
    enforce: "post",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "puls-build", content: release.buildId }, injectTo: "head" }];
    },
    generateBundle(_options, bundle) {
      const template = readFileSync(new URL("./src/pwa/service-worker.js", import.meta.url), "utf8");
      const hash = createHash("sha256").update(template);
      const urls = [...PUBLIC_ASSETS];
      for (const name of Object.keys(bundle).sort()) {
        const output = bundle[name];
        hash.update(name).update(output.type === "chunk" ? output.code : output.source);
        if (/\.(?:js|css|woff2?|svg|png)$/.test(name)) urls.push(`/${name}`);
      }
      for (const url of PUBLIC_ASSETS) hash.update(url).update(readFileSync(new URL(`./public${url}`, import.meta.url)));
      const source = template.replace("__BUILD_ID__", hash.digest("hex").slice(0, 20))
        .replace("__STATIC_URLS__", JSON.stringify(urls.sort()))
        .replace("__RELEASE__", JSON.stringify(release));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(release) });
    },
  };
}

export default defineConfig({
  define: { __PULS_RELEASE__: JSON.stringify(release) },
  plugins: [react(), pulsPwa()],
  server: {
    port: 5173,
    // В разработке фронт ходит на локальный бэкенд через прокси,
    // поэтому в браузере нет кросс-доменных запросов.
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
