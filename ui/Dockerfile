FROM docker.io/node:22-slim AS build

WORKDIR /app
COPY package.json ./
RUN npm install --include=dev --legacy-peer-deps --no-audit
COPY . .
RUN npm run build

FROM docker.io/nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
