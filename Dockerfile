FROM node:20-bullseye-slim

WORKDIR /app

ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5179

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5179"]
