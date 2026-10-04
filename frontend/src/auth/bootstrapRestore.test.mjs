import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";

const require = createRequire(import.meta.url);
const fixtures = new Map([
  ["react", "react"], ["react/jsx-runtime", "jsx"], ["@tanstack/react-query", "query"],
  ["../api/client", "client"], ["../api/endpoints", "endpoints"], ["../api/access", "access"],
  ["./AuthContext", "auth"], ["../navigation", "navigation"],
]);
async function compile(name) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(name, import.meta.url))], bundle: true,
    platform: "node", format: "cjs", jsx: "automatic", write: false,
    plugins: [{ name: "bootstrap-fixtures", setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => fixtures.has(args.path)
        ? { path: `fixture:${fixtures.get(args.path)}`, external: true } : undefined);
    } }],
  });
  return mocks => {
    const module = { exports: {} };
    new Function("require", "module", "exports", compiled.outputFiles[0].text)(
      name => name.startsWith("fixture:") ? mocks[name.slice(8)] : require(name), module, module.exports,
    );
    return module.exports;
  };
}
const [authModule, accessModule] = await Promise.all([compile("./AuthContext.tsx"), compile("./AccessContext.tsx")]);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(done => setImmediate(done));
class ApiError extends Error {
  constructor(status, code = "request_timeout") { super("Сервер отвечает слишком долго. Повторите попытку."); this.status = status; this.code = code; }
}

// Exercise the real provider's effects with controlled requests. In particular,
// aborted requests deliberately settle late, as a non-cooperative transport can.
function hooks() {
  const slots = [];
  let cursor = 0, pending = [];
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    createContext: () => ({ Provider: "context-provider" }), useContext: context => context.value,
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { kind: "state", value: typeof initial === "function" ? initial() : initial };
      return [slot.value, next => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) pending.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  return { react, jsx: { jsx: (type, props) => ({ type, props }) },
    render(provider) {
      cursor = 0; pending = [];
      const element = provider({ children: "application" });
      const effects = pending; pending = []; effects.forEach(effect => effect());
      return element.props.value;
    },
    values: () => slots.filter(slot => slot.kind === "state").map(slot => slot.value),
    unmount: () => slots.forEach(slot => slot.cleanup?.()),
  };
}
function authFixture() {
  const requests = [], runtime = hooks();
  const tokenStore = { access: "saved-access", refresh: "saved-refresh" };
  const queryClient = { cancelQueries: async () => {}, clear() {} };
  const { AuthProvider } = authModule({ ...runtime,
    query: { useQueryClient: () => queryClient }, client: { ApiError, tokenStore, onUnauthorized: () => () => {} },
    endpoints: { auth: { me(signal) { const request = { ...deferred(), signal }; requests.push(request); return request.promise; } } },
  });
  return { requests, tokenStore, runtime, render: () => runtime.render(AuthProvider) };
}
const profile = { id: 41, role: "operator", full_name: "Оператор", group: null, is_developer: false };

test("unmount aborts profile restoration and a late successful profile cannot reach the retired provider", async () => {
  const s = authFixture();
  const before = s.render();
  assert.equal(before.loading, true);
  assert.equal(s.requests[0].signal.aborted, false);
  s.runtime.unmount();
  assert.equal(s.requests[0].signal.aborted, true);
  s.requests[0].resolve(profile); await settle();
  assert.deepEqual(s.runtime.values().slice(0, 3), [null, true, null]);
  assert.equal(s.tokenStore.access, "saved-access");
});

test("retry cancels the old restoration; its late failure cannot hide the newer successful profile", async () => {
  const s = authFixture();
  s.render().retryRestore(); s.render();
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[0].signal.aborted, true);
  assert.equal(s.requests[1].signal.aborted, false);
  s.requests[1].resolve(profile); await settle();
  s.requests[0].reject(new ApiError(0)); await settle();
  const current = s.render();
  assert.equal(current.user, profile);
  assert.equal(current.loading, false);
  assert.equal(current.restoreError, null);
  s.runtime.unmount();
});

