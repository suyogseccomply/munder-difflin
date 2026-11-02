FROM node:22-alpine
WORKDIR /app
COPY relay.mjs main.mjs ./
ENV HOST=0.0.0.0 PORT=8787 RELAY_DATA=/data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "main.mjs"]
