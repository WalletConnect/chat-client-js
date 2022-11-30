FROM node:16.16-alpine as base

WORKDIR /

RUN apk --update --no-cache  \
    add g++ make python3

FROM base as build

WORKDIR /

COPY ./ ./
RUN npm ci
WORKDIR /packages/chat-client/

CMD ["node", "-v"]