test("a timed-out restoration leaves saved credentials available and manual retry clears the boot error", async () => {
  const s = authFixture(), error = new ApiError(0);
  s.render();
  s.requests[0].reject(error); await settle();
  const failed = s.render();
  assert.equal(failed.loading, false);
  assert.equal(failed.user, null);
  assert.equal(failed.restoreError, error);
  assert.equal(s.tokenStore.access, "saved-access");
  failed.retryRestore();
  const retrying = s.render();
  assert.equal(retrying.loading, true);
  assert.equal(retrying.restoreError, null);
  s.requests[1].resolve(profile); await settle();
  assert.equal(s.render().user, profile);
  s.runtime.unmount();
});

function accessFixture() {
  const runtime = hooks(), requests = [];
  let options;
  const { AccessProvider } = accessModule({ ...runtime,
    auth: { useAuth: () => ({ user: profile, retryRestore() {} }) }, client: { onSectionDenied: () => () => {} },
    query: { useQueryClient: () => ({}), useQuery(value) {
      options = value; return { data: undefined, isPending: true, error: null, refetch() {} };
    } },
    access: { accessApi: { mine(signal) { const request = { ...deferred(), signal }; requests.push(request); return request.promise; } } },
    navigation: { canVisit: () => false, visibleNavigation: () => [] },
  });
  runtime.render(AccessProvider);
  return { options, requests };
}

test("cold access loading starts even offline, stops after one failure and waits for a manual retry", async t => {
  const wasOnline = onlineManager.isOnline(), wasFocused = focusManager.isFocused();
  onlineManager.setOnline(false); focusManager.setFocused(false);
  const s = accessFixture();
  const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } });
  client.mount();
  const observer = new QueryObserver(client, s.options), snapshots = [];
  const stop = observer.subscribe(state => snapshots.push(state));
  t.after(() => { stop(); client.unmount(); client.clear(); onlineManager.setOnline(wasOnline); focusManager.setFocused(wasFocused); });
  assert.equal(s.requests.length, 1, "offline mode must not leave the boot query paused before its deadline starts");
  s.requests[0].reject(new ApiError(0)); await settle();
  assert.equal(snapshots.at(-1).status, "error");
  assert.equal(snapshots.at(-1).fetchStatus, "idle");
  const query = client.getQueryCache().find({ queryKey: s.options.queryKey });
  assert.equal(s.options.refetchInterval(query), false);
  assert.equal(s.options.refetchOnWindowFocus(query), false);
  assert.equal(s.options.refetchOnReconnect(query), false);
  onlineManager.setOnline(true); focusManager.setFocused(true); await settle();
  assert.equal(s.requests.length, 1, "a failed initial request must not restart through retry, reconnect or focus");
  const retry = observer.refetch();
  assert.equal(s.requests.length, 2);
  const permissions = { role: "operator", allowed: { training: true }, group_id: null, capabilities: { manage_sessions: false } };
  s.requests[1].resolve(permissions); await retry;
  assert.equal(observer.getCurrentResult().data, permissions);
  assert.equal(s.options.refetchInterval(query), 30_000);
  assert.equal(s.options.refetchOnWindowFocus(query), true);
  assert.equal(s.options.refetchOnReconnect(query), true);
});

test("leaving the access provider cancels its pending query through the supplied signal", async t => {
  const s = accessFixture(), client = new QueryClient(), observer = new QueryObserver(client, s.options);
  t.after(() => client.clear());
  const stop = observer.subscribe(() => {});
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].signal.aborted, false);
  stop();
  assert.equal(s.requests[0].signal.aborted, true);
  s.requests[0].resolve({ allowed: { training: true } }); await settle();
  assert.equal(client.getQueryData(s.options.queryKey), undefined, "an abandoned access response cannot repopulate permissions");
});
