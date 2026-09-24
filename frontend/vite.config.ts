import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import releaseDetails from "./src/pwa/release.json";

// buildId — отпечаток содержимого сборки, а он известен только когда бандл готов.
// Поэтому в код и в index.html попадают заглушки, а настоящие значения подставляются
// после подсчёта хеша. Пересборка того же кода даёт тот же buildId, и клиенты не
// видят обновления там, где меняется одно лишь время сборки.
const BUILD_ID = "__PULS_BUILD_ID__";
const BUILT_AT = "__PULS_BUILT_AT__";
const releaseTemplate = { ...releaseDetails, builtAt: BUILT_AT, buildId: BUILD_ID };

const PUBLIC_ASSETS = [
  "/manifest.webmanifest", "/offline.html", "/favicon.svg",
  "/icons/puls-light.svg", "/icons/puls-dark.svg", "/icons/puls-192.png",
  "/icons/puls-512.png", "/icons/puls-maskable-512.png", "/icons/apple-touch-icon.png",
  "/icons/puls-app-192-v3.png", "/icons/puls-app-512-v3.png", "/icons/puls-maskable-v3.png",
  "/icons/apple-touch-icon-v3.png", "/icons/puls-favicon-v3.png",
];

/** The worker changes whenever shipped content changes, including public files. */
function pulsPwa(): Plugin {
  return {
    name: "puls-pwa",
    apply: "build",
    enforce: "post",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "puls-build", content: BUILD_ID }, injectTo: "head" }];
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
      const release = { ...releaseDetails, builtAt: new Date().toISOString(),
        buildId: hash.digest("hex").slice(0, 20) };

      // Заглушки стоят в бандле и в index.html — оба уже учтены в хеше выше.
      const stamp = (text: string) => text.split(BUILD_ID).join(release.buildId).split(BUILT_AT).join(release.builtAt);
      let stamped = 0;
      for (const name of Object.keys(bundle)) {
        const output = bundle[name];
        const before = output.type === "chunk" ? output.code : output.source;
        if (typeof before !== "string") continue;
        const after = stamp(before);
        if (after === before) continue;
        if (output.type === "chunk") output.code = after; else output.source = after;
        stamped += 1;
      }
      // Незаменённая заглушка не пройдёт readRelease и навсегда отключит обновления.
      if (stamped < 2) this.error(`Выпуск не проштампован: заглушки найдены в ${stamped} файлах, ожидались бандл и index.html.`);

      const source = template.replace("__BUILD_ID__", release.buildId)
        .replace("__STATIC_URLS__", JSON.stringify(urls.sort()))
        .replace("__RELEASE__", JSON.stringify(release));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(release) });
    },
  };
}

export default defineConfig(({ command }) => ({
  // В разработке выпуск не штампуется, поэтому __PULS_RELEASE__ не объявляем:
  // release.ts подставит запасной вариант с buildId "development".
  define: command === "build" ? { __PULS_RELEASE__: JSON.stringify(releaseTemplate) } : {},
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
}));
