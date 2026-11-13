FROM node:22-alpine AS build
WORKDIR /src
COPY widget/package*.json widget/
COPY frontend/package*.json frontend/
RUN cd widget && npm ci && cd ../frontend && npm ci
COPY widget widget
COPY frontend frontend
RUN cd widget && npm run build && cd ../frontend && npm run build

FROM nginx:1.27-alpine
COPY infrastructure/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
