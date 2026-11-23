FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/solhero-entrypoint
RUN mkdir -p /data && chown node:node /data \
    && chmod -R a+rX /ms-playwright \
    && chmod 755 /usr/local/bin/solhero-entrypoint
# Root is used only to initialize the runtime-mounted volume; entrypoint drops to node.
USER root
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/solhero-entrypoint"]
CMD ["node", "src/index.js"]
