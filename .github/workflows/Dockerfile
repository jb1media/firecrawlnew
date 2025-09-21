# Use Playwright base image which already contains browsers
FROM mcr.microsoft.com/playwright:focal

WORKDIR /app

# Copy package files then install
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
