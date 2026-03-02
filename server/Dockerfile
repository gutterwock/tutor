FROM docker.io/node:22-slim

RUN apt-get update && \
		apt-get upgrade -y && \
		rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]