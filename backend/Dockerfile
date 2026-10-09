FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN go build -o /out/server ./cmd/server

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/server ./server
EXPOSE 8080
CMD ["./server"]
