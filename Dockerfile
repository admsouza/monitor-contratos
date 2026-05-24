FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
RUN echo "CACHE_BUST=20260524124850" > /dev/null
COPY . .
EXPOSE 80
CMD ["node", "server.js"]
