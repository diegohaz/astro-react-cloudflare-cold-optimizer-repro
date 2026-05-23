# Astro React Cloudflare Cold Optimizer Repro

Minimal reproduction for a dev-only cold-cache warning with Astro, React, and the Cloudflare adapter.

On the first request after deleting Vite's optimizer cache, Astro/Vite discovers `astro/virtual-modules/transitions.js`, reloads the program, and React logs invalid hook warnings while rendering an ordinary server-side React component. A second request against the same dev server is clean.

The minimum moving parts are:

- `@astrojs/cloudflare`
- `@astrojs/react`
- `ClientRouter` from `astro:transitions`
- a server-rendered React component using standard hooks

## Install

```sh
pnpm install
```

## Manual Reproduction

Start from a cold Vite optimizer cache:

```sh
rm -rf node_modules/.vite
pnpm dev
```

In another terminal, request the page:

```sh
curl -i http://localhost:4321/
```

Expected behavior on the first request:

- the response is `200`
- the dev server prints `new dependencies optimized: astro/virtual-modules/transitions.js`
- the dev server prints `optimized dependencies changed. reloading`
- the dev server prints `Warning: Invalid hook call`
- the dev server prints `TypeError: Cannot read properties of null (reading 'useContext')`

Example log:

```txt
[vite] new dependencies optimized: astro/virtual-modules/transitions.js
[vite] optimized dependencies changed. reloading
[vite] [vite] program reload
[ERROR] [vite] Warning: Invalid hook call. Hooks can only be called inside of the body of a function component.
[ERROR] [vite] TypeError: Cannot read properties of null (reading 'useContext')
```

Inspect the optimized SSR dependency metadata:

```sh
node -e 'const m = require("./node_modules/.vite/deps_ssr/_metadata.json"); console.log(Object.keys(m.optimized).filter((key) => /react|transitions|cloudflare/.test(key)).join("\n"))'
```

Expected relevant entries:

```txt
@astrojs/cloudflare/image-service-workerd
react
react/jsx-runtime
react/jsx-dev-runtime
react-dom
react-dom/server
@astrojs/cloudflare/entrypoints/server
astro/virtual-modules/transitions.js
```

Request the page again without restarting the server:

```sh
curl -i http://localhost:4321/
```

Expected behavior on the second request:

- the response contains `Server rendered React hook count: 1`
- no new `Invalid hook call` warning is printed

## Automated Reproduction

The Playwright test starts `astro dev`, deletes `node_modules/.vite`, makes a cold request, asserts that the invalid hook warning appears, then makes a warm request and asserts that the warning count does not increase.

```sh
pnpm test
```

The test also asserts that `react` resolves to the same package from the app and from `react-dom`, and that `node_modules/.vite/deps_ssr/_metadata.json` contains `astro/virtual-modules/transitions.js`. It uses a random local port, so it can run even if `localhost:4321` is already in use.

The GitHub Actions workflow runs the same test on every push and pull request. The test prints the captured `astro dev` output, so the `Invalid hook call` warning and `useContext` stack trace are visible in the CI logs.

## Notes

The React component is intentionally ordinary:

- `createContext`
- `useContext`
- `useId`
- `useState`

There is no MDX, custom renderer, linked package, or non-standard hook pattern in this reproduction.
