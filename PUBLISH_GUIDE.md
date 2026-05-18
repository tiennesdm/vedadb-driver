# Publishing Guide for vedadb-driver

This document outlines step-by-step instructions for publishing the `vedadb-driver` package to npm, GitHub Packages, and JSR (JavaScript Registry).

---

## Table of Contents

1. [Pre-Publication Checklist](#pre-publication-checklist)
2. [Publish to npm](#publish-to-npm)
3. [Publish to GitHub Packages](#publish-to-github-packages)
4. [Publish to JSR](#publish-to-jsr)
5. [Automated Publishing with GitHub Actions](#automated-publishing)
6. [Versioning Strategy](#versioning-strategy)
7. [Troubleshooting](#troubleshooting)

---

## Pre-Publication Checklist

Before publishing, verify:

```bash
# 1. Install dependencies
npm install

# 2. Build the project
npm run build

# 3. Verify build output exists
ls dist/
# Should show:
#   index.js  index.mjs  index.d.ts
#   api.js    api.mjs    api.d.ts

# 4. Run TypeScript check
npx tsc --noEmit

# 5. Test in a fresh project
mkdir /tmp/test-vedadb && cd /tmp/test-vedadb
npm init -y
npm install /mnt/agents/output/vedadb-driver
cat > test.mjs << 'EOF'
import { createClient } from "vedadb-driver";
import { createApiClient } from "vedadb-driver/api";
console.log("TCP client:", typeof createClient);
console.log("API client:", typeof createApiClient);
EOF
node test.mjs
```

---

## Publish to npm

### Step 1: Login

```bash
npm login
# Enter your npm username, password, and OTP if 2FA is enabled
```

### Step 2: Verify package contents

```bash
cd /mnt/agents/output/vedadb-driver
npm pack --dry-run
```

### Step 3: Publish

```bash
# For the first publish
npm publish --access public

# For subsequent updates (patch/minor/major)
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
npm publish
```

### Step 4: Verify

```bash
# Check the published package
npm view vedadb-driver

# Install from npm
npm install vedadb-driver
```

---

## Publish to GitHub Packages

### Step 1: Configure npm for GitHub Packages

Create or edit `~/.npmrc`:

```bash
@tiennesdm:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Or authenticate via CLI:

```bash
npm login --scope=@tiennesdm --registry=https://npm.pkg.github.com
# Use your GitHub username
# Use a Personal Access Token (classic) with `write:packages` scope as password
```

### Step 2: Update package name (if needed)

For GitHub Packages, the package name must match the scope:

```json
{
  "name": "@tiennesdm/vedadb-driver"
}
```

You can either:
- Maintain a separate branch with scoped name
- Use a script to temporarily rename:

```bash
# Backup original
jq '.name' package.json > /tmp/original-name.txt

# Set scoped name
jq '.name = "@tiennesdm/vedadb-driver"' package.json > package.tmp.json
mv package.tmp.json package.json
```

### Step 3: Publish

```bash
npm publish --access public
```

### Step 4: Restore original name (optional)

```bash
jq ".name = $(cat /tmp/original-name.txt)" package.json > package.tmp.json
mv package.tmp.json package.json
```

### Step 5: Install from GitHub Packages

```bash
npm install @tiennesdm/vedadb-driver --registry=https://npm.pkg.github.com
```

---

## Publish to JSR

JSR is the modern JavaScript registry from Deno that supports TypeScript natively.

### Step 1: Install JSR CLI

```bash
# With Deno
deno install -A jsr.io/@std/cli@1.0.0

# With npm
npx jsr --version
```

### Step 2: Create `jsr.json`

```bash
cat > /mnt/agents/output/vedadb-driver/jsr.json << 'EOF'
{
  "name": "@tiennesdm/vedadb-driver",
  "version": "1.0.0",
  "exports": {
    ".": "./src/index.ts",
    "./api": "./src/api.ts"
  },
  "include": ["src/", "LICENSE", "README.md"]
}
EOF
```

### Step 3: Create `deno.json` (for Deno compatibility)

```bash
cat > /mnt/agents/output/vedadb-driver/deno.json << 'EOF'
{
  "name": "@tiennesdm/vedadb-driver",
  "version": "1.0.0",
  "exports": {
    ".": "./src/index.ts",
    "./api": "./src/api.ts"
  }
}
EOF
```

### Step 4: Authenticate

```bash
npx jsr auth
# Opens browser for authentication
```

### Step 5: Publish

```bash
cd /mnt/agents/output/vedadb-driver
npx jsr publish
```

### Step 6: Verify

```bash
# View on JSR
open https://jsr.io/@tiennesdm/vedadb-driver

# Install with Deno
deno add @tiennesdm/vedadb-driver

# Install with npm (JSR provides npm-compatible tarballs)
npx jsr add @tiennesdm/vedadb-driver
```

---

## Automated Publishing

### GitHub Actions Workflow

Create `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    tags:
      - "v*"

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-github:
    runs-on: ubuntu-latest
    permissions:
      packages: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://npm.pkg.github.com"
      - run: npm ci
      - run: npm run build
      - run: |
          jq '.name = "@tiennesdm/vedadb-driver"' package.json > p.json
          mv p.json package.json
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  publish-jsr:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: npx jsr publish
```

### Creating a Release

```bash
# 1. Update version
npm version patch   # or minor, major

# 2. Push tag
git push origin main --follow-tags

# 3. GitHub Actions publishes automatically
```

---

## Versioning Strategy

Follow [Semantic Versioning](https://semver.org/):

| Version Change | When to Use |
|---------------|-------------|
| **Patch** (1.0.x) | Bug fixes, docs updates |
| **Minor** (1.x.0) | New features, backward-compatible |
| **Major** (x.0.0) | Breaking changes |

```bash
# Pre-release versions
npm version 1.1.0-beta.1
npm publish --tag beta

# Users install beta
npm install vedadb-driver@beta
```

---

## Troubleshooting

### npm publish fails with E403

```bash
# Check login
npm whoami

# If using 2FA, use --otp
npm publish --otp 123456
```

### GitHub Packages returns 401

```bash
# Generate a PAT at https://github.com/settings/tokens
# Required scopes: read:packages, write:packages
# Update .npmrc auth token
```

### JSR publish fails

```bash
# Ensure jsr.json is valid JSON
npx jsr publish --dry-run

# Check for TypeScript errors
npx tsc --noEmit

# Verify exports exist
ls src/index.ts src/api.ts
```

### Build output missing

```bash
# Clean and rebuild
rm -rf dist/
npm run build

# Verify tsup is installed
npm install
```

### ESM/CJS import issues

```bash
# Test both formats
node -e "const { createClient } = require('vedadb-driver'); console.log('CJS OK');"
node --input-type=module -e "import { createClient } from 'vedadb-driver'; console.log('ESM OK');"
```
