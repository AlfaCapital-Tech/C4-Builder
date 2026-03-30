FROM node:20-alpine

RUN apk add --no-cache openjdk21-jre graphviz bash

WORKDIR /app
COPY package*.json ./

# Install dependencies, skip post-install scripts for node-plantuml
RUN npm install --ignore-scripts && \
    mkdir -p /app/node_modules/node-plantuml/vendor && \
    echo "module.exports = {};" > /app/node_modules/node-plantuml/vendor/vizjs.js

COPY . .

RUN ln -s /app/index.js /usr/local/bin/c4builder && \
    chmod +x /app/index.js

USER node
WORKDIR /pwd
CMD ["c4builder"]
