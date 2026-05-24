FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
RUN echo "BUILD_TS=$(date -u +%s)" > /build_info.txt
COPY . .
EXPOSE 80
CMD ["node", "server.js"]