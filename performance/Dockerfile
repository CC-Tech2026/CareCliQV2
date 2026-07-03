FROM node:20-alpine

RUN apk add --no-cache curl ca-certificates && \
    K6_VERSION=v0.54.0 && \
    curl -fsSL "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-linux-amd64.tar.gz" \
      | tar xz -C /tmp && \
    mv "/tmp/k6-${K6_VERSION}-linux-amd64/k6" /usr/local/bin/k6 && \
    chmod +x /usr/local/bin/k6 && \
    rm -rf /tmp/k6-*

WORKDIR /app

COPY performance/ /app/performance/

RUN chmod +x /app/performance/run-test.sh

WORKDIR /app/performance

ENTRYPOINT ["/app/performance/run-test.sh"]
