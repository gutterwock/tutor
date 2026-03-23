FROM docker.io/node:22-slim

RUN apt-get update && \
		apt-get upgrade -y && \
		rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG ENABLE_EMBEDDINGS=false

COPY package*.json .npmrc ./
RUN if [ "$ENABLE_EMBEDDINGS" = "true" ]; then \
      npm ci --omit=dev --include=optional; \
    else \
      npm ci --omit=dev --omit=optional; \
    fi && \
    npm install -g @anthropic-ai/claude-code

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]