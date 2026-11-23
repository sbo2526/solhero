FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown node:node /data && chmod -R a+rX /ms-playwright
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
