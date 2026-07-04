FROM node:20-alpine

# graphviz не нужен: layout считает встроенный Java-движок PlantUML (Smetana)
RUN apk add --no-cache openjdk21-jre bash

WORKDIR /app
COPY package*.json ./

RUN npm install --ignore-scripts

COPY . .

RUN ln -s /app/index.js /usr/local/bin/c4builder && \
    chmod +x /app/index.js

USER node
WORKDIR /pwd
CMD ["c4builder"]
