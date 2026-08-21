FROM node:22-slim

ARG XRAY_VERSION=26.7.28
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates curl python3 sudo unzip \
    && curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" -o /tmp/xray.zip \
    && unzip -q /tmp/xray.zip -d /tmp/xray \
    && install -m 755 /tmp/xray/xray /usr/local/bin/xray \
    && rm -rf /tmp/xray /tmp/xray.zip /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm install -g corepack@latest node-gyp \
    && corepack pnpm install --ignore-scripts \
    && cd /app/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty \
    && node-gyp rebuild \
    && cd /app \
    && node -e "require('node-pty')" \
    && corepack pnpm run build

RUN groupadd --system app && useradd --system --gid app --create-home --home-dir /home/app app \
    && chown -R app:app /app \
    && printf 'app ALL=(root) NOPASSWD: /bin/bash\n' > /etc/sudoers.d/app-terminal \
    && chmod 0440 /etc/sudoers.d/app-terminal \
    && chown root:root /usr/bin/sudo \
    && chmod 4755 /usr/bin/sudo \
    && test "$(stat -c '%u:%g:%a' /usr/bin/sudo)" = "0:0:4755"

ENV NODE_ENV=production \
    XRAY_BINARY_PATH=/usr/local/bin/xray \
    XRAY_INTERNAL_PORT=10000 \
    XRAY_RUNTIME_ENABLED=true \
    HOME=/home/app \
    TERMINAL_AS_ROOT=true
USER app
CMD ["node", "dist/index.js"]
