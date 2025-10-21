# frontend/Dockerfile
FROM node:18

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

# Serve with a lightweight web server
RUN npm install -g serve
CMD ["serve", "-s", "build"]
EXPOSE 3000
