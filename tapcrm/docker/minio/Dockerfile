# MinIO and its client (mc) built from source. The prebuilt minio/minio images
# are no longer published on Docker Hub, so we compile the pinned release
# ourselves. Both binaries go into one small image used by `minio` and
# `minio-init` in docker-compose.prod.yml.
FROM golang:1.24-alpine AS build
ARG MINIO_VERSION=RELEASE.2025-04-22T22-12-26Z
ARG MC_VERSION=RELEASE.2025-04-16T18-13-26Z
ENV CGO_ENABLED=0
RUN apk add --no-cache git \
  && go install -trimpath -ldflags "-s -w" github.com/minio/minio@${MINIO_VERSION} \
  && go install -trimpath -ldflags "-s -w" github.com/minio/mc@${MC_VERSION}

FROM alpine:3.21
RUN apk add --no-cache ca-certificates curl
COPY --from=build /go/bin/minio /go/bin/mc /usr/local/bin/
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
