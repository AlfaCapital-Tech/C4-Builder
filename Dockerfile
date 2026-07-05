# build-стадия: компиляция tsc → dist/ (dev-зависимости нужны только здесь)
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

# рантайм: JRE для рендера PlantUML (Smetana), запуск собранного CLI из dist/
FROM node:20-alpine

# graphviz не нужен: layout считает встроенный Java-движок PlantUML (Smetana)
RUN apk add --no-cache openjdk21-jre bash

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY template ./template
COPY vendor ./vendor

RUN ln -s /app/dist/index.js /usr/local/bin/c4builder && \
    chmod +x /app/dist/index.js

USER node
WORKDIR /pwd
CMD ["c4builder"]
