# FCTF Documentation Portal

This folder contains the Docusaurus documentation site for FCTF v4.

## Prerequisites

- Node.js 20+
- npm

## Install dependencies

```bash
npm install
```

## Local development

```bash
npm run start
```

## Production build

```bash
npm run build
```

## Serve production build locally

```bash
npm run serve
```

## Documentation quality policy

1. Keep docs and behavior changes in the same pull request.
2. Keep primary docs in English.
3. Use approved baseline sections for terminology and style:
	- `docs/product-and-features/admin/*`
	- `docs/architecture/*`
	- `docs/install-and-ops/*`
4. Validate links, front matter, and screenshot paths before merge.
